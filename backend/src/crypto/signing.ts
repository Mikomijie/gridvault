// GridVault Ed25519 signing for anchor receipts (PRD section 8.6).
//
// The node signs each anchor receipt with NODE_SIGNING_KEY so the witness —
// and any third-party auditor holding the node's public key — can prove the
// receipt came from this facility's node and was not fabricated. The signed
// bytes are canonical JSON over a dedicated anchor domain separator, so a
// ledger-entry hash can never be mistaken for an anchor signature input.

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from 'node:crypto';
import { canonicalJson } from './canonical-json.js';

/** Domain separator for anchor-receipt signatures. Distinct from the ledger hash domain. */
export const ANCHOR_SIGN_DOMAIN = 'gridvault.anchor.v1';

export class SigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SigningError';
  }
}

/** The receipt fields covered by the node signature (everything but the signature itself). */
export interface AnchorSignableFields {
  facility_id: string;
  chain_head_index: number;
  chain_head_hash: string;
  entry_count: number;
  anchored_at: string;
}

/** Exact bytes covered by node_signature. Rebuilt independently by auditors. */
export function anchorSigningPayload(fields: AnchorSignableFields): Buffer {
  const payload = canonicalJson([
    ANCHOR_SIGN_DOMAIN,
    fields.facility_id,
    fields.chain_head_index,
    fields.chain_head_hash,
    fields.entry_count,
    fields.anchored_at
  ]);
  return Buffer.from(payload, 'utf8');
}

/** Parse an Ed25519 PKCS8 DER private key (base64, as stored in NODE_SIGNING_KEY). Fails closed. */
export function parseNodeSigningKey(derBase64: string): KeyObject {
  // Buffer.from with a string input never throws (invalid characters are
  // skipped); empty and malformed payloads fail closed on the length and
  // key-type checks below. There is deliberately no try/catch here: an
  // untestable branch would violate the NFR-10 100%-branch gate on crypto.
  const der = Buffer.from(derBase64.trim(), 'base64');
  if (der.byteLength === 0) {
    throw new SigningError('NODE_SIGNING_KEY is empty');
  }
  try {
    const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') {
      // No ?? fallback: createPrivateKey only yields asymmetric keys, so
      // the type-level undefined is unreachable and an untestable branch
      // would violate the NFR-10 100%-branch gate on crypto.
      throw new SigningError(`NODE_SIGNING_KEY must be an Ed25519 key, got ${String(key.asymmetricKeyType)}`);
    }
    return key;
  } catch (error) {
    if (error instanceof SigningError) {
      throw error;
    }
    // Uniform String(): Node's key parser only throws Error instances, so a
    // separate String() fallback arm would be untestable. String() still
    // names Error causes ('Error: ...') and stays loud for anything else.
    throw new SigningError(`NODE_SIGNING_KEY is not a valid Ed25519 PKCS8 key: ${String(error)}`);
  }
}

/** Derive the public key (SPKI DER, base64) for distribution to auditors. */
export function nodePublicKeyDerB64(privateKey: KeyObject): string {
  return createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
}

/** Sign anchor fields. Returns the `ed25519:<base64>` value stored as node_signature. */
export function signAnchor(fields: AnchorSignableFields, privateKey: KeyObject): string {
  const signature = sign(null, anchorSigningPayload(fields), privateKey);
  return `ed25519:${signature.toString('base64')}`;
}

/** Verify a node_signature against anchor fields and a public key. Never throws: false means forged. */
export function verifyAnchorSignature(
  fields: AnchorSignableFields,
  nodeSignature: string,
  publicKey: KeyObject
): boolean {
  const prefix = 'ed25519:';
  if (!nodeSignature.startsWith(prefix)) {
    return false;
  }
  // Buffer.from(string, 'base64') never throws for string input — it skips
  // invalid characters — so malformed input fails the length check below,
  // which is the real guard.
  const signature = Buffer.from(nodeSignature.slice(prefix.length).trim(), 'base64');
  // Ed25519 signatures are exactly 64 bytes; anything else is malformed.
  if (signature.byteLength !== 64) {
    return false;
  }
  try {
    return verify(null, anchorSigningPayload(fields), publicKey, signature);
  } catch {
    return false;
  }
}

/** Generate a fresh Ed25519 node keypair. Operator tooling only (tests, provisioning). */
export function generateNodeSigningKeypair(): { privateDerB64: string; publicDerB64: string } {
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateDerB64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  return { privateDerB64, publicDerB64: nodePublicKeyDerB64(privateKey) };
}
