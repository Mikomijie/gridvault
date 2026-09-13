// GridVault anchor service (PRD section 8.6).
//
// Every ANCHOR_INTERVAL_MINUTES (60 prod, 5 demo) — and on every
// EMERGENCY_OVERRIDE_GRANTED — the node signs its chain head with
// NODE_SIGNING_KEY and submits the receipt to the external witness, which
// holds it under separate custody. A root attacker who rewrites history and
// recomputes every hash still cannot rewrite the witness's copy, so the
// next verification reports WITNESS_DIVERGED instead of HEALTHY.
//
// Anchoring never blocks clinical work: the receipt row is inserted as
// PENDING in a short synchronous transaction, the network POST happens with
// no database transaction held, and any delivery failure leaves the row
// PENDING for retry while the ledger keeps appending.

import { v7 as uuidv7 } from 'uuid';
import type { KeyObject } from 'node:crypto';
import type { GridVaultDatabase } from '../db/connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import { signAnchor } from '../crypto/signing.js';
import { appendLedgerEntry } from './append.js';
import {
  chainAnchorsRepository,
  type AnchorStatus,
  type ChainAnchorRow
} from '../db/repositories/ledger.js';

export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnchorError';
  }
}

/**
 * The wire format submitted to the witness and stored in chain_anchors.
 * Field names match PRD section 8.6 verbatim so auditors can compare the
 * receipt against the ledger without a translation table.
 */
export interface AnchorReceipt {
  receipt_id: string;
  facility_id: string;
  chain_head_index: number;
  chain_head_hash: string;
  entry_count: number;
  anchored_at: string;
  node_signature: string;
}

export interface WitnessAck {
  receipt_id: string;
  witness_ack: string;
  witnessed_at: string;
}

export type AnchorSettlement = 'ACKNOWLEDGED' | 'PENDING';

export interface AnchorResult {
  receipt: AnchorReceipt;
  status: AnchorSettlement;
  /** Present only when the witness could not be reached. Never PHI. */
  delivery_error: string | null;
  witness_ack: WitnessAck | null;
}

export interface AnchorServiceConfig {
  facilityId: string;
  witnessUrl: string;
  witnessApiKey: string;
  nodeSigningKey: KeyObject;
  clock?: Clock;
  timeZone?: string;
  /** Per-attempt network timeout. Defaults to 5000 ms. */
  fetchTimeoutMs?: number;
}

/** Injectable delivery for tests: production uses HTTP, tests use fakes or a live ephemeral witness. */
export type AnchorDeliver = (receipt: AnchorReceipt) => Promise<WitnessAck>;

export interface AnchorRunOptions {
  clock?: Clock;
  timeZone?: string;
  deliver?: AnchorDeliver;
  /** Skip the CHAIN_ANCHORED ledger entry (tests that count entries exactly). */
  skipLedgerEntry?: boolean;
}

interface ChainHead {
  log_index: number;
  current_hash: string;
}

function readChainHead(db: GridVaultDatabase): ChainHead {
  const head = db
    .prepare('SELECT log_index, current_hash FROM audit_logs ORDER BY log_index DESC LIMIT 1')
    .get() as ChainHead | undefined;
  if (head === undefined) {
    throw new AnchorError('Cannot anchor an empty ledger: no audit_logs rows yet');
  }
  return head;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new AnchorError(`anchor.${field} must be a non-empty string`);
  }
}

/**
 * Build and sign a receipt for the current chain head. Reads the database
 * but writes nothing, so callers can inspect or dry-run before recording.
 */
export function createAnchorReceipt(
  db: GridVaultDatabase,
  input: {
    facilityId: string;
    privateKey: KeyObject;
    anchoredAt: string;
    receiptId?: string;
  }
): AnchorReceipt {
  requireNonEmpty(input.facilityId, 'facility_id');
  if (input.anchoredAt.trim().length === 0 || Number.isNaN(Date.parse(input.anchoredAt))) {
    throw new AnchorError('anchor.anchored_at must be a parseable ISO-8601 instant');
  }
  const head = readChainHead(db);
  const receiptId = input.receiptId ?? `anc_${uuidv7().replace(/-/g, '')}`;
  requireNonEmpty(receiptId, 'receipt_id');
  const nodeSignature = signAnchor(
    {
      facility_id: input.facilityId,
      chain_head_index: head.log_index,
      chain_head_hash: head.current_hash,
      entry_count: head.log_index,
      anchored_at: input.anchoredAt
    },
    input.privateKey
  );
  return {
    receipt_id: receiptId,
    facility_id: input.facilityId,
    chain_head_index: head.log_index,
    chain_head_hash: head.current_hash,
    entry_count: head.log_index,
    anchored_at: input.anchoredAt,
    node_signature: nodeSignature
  };
}

function validateWitnessAck(body: unknown, receiptId: string): WitnessAck {
  if (typeof body !== 'object' || body === null) {
    throw new AnchorError('Witness returned a malformed acknowledgement: not an object');
  }
  const record = body as Record<string, unknown>;
  if (record['receipt_id'] !== receiptId) {
    throw new AnchorError('Witness acknowledgement receipt_id does not match the submitted receipt');
  }
  if (typeof record['witness_ack'] !== 'string' || (record['witness_ack'] as string).length === 0) {
    throw new AnchorError('Witness acknowledgement is missing witness_ack');
  }
  if (
    typeof record['witnessed_at'] !== 'string' ||
    Number.isNaN(Date.parse(record['witnessed_at'] as string))
  ) {
    throw new AnchorError('Witness acknowledgement carries an invalid witnessed_at');
  }
  return {
    receipt_id: receiptId,
    witness_ack: record['witness_ack'] as string,
    witnessed_at: record['witnessed_at'] as string
  };
}

