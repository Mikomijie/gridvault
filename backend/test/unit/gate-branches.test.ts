// Gate-path branch tests (NFR-10: 100% branch on policy/ledger/crypto).
//
// policy/ already holds 100%. This file closes the remaining ledger, crypto
// and serializer branches with one honest test per defensive path — no
// mocks, no vacuous assertions. Each test names the behaviour it pins.

import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FieldCrypto, EncryptionIntegrityError } from '../../src/crypto/field-encryption.js';
import { appendLedgerEntry, LedgerError } from '../../src/ledger/append.js';
import { AnchorError, makeWitnessDeliver } from '../../src/ledger/anchor.js';
import { verifyExportFile } from '../../src/ledger/export.js';
import { demoTamper, TamperRefusedError } from '../../src/ledger/tamper.js';
import { ledgerEntriesSince, ledgerHeadIndex, recentLedgerEntries } from '../../src/ledger/tail.js';
import { generateNodeSigningKeypair, parseNodeSigningKey } from '../../src/crypto/signing.js';
import { verifyLedger, verifyRowSequence } from '../../src/ledger/verify.js';
import { reasonText } from '../../src/serialize/redact.js';
import {
  recordAlert,
  recordBreakGlass,
  recordDenial,
  recordRequest,
  recordVerification,
  renderMetrics,
  resetMetrics
} from '../../src/observability/metrics.js';
import type { AuditLogRow } from '../../src/db/repositories/ledger.js';
import { openDatabase, type GridVaultDatabase } from '../../src/db/connection.js';
import { migrateTestDb, openTestDb, TEST_MASTER_KEY } from '../helpers/db.js';

const BASE_MS = Date.parse('2026-09-13T10:00:00.000+01:00');
const isoAt = (seconds: number): string => new Date(BASE_MS + seconds * 1000).toISOString();

function seedThree(db: GridVaultDatabase): void {
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
}

