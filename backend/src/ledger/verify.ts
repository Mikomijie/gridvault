// GridVault ledger verification engine (PRD section 8.5).
//
// Streams the ledger in log_index order and checks, per row: index density
// (no gaps, no duplicates), prev_hash linkage, current_hash recomputation,
// monotonic non-decreasing timestamps, and agreement with the latest witness
// receipt.
//
// Two passes, each O(1) memory (better-sqlite3 iterates the index without
// materializing rows), so a 50,000-entry ledger verifies as a stream:
//
//   Phase A — structure: density + timestamp monotonicity over
//             (log_index, timestamp) only. A reordered-timestamps attack is
//             localized here as TIMESTAMP_REGRESSION: checking the sequence
//             before recomputing hashes keeps it from being masked by the
//             HASH_MISMATCH the same edit necessarily causes downstream.
//   Phase B — cryptography: prev_hash linkage, then current_hash
//             recomputation. The FIRST offending index in chain order wins,
//             because everything after a break is suspect, not broken.
//   Phase C — witness: the local entry at the newest receipt's index must
//             still carry the receipt's hash. A root attacker who rewrites
//             history AND recomputes every hash passes A and B — the witness
//             receipt, held under separate custody, is what catches them.
//
// verifyLedger() is pure: it reads the database, and optionally
// caller-supplied independent witness receipts, and never touches the
// network. Live witness fetching belongs to the caller (anchor.ts); the
// verifier only compares.

import type { GridVaultDatabase } from '../db/connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import { GENESIS_PREV_HASH, hashLedgerEntry } from '../crypto/hash.js';
import {
  chainAnchorsRepository,
  type AuditLogRow
} from '../db/repositories/ledger.js';
import type { AnchorReceipt } from './anchor.js';

export type LedgerStatus = 'HEALTHY' | 'TAMPERED' | 'TRUNCATED' | 'WITNESS_DIVERGED';

export type FailureKind =
  | 'HASH_MISMATCH'
  | 'CHAIN_BREAK'
  | 'INDEX_GAP'
  | 'INDEX_DUPLICATE'
  | 'TIMESTAMP_REGRESSION'
  | 'WITNESS_MISMATCH';

export type WitnessStatus =
  | 'ANCHORED'
  | 'ANCHOR_PENDING'
  | 'NO_ANCHOR'
  | 'WITNESS_DIVERGED'
  | 'UNREACHABLE';

export interface WitnessDivergence {
  at_index: number;
  expected_hash: string;
  actual_hash: string;
}

export interface WitnessInfo {
  status: WitnessStatus;
  last_anchor_index: number | null;
  last_anchor_at: string | null;
  divergence: WitnessDivergence | null;
}

export interface VerifyReport {
  status: LedgerStatus;
  total_records: number;
  broken_at_index: number | null;
  failure_kind: FailureKind | null;
  head_hash: string | null;
  witness: WitnessInfo;
  verified_at: string;
  duration_ms: number;
}

export interface VerifyOptions {
  clock?: Clock;
  timeZone?: string;
  /**
   * Independent receipts fetched from the witness service itself (not from
   * the local chain_anchors table, which a root attacker can rewrite). When
   * omitted, the newest locally ACKNOWLEDGED anchor is used.
   */
  witnessReceipts?: AnchorReceipt[];
  /** The caller tried to reach the witness and failed: report UNREACHABLE, keep the local verdict. */
  witnessUnreachable?: boolean;
}

type SlimRow = Pick<AuditLogRow, 'log_index' | 'timestamp'>;

type StructuralKind = 'INDEX_GAP' | 'INDEX_DUPLICATE' | 'TIMESTAMP_REGRESSION';

interface WitnessView {
  chain_head_index: number;
  chain_head_hash: string;
  anchored_at: string;
}

