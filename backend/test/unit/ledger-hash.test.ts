import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GENESIS_PREV_HASH,
  LEDGER_HASH_DOMAIN,
  canonicalLedgerPayload,
  hashLedgerEntry,
  type HashableLedgerEntry
} from '../../src/crypto/hash.js';

function genesisEntry(): HashableLedgerEntry {
  return {
    log_index: 1,
    timestamp: '2026-09-13T11:00:00.000+01:00',
    staff_id: 'SYSTEM',
    staff_role: 'system',
    ward: 'system',
    patient_id: 'SYSTEM',
    action: 'CHAIN_VERIFIED',
    details: { note: 'genesis' },
    session_id: null,
    terminal_id: null,
    source_ip: null,
    prev_hash: GENESIS_PREV_HASH
  };
}

describe('ledger hashing', () => {
  it('AT-301: genesis entry uses 64 zeros as prev_hash and SHA-256 of the canonical payload', () => {
    expect(GENESIS_PREV_HASH).toBe('0'.repeat(64));

    // Independently hand-written expectation: the exact canonical payload
    // bytes for the fixture above, spelled out literally (not produced by
    // the implementation), hashed with node:crypto directly.
    const expectedPayload =
      '["gridvault.audit.v2",1,"2026-09-13T11:00:00.000+01:00","SYSTEM","system",' +
      '"system","SYSTEM","CHAIN_VERIFIED",{"note":"genesis"},null,null,null,' +
      '"0000000000000000000000000000000000000000000000000000000000000000"]';
    expect(canonicalLedgerPayload(genesisEntry())).toBe(expectedPayload);

    const independentDigest = createHash('sha256').update(expectedPayload, 'utf8').digest('hex');
    expect(hashLedgerEntry(genesisEntry())).toBe(independentDigest);
    expect(hashLedgerEntry(genesisEntry())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('AT-302: the hash includes the gridvault.audit.v2 domain separator', () => {
    expect(LEDGER_HASH_DOMAIN).toBe('gridvault.audit.v2');
    expect(canonicalLedgerPayload(genesisEntry()).startsWith('["gridvault.audit.v2",')).toBe(true);

    const withDomain = hashLedgerEntry(genesisEntry());
    // The same entry hashed without the domain separator (a cross-context
    // reuse of the payload) must produce a different digest.
    const payload = JSON.parse(canonicalLedgerPayload(genesisEntry())) as unknown[];
    const withoutDomain = createHash('sha256')
      .update(JSON.stringify(payload.slice(1)), 'utf8')
      .digest('hex');
    expect(withDomain).not.toBe(withoutDomain);
  });
});
