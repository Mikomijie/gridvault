// Ledger fail-closed and branch-coverage tests (no AT ids: these pin the
// defensive branches around AT-301..AT-315 so the NFR-10 100%-branch goal
// for ledger/crypto stays within reach).
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import { createApp } from '../../src/http/app.js';
import { appendLedgerEntry, LedgerError } from '../../src/ledger/append.js';
import {
  AnchorError,
  anchorLedger,
  createAnchorReceipt,
  fetchWitnessReceipts,
  makeWitnessDeliver
} from '../../src/ledger/anchor.js';
import { exportLedger, verifyExportFile } from '../../src/ledger/export.js';
import { demoTamper } from '../../src/ledger/tamper.js';
import {
  generateNodeSigningKeypair,
  nodePublicKeyDerB64,
  parseNodeSigningKey,
  signAnchor,
  SigningError,
  verifyAnchorSignature
} from '../../src/crypto/signing.js';
import { normalizeDetails } from '../../src/crypto/hash.js';
import { verifyRowSequence } from '../../src/ledger/verify.js';
import type { AuditLogRow } from '../../src/db/repositories/ledger.js';
import { openDatabase, type GridVaultDatabase } from '../../src/db/connection.js';
import { migrateTestDb, openTestDb } from '../helpers/db.js';

const BASE_MS = Date.parse('2026-09-13T10:00:00.000+01:00');
const isoAt = (seconds: number): string => new Date(BASE_MS + seconds * 1000).toISOString();

function seedThree(db: GridVaultDatabase): AuditLogRow[] {
  const run = db.transaction(() => {
    for (let i = 0; i < 3; i++) {
      appendLedgerEntry(db, {
        staff_id: 'GV-9042',
        staff_role: 'doctor',
        ward: 'icu',
        patient_id: 'SYSTEM',
        action: 'LOGIN',
        details: { seq: i + 1 },
        timestamp: isoAt(i)
      });
    }
  });
  run();
  return db.prepare('SELECT * FROM audit_logs ORDER BY log_index ASC').all() as AuditLogRow[];
}