/** Phase A: dense 1-based indices and non-decreasing timestamps. */
function verifyStructure(rows: Iterable<SlimRow>): { kind: StructuralKind; at: number } | null {
  let expected = 1;
  let prevTime = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.log_index < expected) {
      return { kind: 'INDEX_DUPLICATE', at: row.log_index };
    }
    if (row.log_index > expected) {
      return { kind: 'INDEX_GAP', at: expected };
    }
    const time = Date.parse(row.timestamp);
    if (Number.isNaN(time) || time < prevTime) {
      // Unparseable timestamps fail closed: a ledger whose timeline cannot
      // be ordered cannot be trusted.
      return { kind: 'TIMESTAMP_REGRESSION', at: row.log_index };
    }
    prevTime = time;
    expected += 1;
  }
  return null;
}

type ChainKind = 'CHAIN_BREAK' | 'HASH_MISMATCH';

interface ChainOk {
  total_records: number;
  head_hash: string | null;
  /** Sparse index of verified rows, for the witness phase without a third pass. */
  byIndex: Map<number, string>;
}

/**
 * Phase B: linkage then recomputation, first offending index wins.
 * Records the current_hash of every row at an anchored index so Phase C
 * needs no extra database pass.
 */
function verifyChain(
  rows: Iterable<AuditLogRow>,
  anchoredIndices: ReadonlySet<number>
): { kind: ChainKind; at: number } | ChainOk {
  let prevHash = GENESIS_PREV_HASH;
  let headHash: string | null = null;
  let total = 0;
  const byIndex = new Map<number, string>();
  for (const row of rows) {
    if (row.prev_hash !== prevHash) {
      return { kind: 'CHAIN_BREAK', at: row.log_index };
    }
    let recomputed: string;
    try {
      recomputed = hashLedgerEntry({
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
        prev_hash: row.prev_hash
      });
    } catch {
      // Forged details that are not even JSON: the row cannot authenticate.
      return { kind: 'HASH_MISMATCH', at: row.log_index };
    }
    if (recomputed !== row.current_hash) {
      return { kind: 'HASH_MISMATCH', at: row.log_index };
    }
    prevHash = row.current_hash;
    headHash = row.current_hash;
    total += 1;
    if (anchoredIndices.has(row.log_index)) {
      byIndex.set(row.log_index, row.current_hash);
    }
  }
  return { total_records: total, head_hash: headHash, byIndex };
}

function baseWitness(views: WitnessView[], pendingAnchorCount: number): WitnessInfo {
  let newest: WitnessView | undefined;
  for (const view of views) {
    if (newest === undefined || view.chain_head_index > newest.chain_head_index) {
      newest = view;
    }
  }
  if (newest !== undefined) {
    return {
      status: 'ANCHORED',
      last_anchor_index: newest.chain_head_index,
      last_anchor_at: newest.anchored_at,
      divergence: null
    };
  }
  if (pendingAnchorCount > 0) {
    return { status: 'ANCHOR_PENDING', last_anchor_index: null, last_anchor_at: null, divergence: null };
  }
  return { status: 'NO_ANCHOR', last_anchor_index: null, last_anchor_at: null, divergence: null };
}

interface CoreInputs {
  structureRows: () => Iterable<SlimRow>;
  chainRows: () => Iterable<AuditLogRow>;
  witnessViews: WitnessView[];
  pendingAnchorCount: number;
  options: VerifyOptions;
}

