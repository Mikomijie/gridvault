// GridVault witness receipt validation.
//
// Hand-rolled strict checks (not a schema library) so the trust boundary
// reads as a checklist: every field of an inbound anchor receipt is
// type-checked, range-checked and format-checked before it touches the
// store. Anything malformed is rejected with a named code — never stored,
// never echoed back beyond its receipt_id.

export interface InboundAnchorReceipt {
  receipt_id: string;
  facility_id: string;
  chain_head_index: number;
  chain_head_hash: string;
  entry_count: number;
  anchored_at: string;
  node_signature: string;
}

export type ReceiptRejection = 'INVALID_RECEIPT' | 'DUPLICATE_RECEIPT' | 'STALE_RECEIPT';

export class ReceiptValidationError extends Error {
  readonly code: ReceiptRejection;
  constructor(code: ReceiptRejection, message: string) {
    super(message);
    this.name = 'ReceiptValidationError';
    this.code = code;
  }
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isValidNodeSignature(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('ed25519:')) {
    return false;
  }
  try {
    const raw = Buffer.from(value.slice('ed25519:'.length).trim(), 'base64');
    return raw.byteLength === 64;
  } catch {
    return false;
  }
}

/** Structural validation only: the witness stores receipts, it does not hold the node's public key. */
export function validateAnchorReceipt(body: unknown): InboundAnchorReceipt {
  if (typeof body !== 'object' || body === null) {
    throw new ReceiptValidationError('INVALID_RECEIPT', 'Anchor receipt must be a JSON object');
  }
  const record = body as Record<string, unknown>;
  if (!isNonEmptyString(record['receipt_id'], 128)) {
    throw new ReceiptValidationError('INVALID_RECEIPT', 'receipt_id must be a non-empty string');
  }
  if (!isNonEmptyString(record['facility_id'], 128)) {
    throw new ReceiptValidationError('INVALID_RECEIPT', 'facility_id must be a non-empty string');
  }
  if (!Number.isInteger(record['chain_head_index']) || (record['chain_head_index'] as number) < 1) {
    throw new ReceiptValidationError(
      'INVALID_RECEIPT',
      'chain_head_index must be a positive integer'
    );
  }
  if (!isHex64(record['chain_head_hash'])) {
    throw new ReceiptValidationError('INVALID_RECEIPT', 'chain_head_hash must be 64 lowercase hex chars');
  }
  if (!Number.isInteger(record['entry_count']) || (record['entry_count'] as number) < 1) {
    throw new ReceiptValidationError('INVALID_RECEIPT', 'entry_count must be a positive integer');
  }
  // The ledger is dense from index 1, so a well-formed anchor always has
  // entry_count == chain_head_index. Anything else is a malformed or
  // hostile receipt, not a rounding choice.
  if (record['entry_count'] !== record['chain_head_index']) {
    throw new ReceiptValidationError(
      'INVALID_RECEIPT',
      'entry_count must equal chain_head_index for a dense ledger'
    );
  }
  if (typeof record['anchored_at'] !== 'string' || Number.isNaN(Date.parse(record['anchored_at']))) {
    throw new ReceiptValidationError('INVALID_RECEIPT', 'anchored_at must be a parseable instant');
  }
  if (!isValidNodeSignature(record['node_signature'])) {
    throw new ReceiptValidationError(
      'INVALID_RECEIPT',
      "node_signature must be 'ed25519:' followed by a 64-byte base64 signature"
    );
  }
  return {
    receipt_id: record['receipt_id'] as string,
    facility_id: record['facility_id'] as string,
    chain_head_index: record['chain_head_index'] as number,
    chain_head_hash: record['chain_head_hash'] as string,
    entry_count: record['entry_count'] as number,
    anchored_at: record['anchored_at'] as string,
    node_signature: record['node_signature'] as string
  };
}
