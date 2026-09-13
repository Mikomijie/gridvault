// GridVault ledger export and standalone file verification (PRD 8.7).
//
// `exportLedger` writes the ledger as newline-delimited canonical JSON with
// the anchor receipts appended. `verifyExportFile` recomputes every hash
// from the file bytes alone: it takes a path, never a database handle, and
// performs no network I/O, so a judge, auditor or court can check the chain
// without trusting the running system. The CLI `verify-ledger --file` path
// is deliberately structured so it cannot open a database even by accident.

import { openSync, writeSync, closeSync, readFileSync } from 'node:fs';
import { canonicalJson } from '../crypto/canonical-json.js';
import { formatIsoWithOffset, systemClock } from '../clock.js';
import type { GridVaultDatabase } from '../db/connection.js';
import type { AuditLogRow } from '../db/repositories/ledger.js';
import { verifyRowSequence, type VerifyReport, type VerifyOptions } from './verify.js';
import type { AnchorReceipt } from './anchor.js';

export const EXPORT_RECORD_AUDIT = 'audit_log';
export const EXPORT_RECORD_ANCHOR = 'anchor';

export interface ExportCounts {
  path: string;
  entries: number;
  anchors: number;
  bytes: number;
  head_hash: string | null;
}

interface ExportedAnchor extends AnchorReceipt {
  status: string;
}

/**
 * The single code path behind both the file export and the HTTP export
 * endpoint: yields one canonical-JSON line per ledger row (log_index
 * order), then one per anchor receipt. Generators stream the database
 * cursor, so neither caller materializes the ledger.
 */
export function* iterateExportLines(db: GridVaultDatabase): Generator<string> {
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY log_index ASC')
    .iterate() as Iterable<AuditLogRow>;
  for (const row of rows) {
    yield (
      canonicalJson({
        record: EXPORT_RECORD_AUDIT,
        log_index: row.log_index,
        timestamp: row.timestamp,
        staff_id: row.staff_id,
        staff_role: row.staff_role,
        ward: row.ward,
        patient_id: row.patient_id,
        action: row.action,
        details: row.details,
        session_id: row.session_id,
        terminal_id: row.terminal_id,
        source_ip: row.source_ip,
        prev_hash: row.prev_hash,
        current_hash: row.current_hash
      }) + '\n'
    );
  }
  const anchorRows = db.prepare('SELECT * FROM chain_anchors ORDER BY chain_head_index ASC').all() as Array<
    AnchorReceipt & { status: string }
  >;
  for (const anchor of anchorRows) {
    yield (
      canonicalJson({
        record: EXPORT_RECORD_ANCHOR,
        status: anchor.status,
        receipt_id: anchor.receipt_id,
        facility_id: anchor.facility_id,
        chain_head_index: anchor.chain_head_index,
        chain_head_hash: anchor.chain_head_hash,
        entry_count: anchor.entry_count,
        anchored_at: anchor.anchored_at,
        node_signature: anchor.node_signature
      }) + '\n'
    );
  }
}

/**
 * Write every audit_logs row (log_index order) followed by every
 * chain_anchors row as one canonical-JSON object per line. Streams both the
 * database cursor and the file descriptor, so a 50,000-entry ledger exports
 * in O(1) memory.
 */
export function exportLedger(db: GridVaultDatabase, outPath: string): ExportCounts {
  const fd = openSync(outPath, 'w');
  let entries = 0;
  let anchors = 0;
  let bytes = 0;
  let headHash: string | null = null;
  try {
    for (const line of iterateExportLines(db)) {
      bytes += writeSync(fd, line, null, 'utf8');
      const parsed = JSON.parse(line) as { record?: string; current_hash?: string };
      if (parsed.record === EXPORT_RECORD_AUDIT) {
        entries += 1;
        headHash = parsed.current_hash ?? headHash;
      } else {
        anchors += 1;
      }
    }
  } finally {
    closeSync(fd);
  }
  return { path: outPath, entries, anchors, bytes, head_hash: headHash };
}