/** Production delivery: POST the receipt to the witness anchor store. Throws AnchorError on any failure. */
export function makeWitnessDeliver(config: AnchorServiceConfig): AnchorDeliver {
  return async (receipt: AnchorReceipt): Promise<WitnessAck> => {
    const url = `${config.witnessUrl.replace(/\/+$/, '')}/anchors`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.witnessApiKey}`
        },
        body: JSON.stringify(receipt),
        signal: AbortSignal.timeout(config.fetchTimeoutMs ?? 5000)
      });
    } catch (error) {
      throw new AnchorError(
        `Witness unreachable at ${config.witnessUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!response.ok) {
      throw new AnchorError(`Witness rejected the anchor receipt: HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      throw new AnchorError('Witness returned a non-JSON acknowledgement');
    }
    return validateWitnessAck(body, receipt.receipt_id);
  };
}

export interface WitnessFetchConfig {
  witnessUrl: string;
  witnessApiKey: string;
  /** Per-attempt network timeout. Defaults to 5000 ms. */
  fetchTimeoutMs?: number;
}

/**
 * Fetch independently-held receipts from the witness for divergence
 * comparison. Throws AnchorError when the witness cannot be reached; the
 * caller decides whether that is fatal (offline verifier) or degraded
 * (status console showing anchor lag).
 */
export async function fetchWitnessReceipts(config: WitnessFetchConfig): Promise<AnchorReceipt[]> {
  const url = `${config.witnessUrl.replace(/\/+$/, '')}/anchors`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.witnessApiKey}` },
      signal: AbortSignal.timeout(config.fetchTimeoutMs ?? 5000)
    });
  } catch (error) {
    throw new AnchorError(
      `Witness unreachable at ${config.witnessUrl}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    throw new AnchorError(`Witness receipt fetch failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as unknown;
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { receipts?: unknown }).receipts)) {
    throw new AnchorError('Witness returned a malformed receipt list');
  }
  return (body as { receipts: AnchorReceipt[] }).receipts;
}

export interface AnchorHistory {
  receipts: ChainAnchorRow[];
  pending: number;
  latest: ChainAnchorRow | null;
}

/**
 * Receipt history for the security console and GET /api/audit/anchors.
 * Routes call this service — never the repository — per the architecture
 * lint rule.
 */
export function getAnchorHistory(db: GridVaultDatabase): AnchorHistory {
  const repo = chainAnchorsRepository(db);
  const acknowledged = repo.listByStatus('ACKNOWLEDGED');
  const pending = repo.listByStatus('PENDING');
  const failed = repo.listByStatus('FAILED');
  const receipts = [...acknowledged, ...pending, ...failed].sort(
    (a, b) => a.chain_head_index - b.chain_head_index
  );
  return {
    receipts,
    pending: pending.length,
    latest: repo.latest() ?? null
  };
}

/**
 * Anchor the current chain head: record a PENDING receipt, attempt delivery,
 * settle to ACKNOWLEDGED on success, and append a CHAIN_ANCHORED ledger
 * entry naming the outcome. Delivery failure never throws — the receipt
 * stays PENDING for retry and the result carries the error — so a dead
 * witness cannot stop clinical work.
 */
export async function anchorLedger(
  db: GridVaultDatabase,
  config: AnchorServiceConfig,
  options: AnchorRunOptions = {}
): Promise<AnchorResult> {
  requireNonEmpty(config.facilityId, 'facility_id');
  requireNonEmpty(config.witnessUrl, 'witness_url');
  const clock = options.clock ?? config.clock ?? systemClock;
  const timeZone = options.timeZone ?? config.timeZone ?? 'Africa/Lagos';
  const anchoredAt = formatIsoWithOffset(clock.now(), timeZone);

  const receipt = createAnchorReceipt(db, {
    facilityId: config.facilityId,
    privateKey: config.nodeSigningKey,
    anchoredAt
  });
  chainAnchorsRepository(db).insert({
    receipt_id: receipt.receipt_id,
    facility_id: receipt.facility_id,
    chain_head_index: receipt.chain_head_index,
    chain_head_hash: receipt.chain_head_hash,
    entry_count: receipt.entry_count,
    anchored_at: receipt.anchored_at,
    node_signature: receipt.node_signature,
    witness_ack: null,
    witness_acked_at: null,
    status: 'PENDING'
  });

  const deliver = options.deliver ?? makeWitnessDeliver(config);
  let status: AnchorStatus = 'PENDING';
  let ack: WitnessAck | null = null;
  let deliveryError: string | null = null;
  try {
    ack = await deliver(receipt);
    chainAnchorsRepository(db).settle(receipt.receipt_id, {
      status: 'ACKNOWLEDGED',
      witness_ack: ack.witness_ack,
      witness_acked_at: ack.witnessed_at
    });
    status = 'ACKNOWLEDGED';
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : String(error);
  }

  if (options.skipLedgerEntry !== true) {
    // The anchor event is itself audited. details carries identifiers and
    // the outcome — never PHI, never key material, never the API key.
    appendLedgerEntry(
      db,
      {
        staff_id: 'SYSTEM',
        staff_role: 'system',
        ward: 'system',
        patient_id: 'SYSTEM',
        action: 'CHAIN_ANCHORED',
        details: {
          receipt_id: receipt.receipt_id,
          chain_head_index: receipt.chain_head_index,
          chain_head_hash: receipt.chain_head_hash,
          facility_id: receipt.facility_id,
          witness_status: status
        },
        timestamp: anchoredAt
      },
      { clock, timeZone }
    );
  }

  return {
    receipt,
    status,
    delivery_error: deliveryError,
    witness_ack: ack
  };
}