describe('NFR-10 gate branches', () => {
  it('field crypto rejects empty AAD inputs and version-0 payloads', () => {
    const crypto = new FieldCrypto(TEST_MASTER_KEY);
    expect(() => crypto.encryptField('', 'hiv_status', 'x')).toThrowError(EncryptionIntegrityError);
    expect(() => crypto.encryptField('pid', '', 'x')).toThrowError(EncryptionIntegrityError);
    const good = crypto.encryptField('pid-1', 'hiv_status', 'Reactive (Confirmed)');
    const [, iv, ct, tag] = good.split(':') as [string, string, string, string];
    // A v0 payload reaches the key-version guard instead of decrypting.
    expect(() => crypto.decryptField('pid-1', 'hiv_status', `v0:${iv}:${ct}:${tag}`)).toThrowError(
      EncryptionIntegrityError
    );
  });

  it('append defaults timestamp, clock and timezone, and rejects blank timestamps', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      // No timestamp and no options: system clock plus Africa/Lagos default.
      const result = appendLedgerEntry(db, {
        staff_id: 'GV-9042',
        staff_role: 'doctor',
        ward: 'icu',
        patient_id: 'SYSTEM',
        action: 'LOGIN',
        details: { seq: 1 }
      });
      expect(result.log_index).toBe(1);
      const row = db.prepare('SELECT timestamp FROM audit_logs WHERE log_index = 1').get() as {
        timestamp: string;
      };
      expect(row.timestamp).toMatch(/\+01:00$/);
      expect(() =>
        appendLedgerEntry(db, {
          staff_id: 'GV-9042',
          staff_role: 'doctor',
          ward: 'icu',
          patient_id: 'SYSTEM',
          action: 'LOGIN',
          details: { seq: 2 },
          timestamp: '   '
        })
      ).toThrowError(/parseable ISO-8601/);
    } finally {
      db.close();
    }
  });

  it('append reports non-Error serialization failures without crashing', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      // A throwing getter propels a bare string through canonical-JSON
      // encoding: the append wrapper must String() it, never crash on
      // a missing .message.
      const hostile: Record<string, unknown> = {};
      Object.defineProperty(hostile, 'trap', {
        enumerable: true,
        get(): string {
          throw 'non-error-details-failure';
        }
      });
      expect(() =>
        appendLedgerEntry(db, {
          staff_id: 'GV-9042',
          staff_role: 'doctor',
          ward: 'icu',
          patient_id: 'SYSTEM',
          action: 'LOGIN',
          details: hostile,
          timestamp: isoAt(0)
        })
      ).toThrowError(/non-error-details-failure/);
    } finally {
      db.close();
    }
  });

  it('append detects a moved ledger head and surfaces the original error when rollback itself fails', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedThree(db);
      // A root attacker jumps sqlite_sequence forward: the next insert lands
      // far past the expected index, and append fails loudly instead of
      // forking the chain.
      db.exec("UPDATE sqlite_sequence SET seq = 50 WHERE name = 'audit_logs'");
      expect(() =>
        appendLedgerEntry(db, {
          staff_id: 'GV-9042',
          staff_role: 'doctor',
          ward: 'icu',
          patient_id: 'SYSTEM',
          action: 'LOGIN',
          details: { seq: 4 },
          timestamp: isoAt(3)
        })
      ).toThrowError(/Ledger head moved during append/);
    } finally {
      db.close();
    }

    const db2 = openTestDb();
    try {
      migrateTestDb(db2);
      // Break the connection's ROLLBACK path while the append itself also
      // fails: the caller must see the original LedgerError, never a
      // rollback plumbing error.
      const originalExec = db2.exec.bind(db2);
      db2.exec = ((sql: string) => {
        if (sql === 'ROLLBACK') throw new Error('connection dead');
        return originalExec(sql);
      }) as typeof db2.exec;
      expect(() =>
        appendLedgerEntry(db2, {
          staff_id: 'GV-9042',
          staff_role: 'doctor',
          ward: 'icu',
          patient_id: 'SYSTEM',
          action: 'LOGIN',
          details: { v: Number.NaN },
          timestamp: isoAt(0)
        })
      ).toThrowError(LedgerError);
    } finally {
      db2.close();
    }
  });

  it('demoTamper refuses when the trigger set cannot be proven intact', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-gate-tamper-'));
    const file = path.join(dir, 'gridvault.db');
    const seed = openDatabase(file);
    try {
      migrateTestDb(seed);
      seedThree(seed);
    } finally {
      seed.close();
    }
    // A rogue third trigger matching the guard pattern: reinstalling the two
    // canonical triggers no longer proves integrity, so tamper refuses.
    const planted = openDatabase(file);
    try {
      planted.exec(
        "CREATE TRIGGER audit_logs_no_snoop BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'planted'); END"
      );
    } finally {
      planted.close();
    }
    expect(() => demoTamper(file, { index: 1, field: 'staff_id' })).toThrowError(TamperRefusedError);
    // The canonical triggers are reinstalled even on refusal: the file is
    // never left unprotected.
    const check = openDatabase(file);
    try {
      const triggers = check
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'audit_logs_no_%'")
        .all() as Array<{ name: string }>;
      expect(triggers.map((row) => row.name)).toContain('audit_logs_no_update');
      expect(triggers.map((row) => row.name)).toContain('audit_logs_no_delete');
    } finally {
      check.close();
    }
  });

  it('reasonText falls back to the generic denial for unknown codes', () => {
    expect(reasonText('CLERK_OUT_OF_QUEUE')).toContain('intake queue');
    expect(reasonText('NO_SUCH_REASON')).toBe('Access denied by policy');
  });

  it('ledger tail reads serve the SSE stream windows', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      expect(ledgerHeadIndex(db)).toBeNull();
      expect(recentLedgerEntries(db, 20)).toEqual([]);
      expect(ledgerEntriesSince(db, 0, 50)).toEqual([]);
      seedThree(db);
      expect(ledgerHeadIndex(db)).toBe(3);
      expect(recentLedgerEntries(db, 20)).toHaveLength(3);
      const since = ledgerEntriesSince(db, 1, 50);
      expect(since.map((row) => row.log_index)).toEqual([2, 3]);
      expect(ledgerEntriesSince(db, 3, 50)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('verification compares against the newest of several witness receipts', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedThree(db);
      const rows = db.prepare('SELECT * FROM audit_logs ORDER BY log_index ASC').all() as AuditLogRow[];
      const hashOf = (index: number): string => {
        const row = rows.find((candidate) => candidate.log_index === index);
        if (row === undefined) throw new Error(`missing seeded row ${index}`);
        return row.current_hash;
      };
      // Two matching receipts: the newest (index 3) is the one compared.
      const healthy = verifyRowSequence(
        rows,
        [
          { chain_head_index: 2, chain_head_hash: hashOf(2), anchored_at: isoAt(10) },
          { chain_head_index: 3, chain_head_hash: hashOf(3), anchored_at: isoAt(11) }
        ],
        0
      );
      expect(healthy.status).toBe('HEALTHY');
      // Newest receipt forged while an older one still matches: divergence
      // names the newest index, not the first mismatch found by accident.
      const diverged = verifyRowSequence(
        rows,
        [
          { chain_head_index: 2, chain_head_hash: hashOf(2), anchored_at: isoAt(10) },
          { chain_head_index: 3, chain_head_hash: 'f'.repeat(64), anchored_at: isoAt(11) }
        ],
        0
      );
      expect(diverged.status).toBe('WITNESS_DIVERGED');
      expect(diverged.broken_at_index).toBe(3);
      expect(verifyLedger(db).status).toBe('HEALTHY');
    } finally {
      db.close();
    }
  });

  it('file verifier rejects non-record JSON, mistyped fields and PENDING anchors without crashing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-gate-export-'));
    const scalar = path.join(dir, 'scalar.jsonl');
    writeFileSync(scalar, '42\n', 'utf8');
    expect(verifyExportFile(scalar).status).toBe('TAMPERED');

    const badIndex = path.join(dir, 'badindex.jsonl');
    writeFileSync(
      badIndex,
      '{"record":"audit_log","log_index":"one","timestamp":"t","staff_id":"s","staff_role":"r",' +
        '"ward":"w","patient_id":"p","action":"LOGIN","details":"{}","session_id":null,' +
        '"terminal_id":null,"source_ip":null,"prev_hash":"' +
        '0'.repeat(64) +
        '","current_hash":"' +
        '0'.repeat(64) +
        '"}\n',
      'utf8'
    );
    expect(verifyExportFile(badIndex).status).toBe('TAMPERED');

    const badDetails = path.join(dir, 'baddetails.jsonl');
    writeFileSync(
      badDetails,
      '{"record":"audit_log","log_index":1,"timestamp":"t","staff_id":"s","staff_role":"r",' +
        '"ward":"w","patient_id":"p","action":"LOGIN","details":42,"session_id":null,' +
        '"terminal_id":null,"source_ip":null,"prev_hash":"' +
        '0'.repeat(64) +
        '","current_hash":"' +
        '0'.repeat(64) +
        '"}\n',
      'utf8'
    );
    expect(verifyExportFile(badDetails).status).toBe('TAMPERED');

    const badWard = path.join(dir, 'badward.jsonl');
    writeFileSync(
      badWard,
      '{"record":"audit_log","log_index":1,"timestamp":"t","staff_id":"s","staff_role":"r",' +
        '"ward":7,"patient_id":"p","action":"LOGIN","details":"{}","session_id":null,' +
        '"terminal_id":null,"source_ip":null,"prev_hash":"' +
        '0'.repeat(64) +
        '","current_hash":"' +
        '0'.repeat(64) +
        '"}\n',
      'utf8'
    );
    expect(verifyExportFile(badWard).status).toBe('TAMPERED');

    const mistyped = path.join(dir, 'mistyped.jsonl');
    writeFileSync(
      mistyped,
      '{"record":"audit_log","log_index":1,"timestamp":"2026-09-13T10:00:00.000+01:00",' +
        '"staff_id":"GV-9042","staff_role":"doctor","ward":"icu","patient_id":"SYSTEM",' +
        '"action":"LOGIN","details":"{}","session_id":42,"terminal_id":null,"source_ip":null,' +
        '"prev_hash":"' +
        '0'.repeat(64) +
        '","current_hash":"' +
        '0'.repeat(64) +
        '"}\n',
      'utf8'
    );
    expect(verifyExportFile(mistyped).status).toBe('TAMPERED');

    // A well-formed PENDING anchor line counts toward anchor lag, not error.
    const pending = path.join(dir, 'pending.jsonl');
    writeFileSync(
      pending,
      '{"record":"anchor","status":"PENDING","receipt_id":"anc_1","facility_id":"f",' +
        '"chain_head_index":1,"chain_head_hash":"' +
        '0'.repeat(64) +
        '","entry_count":1,"anchored_at":"2026-09-13T10:00:00.000+01:00","node_signature":"ed25519:x"}\n',
      'utf8'
    );
    const pendingReport = verifyExportFile(pending);
    // An empty ledger still verifies; the PENDING line surfaces as anchor
    // lag rather than an integrity failure.
    expect(pendingReport.status).toBe('HEALTHY');
    expect(pendingReport.witness.status).toBe('ANCHOR_PENDING');
  });

  it('anchor history on an empty table has no latest receipt', async () => {
    const { getAnchorHistory } = await import('../../src/ledger/anchor.js');
    const db = openTestDb();
    try {
      migrateTestDb(db);
      const history = getAnchorHistory(db);
      expect(history.receipts).toEqual([]);
      expect(history.pending).toBe(0);
      expect(history.latest).toBeNull();
    } finally {
      db.close();
    }
  });

  it('anchorLedger keeps PENDING with the raw error text when delivery throws a non-Error', async () => {
    const { anchorLedger } = await import('../../src/ledger/anchor.js');
    const { privateDerB64 } = generateNodeSigningKeypair();
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedThree(db);
      const result = await anchorLedger(
        db,
        {
          facilityId: 'lasuth-ikeja',
          witnessUrl: 'http://127.0.0.1:9',
          witnessApiKey: 'k',
          nodeSigningKey: parseNodeSigningKey(privateDerB64)
        },
        {
          deliver: async () => {
            throw 'witness-blew-up-string';
          }
        }
      );
      expect(result.status).toBe('PENDING');
      expect(result.delivery_error).toBe('witness-blew-up-string');
    } finally {
      db.close();
    }
  });

  it('witness delivery rejects mismatched, missing, mistimed and non-JSON acknowledgements', async () => {
    const { privateDerB64 } = generateNodeSigningKeypair();
    const privateKey = parseNodeSigningKey(privateDerB64);
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedThree(db);
      const { createAnchorReceipt } = await import('../../src/ledger/anchor.js');
      const receipt = createAnchorReceipt(db, {
        facilityId: 'lasuth-ikeja',
        privateKey,
        anchoredAt: isoAt(20)
      });

      let mode:
        | 'wrong-id'
        | 'missing-ack'
        | 'bad-time'
        | 'not-json'
        | 'null-ack'
        | 'scalar-ack'
        | 'hang'
        | 'valid' = 'wrong-id';
      const server = createServer((_req, res) => {
        res.setHeader('content-type', 'application/json');
        if (mode === 'not-json') {
          res.end('this is not json{{{');
        } else if (mode === 'hang') {
          // Never responds: the client AbortSignal fires a DOMException
          // timeout, which is not instanceof Error.
        } else if (mode === 'null-ack') {
          res.end('null');
        } else if (mode === 'scalar-ack') {
          res.end('"just-a-string"');
        } else if (mode === 'wrong-id') {
          res.end(JSON.stringify({ receipt_id: 'anc_other', witness_ack: 'w', witnessed_at: isoAt(21) }));
        } else if (mode === 'missing-ack') {
          res.end(JSON.stringify({ receipt_id: receipt.receipt_id, witnessed_at: isoAt(21) }));
        } else if (mode === 'bad-time') {
          res.end(JSON.stringify({ receipt_id: receipt.receipt_id, witness_ack: 'w', witnessed_at: 'never' }));
        } else {
          res.end(
            JSON.stringify({ receipt_id: receipt.receipt_id, witness_ack: 'wit_ok', witnessed_at: isoAt(21) })
          );
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as { port: number };
      const deliver = makeWitnessDeliver({
        facilityId: 'lasuth-ikeja',
        witnessUrl: `http://127.0.0.1:${address.port}`,
        witnessApiKey: 'k',
        nodeSigningKey: privateKey
      });
      try {
        const { fetchWitnessReceipts } = await import('../../src/ledger/anchor.js');
        // A hanging witness list endpoint trips AbortSignal.timeout too: the
        // DOMException rejection surfaces as AnchorError via String().
        mode = 'hang';
        await expect(
          fetchWitnessReceipts({ witnessUrl: `http://127.0.0.1:${address.port}`, witnessApiKey: 'k', fetchTimeoutMs: 50 })
        ).rejects.toThrowError(AnchorError);
        mode = 'wrong-id';
        await expect(deliver(receipt)).rejects.toThrowError(/does not match/);
        mode = 'missing-ack';
        await expect(deliver(receipt)).rejects.toThrowError(/missing witness_ack/);
        mode = 'bad-time';
        await expect(deliver(receipt)).rejects.toThrowError(/invalid witnessed_at/);
        mode = 'not-json';
        await expect(deliver(receipt)).rejects.toThrowError(/non-JSON/);
        mode = 'null-ack';
        await expect(deliver(receipt)).rejects.toThrowError(/not an object/);
        mode = 'scalar-ack';
        await expect(deliver(receipt)).rejects.toThrowError(/not an object/);
        mode = 'valid';
        const ack = await deliver(receipt);
        expect(ack).toEqual({ receipt_id: receipt.receipt_id, witness_ack: 'wit_ok', witnessed_at: isoAt(21) });
        // A hanging witness trips AbortSignal.timeout: the rejection is a
        // DOMException, surfaced as AnchorError via String(), never a crash.
        mode = 'hang';
        const hanging = makeWitnessDeliver({
          facilityId: 'lasuth-ikeja',
          witnessUrl: `http://127.0.0.1:${address.port}`,
          witnessApiKey: 'k',
          nodeSigningKey: privateKey,
          fetchTimeoutMs: 50
        });
        await expect(hanging(receipt)).rejects.toThrowError(AnchorError);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      db.close();
    }
  });

  it('anchor signature verification survives a non-asymmetric key object', async () => {
    const { createSecretKey } = await import('node:crypto');
    const {
      generateNodeSigningKeypair,
      parseNodeSigningKey,
      signAnchor,
      verifyAnchorSignature
    } = await import('../../src/crypto/signing.js');
    const fields = {
      facility_id: 'lasuth-ikeja',
      chain_head_index: 5,
      chain_head_hash: 'a'.repeat(64),
      entry_count: 5,
      anchored_at: isoAt(0)
    };
    // A real 64-byte signature (past the length gate) verified against a
    // symmetric key object makes verify() throw a TypeError internally:
    // the verifier must answer false, never propagate the crash.
    const { privateDerB64 } = generateNodeSigningKeypair();
    const good = signAnchor(fields, parseNodeSigningKey(privateDerB64));
    const secret = createSecretKey(Buffer.alloc(32, 1));
    expect(verifyAnchorSignature(fields, good, secret)).toBe(false);
  });

  it('metrics record, render and reset without leaking values into labels', () => {
    resetMetrics();
    recordRequest('GET', '/api/patients', 12);
    recordRequest('GET', '/api/patients', 30);
    recordDenial('WARD_MISMATCH');
    recordBreakGlass();
    recordAlert('RULE-ABUSE-01');
    const text = renderMetrics({ pendingOutbox: 2, anchorLagMinutes: 7 });
    expect(text).toContain('gridvault_requests_total{route="GET /api/patients"} 2');
    expect(text).toContain('gridvault_policy_denials_total{reason_code="WARD_MISMATCH"} 1');
    expect(text).toContain('gridvault_break_glass_total 1');
    expect(text).toContain('gridvault_abuse_alerts_total{rule="RULE-ABUSE-01"} 1');
    expect(text).toContain('gridvault_sync_queue_depth 2');
    expect(text).toContain('gridvault_anchor_lag_minutes 7');
    recordVerification(41, 'HEALTHY');
    expect(renderMetrics()).toContain('gridvault_chain_verify_status{status="HEALTHY"} 1');
    resetMetrics();
    expect(renderMetrics()).not.toContain('WARD_MISMATCH');
  });
});