const AUDIT_FIELD_NAMES = [
  'log_index',
  'timestamp',
  'staff_id',
  'staff_role',
  'ward',
  'patient_id',
  'action',
  'details',
  'session_id',
  'terminal_id',
  'source_ip',
  'prev_hash',
  'current_hash'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A line that does not parse, or parses to the wrong shape, is tampering, not a crash. */
function malformedReport(position: number, clock: VerifyOptions['clock'], timeZone: string): VerifyReport {
  const activeClock = clock ?? systemClock;
  return {
    status: 'TAMPERED',
    total_records: position - 1,
    broken_at_index: position,
    failure_kind: 'HASH_MISMATCH',
    head_hash: null,
    witness: { status: 'NO_ANCHOR', last_anchor_index: null, last_anchor_at: null, divergence: null },
    verified_at: formatIsoWithOffset(activeClock.now(), timeZone),
    duration_ms: 0
  };
}

function toAuditRow(value: Record<string, unknown>): AuditLogRow | null {
  for (const field of AUDIT_FIELD_NAMES) {
    if (!(field in value)) {
      return null;
    }
  }
  if (typeof value['log_index'] !== 'number' || typeof value['details'] !== 'string') {
    return null;
  }
  const nullable = ['session_id', 'terminal_id', 'source_ip'] as const;
  for (const field of nullable) {
    const v = value[field];
    if (v !== null && typeof v !== 'string') {
      return null;
    }
  }
  const strings = [
    'timestamp',
    'staff_id',
    'staff_role',
    'ward',
    'patient_id',
    'action',
    'prev_hash',
    'current_hash'
  ] as const;
  for (const field of strings) {
    if (typeof value[field] !== 'string') {
      return null;
    }
  }
  return {
    log_index: value['log_index'] as number,
    timestamp: value['timestamp'] as string,
    staff_id: value['staff_id'] as string,
    staff_role: value['staff_role'] as string,
    ward: value['ward'] as string,
    patient_id: value['patient_id'] as string,
    action: value['action'] as string,
    details: value['details'] as string,
    session_id: value['session_id'] as string | null,
    terminal_id: value['terminal_id'] as string | null,
    source_ip: value['source_ip'] as string | null,
    prev_hash: value['prev_hash'] as string,
    current_hash: value['current_hash'] as string
  };
}

/**
 * Verify an exported JSONL file with no database and no network. Returns
 * the same verdict shape as the live verifier; a hand-edited line is
 * reported as TAMPERED at the edited index.
 */
export function verifyExportFile(filePath: string, options: VerifyOptions = {}): VerifyReport {
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const content = readFileSync(filePath, 'utf8');
  const rows: AuditLogRow[] = [];
  const witnessViews: Array<{ chain_head_index: number; chain_head_hash: string; anchored_at: string }> = [];
  let pendingAnchorCount = 0;

  for (const rawLine of content.split('\n')) {
    if (rawLine.trim().length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine) as unknown;
    } catch {
      return malformedReport(rows.length + 1, options.clock, timeZone);
    }
    if (!isRecord(parsed) || parsed['record'] === EXPORT_RECORD_AUDIT) {
      if (!isRecord(parsed)) {
        return malformedReport(rows.length + 1, options.clock, timeZone);
      }
      const row = toAuditRow(parsed);
      if (row === null) {
        return malformedReport(rows.length + 1, options.clock, timeZone);
      }
      rows.push(row);
      continue;
    }
    if (parsed['record'] === EXPORT_RECORD_ANCHOR) {
      const anchor = parsed as Record<string, unknown> & Partial<ExportedAnchor>;
      if (
        typeof anchor['chain_head_index'] !== 'number' ||
        typeof anchor['chain_head_hash'] !== 'string' ||
        typeof anchor['anchored_at'] !== 'string'
      ) {
        return malformedReport(rows.length + 1, options.clock, timeZone);
      }
      if (anchor['status'] === 'ACKNOWLEDGED') {
        witnessViews.push({
          chain_head_index: anchor['chain_head_index'] as number,
          chain_head_hash: anchor['chain_head_hash'] as string,
          anchored_at: anchor['anchored_at'] as string
        });
      } else if (anchor['status'] === 'PENDING') {
        pendingAnchorCount += 1;
      }
      continue;
    }
    return malformedReport(rows.length + 1, options.clock, timeZone);
  }

  return verifyRowSequence(rows, witnessViews, pendingAnchorCount, options);
}