describe('ledger defensive branches', () => {
  it('append fails closed on unknown actions, empty fields, bad timestamps and unserializable details', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      const base = {
        staff_id: 'GV-9042',
        staff_role: 'doctor',
        ward: 'icu',
        patient_id: 'SYSTEM',
        action: 'LOGIN',
        details: { seq: 1 },
        timestamp: isoAt(0)
      };
      expect(() => appendLedgerEntry(db, { ...base, action: 'HACK_THE_PLANET' })).toThrowError(LedgerError);
      expect(() => appendLedgerEntry(db, { ...base, staff_id: '   ' })).toThrowError(LedgerError);
      expect(() => appendLedgerEntry(db, { ...base, timestamp: 'not-a-date' })).toThrowError(LedgerError);
      expect(() => appendLedgerEntry(db, { ...base, details: { v: Number.NaN } })).toThrowError(LedgerError);
      expect(() => normalizeDetails('this is not json{{{')).toThrowError(SyntaxError);
      expect(normalizeDetails({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
      expect(normalizeDetails('{"b":1,"a":2}')).toBe('{"a":2,"b":1}');
    } finally {
      db.close();
    }
  });

  it('signing fails closed on bad keys and forged signatures', () => {
    expect(() => parseNodeSigningKey('')).toThrowError(SigningError);
    expect(() => parseNodeSigningKey('!!!not-base64!!!')).toThrowError(SigningError);
    // A valid key of the wrong type (RSA, not Ed25519) is refused by name.
    const { privateKey: rsa } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaB64 = rsa.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    expect(() => parseNodeSigningKey(rsaB64)).toThrowError(/Ed25519/);

    const { privateDerB64, publicDerB64 } = generateNodeSigningKeypair();
    expect(publicDerB64.length).toBeGreaterThan(0);
    const privateKey = parseNodeSigningKey(privateDerB64);
    expect(nodePublicKeyDerB64(privateKey)).toBe(publicDerB64);
    const fields = {
      facility_id: 'lasuth-ikeja',
      chain_head_index: 5,
      chain_head_hash: 'a'.repeat(64),
      entry_count: 5,
      anchored_at: isoAt(0)
    };
    const publicKey = createPublicKey({
      key: Buffer.from(publicDerB64, 'base64'),
      format: 'der',
      type: 'spki'
    });
    const good = signAnchor(fields, privateKey);
    expect(verifyAnchorSignature(fields, good, publicKey)).toBe(true);
    expect(verifyAnchorSignature(fields, 'rsa:' + good.slice('ed25519:'.length), publicKey)).toBe(false);
    expect(verifyAnchorSignature(fields, 'ed25519:tooshort', publicKey)).toBe(false);
    // Flip one byte of a valid signature: still 64 bytes, no longer valid.
    const raw = Buffer.from(good.slice('ed25519:'.length), 'base64');
    raw[0] = (raw[0] as number) ^ 0xff;
    expect(verifyAnchorSignature(fields, `ed25519:${raw.toString('base64')}`, publicKey)).toBe(false);
    // Different fields, same key: the signature does not transfer.
    expect(verifyAnchorSignature({ ...fields, chain_head_index: 6 }, good, publicKey)).toBe(false);
    // A public key of the wrong algorithm makes verification throw
    // internally, which must surface as false — never as a crash.
    const { publicKey: rsaPublic } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(verifyAnchorSignature(fields, good, rsaPublic)).toBe(false);
  });

  it('verifyRowSequence localizes duplicates, garbage details and empty ledgers', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      const rows = seedThree(db);

      const duplicated = [...rows, { ...rows[2] as AuditLogRow }];
      const dupReport = verifyRowSequence(duplicated, [], 0);
      expect(dupReport.status).toBe('TAMPERED');
      expect(dupReport.failure_kind).toBe('INDEX_DUPLICATE');

      const garbage = rows.map((row, i) =>
        i === 1 ? { ...row, details: 'definitely not json' } : row
      );
      const garbageReport = verifyRowSequence(garbage, [], 0);
      expect(garbageReport.status).toBe('TAMPERED');
      expect(garbageReport.failure_kind).toBe('HASH_MISMATCH');
      expect(garbageReport.broken_at_index).toBe(2);

      const empty = verifyRowSequence([], [], 0);
      expect(empty.status).toBe('HEALTHY');
      expect(empty.total_records).toBe(0);
      expect(empty.head_hash).toBeNull();

      const unreachable = verifyRowSequence(rows, [], 0, { witnessUnreachable: true });
      expect(unreachable.status).toBe('HEALTHY');
      expect(unreachable.witness.status).toBe('UNREACHABLE');
    } finally {
      db.close();
    }
  });

  it('verifyRowSequence reports MISSING when the anchored entry is gone locally', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      const rows = seedThree(db);
      const head = rows[rows.length - 1] as AuditLogRow;
      // A receipt for an index the local ledger no longer holds (truncated
      // head): the divergence names the gap instead of crashing.
      const beyond = verifyRowSequence(rows, [
        { chain_head_index: head.log_index + 4, chain_head_hash: 'e'.repeat(64), anchored_at: isoAt(9) }
      ], 0);
      expect(beyond.status).toBe('WITNESS_DIVERGED');
      expect(beyond.failure_kind).toBe('WITNESS_MISMATCH');
      expect(beyond.broken_at_index).toBe(head.log_index + 4);
      expect(beyond.witness.divergence?.actual_hash).toBe('MISSING');

      // The same divergence while the witness is unreachable still reports
      // the local verdict with an UNREACHABLE witness marker.
      const dark = verifyRowSequence(rows, [
        { chain_head_index: head.log_index, chain_head_hash: 'f'.repeat(64), anchored_at: isoAt(9) }
      ], 0, { witnessUnreachable: true });
      expect(dark.status).toBe('WITNESS_DIVERGED');
      expect(dark.witness.status).toBe('UNREACHABLE');
    } finally {
      db.close();
    }
  });

  it('file verifier treats malformed lines as TAMPERED, never as a crash', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-branches-'));
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedThree(db);
      const valid = path.join(dir, 'valid.jsonl');
      exportLedger(db, valid);

      const garbage = path.join(dir, 'garbage.jsonl');
      writeFileSync(garbage, '{"record":"audit_log","log_index":1\n', 'utf8');
      const garbageReport = verifyExportFile(garbage);
      expect(garbageReport.status).toBe('TAMPERED');
      expect(garbageReport.broken_at_index).toBe(1);

      const missingField = path.join(dir, 'missing.jsonl');
      writeFileSync(missingField, '{"record":"audit_log","log_index":1}\n', 'utf8');
      expect(verifyExportFile(missingField).status).toBe('TAMPERED');

      const unknownRecord = path.join(dir, 'unknown.jsonl');
      writeFileSync(unknownRecord, '{"record":"smuggled","log_index":1}\n', 'utf8');
      expect(verifyExportFile(unknownRecord).status).toBe('TAMPERED');

      const badAnchor = path.join(dir, 'badanchor.jsonl');
      writeFileSync(badAnchor, '{"record":"anchor","status":"ACKNOWLEDGED"}\n', 'utf8');
      expect(verifyExportFile(badAnchor).status).toBe('TAMPERED');
    } finally {
      db.close();
    }
  });

  it('anchor service validates inputs and surfaces witness failures as errors', async () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      const { privateDerB64 } = generateNodeSigningKeypair();
      const privateKey = parseNodeSigningKey(privateDerB64);
      expect(() =>
        createAnchorReceipt(db, { facilityId: '   ', privateKey, anchoredAt: isoAt(0) })
      ).toThrowError(AnchorError);
      seedThree(db);
      expect(() =>
        createAnchorReceipt(db, { facilityId: 'lasuth-ikeja', privateKey, anchoredAt: 'never' })
      ).toThrowError(AnchorError);

      await expect(
        fetchWitnessReceipts({ witnessUrl: 'http://127.0.0.1:9', witnessApiKey: 'k', fetchTimeoutMs: 500 })
      ).rejects.toThrowError(AnchorError);

      // A witness-shaped server with switchable behaviour: malformed lists,
      // rejections and well-formed receipts each take their own branch.
      let mode: 'malformed' | 'reject' | 'valid' = 'malformed';
      const validReceipt = {
        receipt_id: 'anc_server1',
        facility_id: 'lasuth-ikeja',
        chain_head_index: 3,
        chain_head_hash: 'a'.repeat(64),
        entry_count: 3,
        anchored_at: isoAt(3),
        node_signature: 'ed25519:dead'
      };
      const lying = createServer((_req, res) => {
        res.setHeader('content-type', 'application/json');
        if (mode === 'reject') {
          res.statusCode = 500;
          res.end('{"error":"boom"}');
        } else if (mode === 'valid') {
          res.end(JSON.stringify({ receipts: [validReceipt] }));
        } else {
          res.end('{"nope":true}');
        }
      });
      await new Promise<void>((resolve) => lying.listen(0, '127.0.0.1', resolve));
      const address = lying.address();
      const lyingUrl = `http://127.0.0.1:${(address as { port: number }).port}`;
      try {
        await expect(fetchWitnessReceipts({ witnessUrl: lyingUrl, witnessApiKey: 'k' })).rejects.toThrowError(
          AnchorError
        );
        mode = 'reject';
        await expect(fetchWitnessReceipts({ witnessUrl: lyingUrl, witnessApiKey: 'k' })).rejects.toThrowError(
          /HTTP 500/
        );
        await expect(
          makeWitnessDeliver({
            facilityId: 'lasuth-ikeja',
            witnessUrl: lyingUrl,
            witnessApiKey: 'k',
            nodeSigningKey: privateKey
          })(validReceipt)
        ).rejects.toThrowError(/HTTP 500/);
        mode = 'valid';
        const fetched = await fetchWitnessReceipts({ witnessUrl: lyingUrl, witnessApiKey: 'k' });
        expect(fetched).toEqual([validReceipt]);
      } finally {
        await new Promise<void>((resolve) => lying.close(() => resolve()));
      }

      // skipLedgerEntry records the receipt without touching the chain.
      const skipped = await anchorLedger(
        db,
        {
          facilityId: 'lasuth-ikeja',
          witnessUrl: 'http://127.0.0.1:9',
          witnessApiKey: 'k',
          nodeSigningKey: privateKey
        },
        {
          skipLedgerEntry: true,
          deliver: async (receipt) => ({
            receipt_id: receipt.receipt_id,
            witness_ack: 'wit_x',
            witnessed_at: isoAt(9)
          })
        }
      );
      expect(skipped.status).toBe('ACKNOWLEDGED');
      expect(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()).toEqual({ n: 3 });
    } finally {
      db.close();
    }
  });

  it('audit API maps anchor failures to 409 and unknown routes to 404 without leaking internals', async () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      const { privateDerB64 } = generateNodeSigningKeypair();
      // Empty ledger: there is nothing to anchor, so 409 — not a 500.
      const empty = await request(
        createApp({
          db,
          anchorConfig: {
            facilityId: 'lasuth-ikeja',
            witnessUrl: 'http://127.0.0.1:9',
            witnessApiKey: 'k',
            nodeSigningKey: parseNodeSigningKey(privateDerB64)
          }
        })
      ).post('/api/audit/anchor');
      expect(empty.status).toBe(409);
      expect(empty.body.error.code).toBe('ANCHOR_FAILED');

      const missing = await request(createApp({ db })).get('/api/nope');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
      expect(missing.body.error.request_id).toBeDefined();

      // Malformed JSON reaches the single error middleware as a generic
      // 500: stable code, no parser message, no stack, request id present.
      const broken = await request(createApp({ db }))
        .post('/api/audit/anchor')
        .set('content-type', 'application/json')
        .send('{"unclosed": ');
      expect(broken.status).toBe(500);
      expect(broken.body.error.code).toBe('INTERNAL');
      expect(broken.body.error.message).toBe('Internal server error');
      expect(broken.body.error.request_id).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('exported anchor lines drive the file verifier witness verdict', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-anchor-export-'));
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedThree(db);
      const { privateDerB64 } = generateNodeSigningKeypair();
      const privateKey = parseNodeSigningKey(privateDerB64);
      // One acknowledged anchor, then one pending: the file verdict stays
      // ANCHORED on the acknowledged receipt (chain_head_index 3).
      await anchorLedger(
        db,
        { facilityId: 'lasuth-ikeja', witnessUrl: 'http://127.0.0.1:9', witnessApiKey: 'k', nodeSigningKey: privateKey },
        {
          clock: fixedClock(new Date(BASE_MS + 4000).toISOString()),
          deliver: async (receipt) => ({
            receipt_id: receipt.receipt_id,
            witness_ack: 'wit_1',
            witnessed_at: isoAt(9)
          })
        }
      );
      await anchorLedger(
        db,
        { facilityId: 'lasuth-ikeja', witnessUrl: 'http://127.0.0.1:9', witnessApiKey: 'k', nodeSigningKey: privateKey },
        {
          clock: fixedClock(new Date(BASE_MS + 8000).toISOString()),
          deliver: async () => {
            throw new AnchorError('down');
          }
        }
      );
      const out = path.join(dir, 'anchored.jsonl');
      const counts = exportLedger(db, out);
      expect(counts.anchors).toBe(2);
      const report = verifyExportFile(out);
      expect(report.status).toBe('HEALTHY');
      expect(report.witness.status).toBe('ANCHORED');
      expect(report.witness.last_anchor_index).toBe(3);
    } finally {
      db.close();
    }
  });

  it('demoTamper covers every tamperable default value and rejects bad indices', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-tamper-defaults-'));
    const file = path.join(dir, 'ledger.db');
    const db = openDatabase(file);
    migrateTestDb(db);
    const run = db.transaction(() => {
      appendLedgerEntry(db, {
        staff_id: 'GV-9042',
        staff_role: 'doctor',
        ward: 'icu',
        patient_id: 'SYSTEM',
        action: 'LOGIN',
        details: { seq: 1 },
        timestamp: isoAt(0),
        session_id: null
      });
    });
    run();
    db.close();

    expect(() => demoTamper(file, { index: 0, field: 'staff_id' })).toThrowError(/1-based/);
    expect(() => demoTamper(file, { index: 1.5, field: 'staff_id' })).toThrowError(/1-based/);
    expect(demoTamper(file, { index: 1, field: 'details' }).next).toBe('{"tampered":true}');
    expect(demoTamper(file, { index: 1, field: 'timestamp' }).next).toBe(
      '2026-09-13T10:00:00.000+01:00'
    );
    const nullable = demoTamper(file, { index: 1, field: 'session_id' });
    expect(nullable.previous).toBeNull();
    expect(nullable.next).toBe('ATTACKER');
  });
});
