// GridVault ledger append path (PRD section 8).
//
// The ONLY sanctioned way to write to audit_logs. Runs inside an IMMEDIATE
// transaction: the head (max log_index + its current_hash) is read under the
// same write lock that the insert takes, so concurrent ward terminals cannot
// interleave and fork the chain — the second writer blocks until the first
// commits, then reads the new head. better-sqlite3 is synchronous, so within
// one process there is no await inside the lock; across processes/host
// connections WAL + IMMEDIATE + busy_timeout serializes writers.
//
// If the caller already holds a transaction (a future service composing its
// state change with its ledger entry in one atomic unit, per AGENTS.md
// section 5), the statements join that ambient transaction instead of
// opening a nested one.

import type { GridVaultDatabase } from '../db/connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import {
  GENESIS_PREV_HASH,
  hashLedgerEntry,
  normalizeDetails
} from '../crypto/hash.js';
import { auditLogsRepository } from '../db/repositories/ledger.js';

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** Every action the ledger accepts, verbatim from PRD section 8.1. Unknown actions fail closed. */
export const LEDGER_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'SESSION_LOCK',
  'SESSION_UNLOCK',
  'VIEW_ROSTER',
  'VIEW_RECORD',
  'VIEW_SENSITIVE',
  'ACCESS_DENIED',
  'RECORD_VITALS',
  'UPDATE_CLINICAL',
  'SIGN_MAR',
  'APPEND_NOTE',
  'EXPORT_HANDOVER',
  'PRINT_RECORD',
  'EMERGENCY_OVERRIDE_REQUESTED',
  'EMERGENCY_OVERRIDE_GRANTED',
  'EMERGENCY_OVERRIDE_CLOSED',
  'EMERGENCY_OVERRIDE_REVOKED',
  'OVERRIDE_REVIEWED',
  'ABUSE_ALERT_RAISED',
  'ABUSE_ALERT_RESOLVED',
  'SYNC_REPLAY',
  'BACKFILL_PAPER_SLIP',
  'USER_CREATED',
  'USER_MODIFIED',
  'USER_DEACTIVATED',
  'CHAIN_ANCHORED',
  'CHAIN_VERIFIED',
  'BACKUP_CREATED',
  'RESTORE_PERFORMED'
] as const;

export type LedgerAction = (typeof LEDGER_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(LEDGER_ACTIONS);

export function isLedgerAction(action: string): action is LedgerAction {
  return ACTION_SET.has(action);
}

export interface LedgerAppendInput {
  staff_id: string;
  staff_role: string;
  ward: string;
  patient_id: string;
  action: string;
  /** Structured value; stored as canonical JSON. Never PHI values — field names, codes, ids, counts. */
  details: unknown;
  timestamp?: string;
  session_id?: string | null;
  terminal_id?: string | null;
  source_ip?: string | null;
}

export interface LedgerAppendResult {
  log_index: number;
  prev_hash: string;
  current_hash: string;
}

export interface AppendOptions {
  clock?: Clock;
  timeZone?: string;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new LedgerError(`audit_logs.${field} must be a non-empty string`);
  }
}

function resolveTimestamp(input: LedgerAppendInput, options: AppendOptions): string {
  if (input.timestamp === undefined) {
    const clock = options.clock ?? systemClock;
    return formatIsoWithOffset(clock.now(), options.timeZone ?? 'Africa/Lagos');
  }
  if (input.timestamp.trim().length === 0 || Number.isNaN(Date.parse(input.timestamp))) {
    throw new LedgerError('audit_logs.timestamp must be a parseable ISO-8601 instant');
  }
  return input.timestamp;
}

function appendStatements(
  db: GridVaultDatabase,
  input: LedgerAppendInput,
  options: AppendOptions
): LedgerAppendResult {
  requireNonEmpty(input.staff_id, 'staff_id');
  requireNonEmpty(input.staff_role, 'staff_role');
  requireNonEmpty(input.ward, 'ward');
  requireNonEmpty(input.patient_id, 'patient_id');
  if (!isLedgerAction(input.action)) {
    throw new LedgerError(`Unknown ledger action: ${input.action}`);
  }
  const timestamp = resolveTimestamp(input, options);
  let details: string;
  try {
    details = normalizeDetails(input.details);
  } catch (error) {
    throw new LedgerError(
      `audit_logs.details must be canonical-JSON serializable: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const head = db
    .prepare('SELECT log_index, current_hash FROM audit_logs ORDER BY log_index DESC LIMIT 1')
    .get() as { log_index: number; current_hash: string } | undefined;
  const logIndex = head === undefined ? 1 : head.log_index + 1;
  const prevHash = head === undefined ? GENESIS_PREV_HASH : head.current_hash;

  const currentHash = hashLedgerEntry({
    log_index: logIndex,
    timestamp,
    staff_id: input.staff_id,
    staff_role: input.staff_role,
    ward: input.ward,
    patient_id: input.patient_id,
    action: input.action,
    details,
    session_id: input.session_id ?? null,
    terminal_id: input.terminal_id ?? null,
    source_ip: input.source_ip ?? null,
    prev_hash: prevHash
  });

  const inserted = auditLogsRepository(db).insert({
    timestamp,
    staff_id: input.staff_id,
    staff_role: input.staff_role,
    ward: input.ward,
    patient_id: input.patient_id,
    action: input.action,
    details,
    session_id: input.session_id ?? null,
    terminal_id: input.terminal_id ?? null,
    source_ip: input.source_ip ?? null,
    prev_hash: prevHash,
    current_hash: currentHash
  });
  if (inserted !== logIndex) {
    // AUTOINCREMENT guarantees rowid == log_index on a fresh insert; any
    // divergence means the table was manipulated under us — fail loudly.
    throw new LedgerError(
      `Ledger head moved during append: expected index ${logIndex}, inserted ${inserted}`
    );
  }
  return { log_index: logIndex, prev_hash: prevHash, current_hash: currentHash };
}

/**
 * Append one entry to the hash chain and return its index and hashes.
 * Throws LedgerError (fail closed) on any validation, serialization or
 * database failure — the caller must treat a throw as "not appended".
 */
export function appendLedgerEntry(
  db: GridVaultDatabase,
  input: LedgerAppendInput,
  options: AppendOptions = {}
): LedgerAppendResult {
  if (db.inTransaction) {
    return appendStatements(db, input, options);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = appendStatements(db, input, options);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The connection is already unusable; surface the original failure.
    }
    throw error;
  }
}