function runVerify(inputs: CoreInputs): VerifyReport {
  const started = Date.now();
  const clock = inputs.options.clock ?? systemClock;
  const timeZone = inputs.options.timeZone ?? 'Africa/Lagos';
  const unreachable: WitnessInfo = {
    status: 'UNREACHABLE',
    last_anchor_index: null,
    last_anchor_at: null,
    divergence: null
  };
  const witnessOf = (info: WitnessInfo): WitnessInfo =>
    inputs.options.witnessUnreachable === true ? unreachable : info;
  const stamp = (): { verified_at: string; duration_ms: number } => ({
    verified_at: formatIsoWithOffset(clock.now(), timeZone),
    duration_ms: Date.now() - started
  });

  const structural = verifyStructure(inputs.structureRows());
  if (structural !== null) {
    return {
      status: structural.kind === 'INDEX_GAP' ? 'TRUNCATED' : 'TAMPERED',
      total_records: 0,
      broken_at_index: structural.at,
      failure_kind: structural.kind,
      head_hash: null,
      witness: witnessOf({
        ...baseWitness(inputs.witnessViews, inputs.pendingAnchorCount),
        divergence: null
      }),
      ...stamp()
    };
  }

  const anchored = new Set(inputs.witnessViews.map((view) => view.chain_head_index));
  const chain = verifyChain(inputs.chainRows(), anchored);
  if (!('total_records' in chain)) {
    return {
      status: 'TAMPERED',
      total_records: chain.at - 1,
      broken_at_index: chain.at,
      failure_kind: chain.kind,
      head_hash: null,
      witness: witnessOf({
        ...baseWitness(inputs.witnessViews, inputs.pendingAnchorCount),
        divergence: null
      }),
      ...stamp()
    };
  }

  // Phase C — the newest receipt must still match the local entry.
  let newest: WitnessView | undefined;
  for (const view of inputs.witnessViews) {
    if (newest === undefined || view.chain_head_index > newest.chain_head_index) {
      newest = view;
    }
  }
  if (newest !== undefined) {
    const actual = chain.byIndex.get(newest.chain_head_index) ?? null;
    if (actual !== newest.chain_head_hash) {
      return {
        status: 'WITNESS_DIVERGED',
        total_records: chain.total_records,
        broken_at_index: newest.chain_head_index,
        failure_kind: 'WITNESS_MISMATCH',
        head_hash: chain.head_hash,
        witness: {
          status: inputs.options.witnessUnreachable === true ? 'UNREACHABLE' : 'WITNESS_DIVERGED',
          last_anchor_index: newest.chain_head_index,
          last_anchor_at: newest.anchored_at,
          divergence: {
            at_index: newest.chain_head_index,
            expected_hash: newest.chain_head_hash,
            actual_hash: actual ?? 'MISSING'
          }
        },
        ...stamp()
      };
    }
  }

  return {
    status: 'HEALTHY',
    total_records: chain.total_records,
    broken_at_index: null,
    failure_kind: null,
    head_hash: chain.head_hash,
    witness: witnessOf({
      ...baseWitness(inputs.witnessViews, inputs.pendingAnchorCount),
      divergence: null
    }),
    ...stamp()
  };
}

/**
 * Verify the database ledger. Both passes stream (O(1) memory); the witness
 * phase reuses hashes captured during Phase B, so there is no third pass.
 */
export function verifyLedger(db: GridVaultDatabase, options: VerifyOptions = {}): VerifyReport {
  const witnessViews: WitnessView[] =
    options.witnessReceipts !== undefined
      ? options.witnessReceipts.map((receipt) => ({
          chain_head_index: receipt.chain_head_index,
          chain_head_hash: receipt.chain_head_hash,
          anchored_at: receipt.anchored_at
        }))
      : chainAnchorsRepository(db)
          .listByStatus('ACKNOWLEDGED')
          .map((row) => ({
            chain_head_index: row.chain_head_index,
            chain_head_hash: row.chain_head_hash,
            anchored_at: row.anchored_at
          }));
  const pendingAnchorCount = chainAnchorsRepository(db).listByStatus('PENDING').length;
  return runVerify(
    {
      structureRows: () =>
        db
          .prepare('SELECT log_index, timestamp FROM audit_logs ORDER BY log_index ASC')
          .iterate() as Iterable<SlimRow>,
      chainRows: () =>
        db.prepare('SELECT * FROM audit_logs ORDER BY log_index ASC').iterate() as Iterable<AuditLogRow>,
      witnessViews,
      pendingAnchorCount,
      options
    }
  );
}

/**
 * Verify an in-memory row sequence (the export-file path). Same verdicts as
 * verifyLedger; takes rows instead of a database handle so the offline
 * verifier provably needs neither DB nor network.
 */
export function verifyRowSequence(
  rows: AuditLogRow[],
  witnessViews: WitnessView[],
  pendingAnchorCount: number,
  options: VerifyOptions = {}
): VerifyReport {
  return runVerify({ structureRows: () => rows, chainRows: () => rows, witnessViews, pendingAnchorCount, options });
}
