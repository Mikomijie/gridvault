// GridVault ledger entry hashing (PRD section 8.3).
//
// canonical(entry) = JSON of an ordered array, UTF-8, no insignificant
// whitespace:
//   [ "gridvault.audit.v2",        // domain separator — prevents cross-context hash reuse
//     log_index, timestamp, staff_id, staff_role, ward, patient_id,
//     action, canonical_json(details), session_id, terminal_id, source_ip, prev_hash ]
//
// current_hash = SHA256( canonical(entry) )   // lowercase hex
//
// This replaces v1's pipe-delimited concatenation, under which
// details = "a|b" and the adjacent fields could be rearranged to produce an
// identical payload — a forgery that verification would have accepted. A
// JSON array has no delimiter ambiguity: AT-303 pins this with hostile
// details content.

import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

/** Domain separator for ledger entry hashes. Part of the digest, not metadata. */
export const LEDGER_HASH_DOMAIN = 'gridvault.audit.v2';

/** prev_hash of the genesis entry (log_index = 1). */
export const GENESIS_PREV_HASH = '0'.repeat(64);

export interface HashableLedgerEntry {
  log_index: number;
  timestamp: string;
  staff_id: string;
  staff_role: string;
  ward: string;
  patient_id: string;
  action: string;
  /** The details value (object) or its stored canonical-JSON text form. */
  details: unknown;
  session_id: string | null;
  terminal_id: string | null;
  source_ip: string | null;
  prev_hash: string;
}

/**
 * Normalize a details value to its stored canonical-JSON text form.
 * Accepts the value or its already-serialized form (which must parse, so a
 * forged non-JSON details string fails closed here instead of hashing
 * silently).
 */
export function normalizeDetails(details: unknown): string {
  if (typeof details === 'string') {
    // Throws SyntaxError on non-JSON input: the caller converts this into a
    // HASH_MISMATCH verdict, never a hash over garbage.
    const parsed: unknown = JSON.parse(details);
    return canonicalJson(parsed);
  }
  return canonicalJson(details);
}

/**
 * The exact canonical payload whose SHA-256 is the entry's current_hash.
 * A fixed JSON array (not string concatenation): field order is structural,
 * so hostile content in one field can never be mistaken for another.
 */
export function canonicalLedgerPayload(entry: HashableLedgerEntry): string {
  const detailsValue: unknown =
    typeof entry.details === 'string' ? (JSON.parse(entry.details) as unknown) : entry.details;
  return canonicalJson([
    LEDGER_HASH_DOMAIN,
    entry.log_index,
    entry.timestamp,
    entry.staff_id,
    entry.staff_role,
    entry.ward,
    entry.patient_id,
    entry.action,
    detailsValue,
    entry.session_id,
    entry.terminal_id,
    entry.source_ip,
    entry.prev_hash
  ]);
}

/** SHA-256 of the canonical payload, lowercase hex. */
export function hashLedgerEntry(entry: HashableLedgerEntry): string {
  return createHash('sha256').update(canonicalLedgerPayload(entry), 'utf8').digest('hex');
}
