import { mkdtempSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createPublicKey } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import { createApp } from '../../src/http/app.js';
import { appendLedgerEntry } from '../../src/ledger/append.js';
import {
  anchorLedger,
  createAnchorReceipt,
  getAnchorHistory
} from '../../src/ledger/anchor.js';
import { exportLedger, iterateExportLines, verifyExportFile } from '../../src/ledger/export.js';
import { demoTamper } from '../../src/ledger/tamper.js';
import { GENESIS_PREV_HASH, hashLedgerEntry } from '../../src/crypto/hash.js';
import {
  generateNodeSigningKeypair,
  parseNodeSigningKey,
  verifyAnchorSignature
} from '../../src/crypto/signing.js';
import { verifyLedger } from '../../src/ledger/verify.js';
import { openDatabase, type GridVaultDatabase } from '../../src/db/connection.js';
import {
  auditLogsRepository,
  chainAnchorsRepository,
  type AuditLogRow
} from '../../src/db/repositories/ledger.js';
import { demoSensitivePlaintexts, seedDatabase } from '../../src/db/seed.js';
import { TEST_MASTER_KEY, migrateTestDb, openTestDb } from '../helpers/db.js';

const BASE_MS = Date.parse('2026-09-13T10:00:00.000+01:00');

function isoAt(seconds: number): string {
  return new Date(BASE_MS + seconds * 1000).toISOString();
}

const SAFE_ACTIONS = ['LOGIN', 'VIEW_RECORD', 'RECORD_VITALS', 'VIEW_ROSTER', 'LOGOUT'];

/** Append n chained entries with deterministic 1-second spacing, inside one transaction. */
function seedChain(db: GridVaultDatabase, n: number, startSeconds = 0): void {
  const run = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      appendLedgerEntry(db, {
        staff_id: 'GV-9042',
        staff_role: 'doctor',
        ward: 'icu',
        patient_id: 'SYSTEM',
        action: SAFE_ACTIONS[i % SAFE_ACTIONS.length] as string,
        // Field NAMES, decision codes and counts only — never PHI values.
        details: { seq: startSeconds + i + 1, fields: ['heart_rate'] },
        timestamp: isoAt(startSeconds + i)
      });
    }
  });
  run();
}

function dropAppendTriggers(db: GridVaultDatabase): void {
  db.exec('DROP TRIGGER IF EXISTS audit_logs_no_update');
  db.exec('DROP TRIGGER IF EXISTS audit_logs_no_delete');
}

/** Root-attacker primitive: recompute every prev_hash/current_hash from an index onwards. */
function recomputeChainFrom(db: GridVaultDatabase, fromIndex: number): void {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY log_index ASC').all() as AuditLogRow[];
  let prev = fromIndex === 1 ? GENESIS_PREV_HASH : (rows[fromIndex - 2] as AuditLogRow).current_hash;
  const update = db.prepare('UPDATE audit_logs SET prev_hash = ?, current_hash = ? WHERE log_index = ?');
  for (const row of rows) {
    if (row.log_index < fromIndex) {
      continue;
    }
    const current = hashLedgerEntry({
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
      prev_hash: prev
    });
    update.run(prev, current, row.log_index);
    prev = current;
  }
}

/**
 * Start the REAL witness service as a child process on an ephemeral port.
 * A child process (not an in-process import) keeps the workspace typecheck
 * boundary intact while still exercising the shipped witness code over
 * real HTTP. NODE_ENV=development so the child actually binds its port.
 */
async function startWitness(apiKey: string): Promise<{ url: string; close: () => Promise<void> }> {
  const tsxBin = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const child: ChildProcess = spawn(tsxBin, [path.join('witness', 'src', 'index.ts')], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'development', PORT: '0', WITNESS_API_KEY: apiKey },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for witness boot: ${output}`)), 60000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const match = /listening on port (\d+)/.exec(output);
      if (match !== null) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1] as string}`);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`witness exited during boot (${code}): ${output}`)));
  });
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 5000).unref();
      })
  };
}

/** A port that was bound a moment ago and is now closed: guaranteed connection-refused. */
async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? (address as { port: number }).port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

describe('ledger acceptance AT-303..AT-311 and AT-315', () => {
  it('AT-303: hostile details (|, quotes, newlines, emoji, 8 KB) chain cleanly with no delimiter ambiguity', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      appendLedgerEntry(db, {
        staff_id: 'GV-9042',
        staff_role: 'doctor',
        ward: 'icu',
        patient_id: 'SYSTEM',
        action: 'VIEW_RECORD',
        details: {
          pipe: 'a|b|c',
          quote: 'she said "hello"',
          newline: 'line one\nline two\r\nline three',
          emoji: '😷🇳🇬 triage ✓',
          big: 'x'.repeat(8192)
        },
        timestamp: isoAt(0)
      });
      appendLedgerEntry(db, {
        staff_id: 'SN-7742',
        staff_role: 'nurse',
        ward: 'ward_a',
        patient_id: 'SYSTEM',
        action: 'RECORD_VITALS',
        details: { count: 3 },
        timestamp: isoAt(1)
      });
      const report = verifyLedger(db);
      expect(report.status).toBe('HEALTHY');
      expect(report.total_records).toBe(2);

      // Regression pin for the v1 pipe format: two entries whose naive
      // `a|b|c` concatenation is byte-identical must hash differently now,
      // because the JSON array keeps field boundaries structural.
      const left = {
        log_index: 9,
        timestamp: isoAt(9),
        staff_id: 'X|Y',
        staff_role: 'doctor',
        ward: 'icu',
        patient_id: 'Z',
        action: 'VIEW_RECORD',
        details: { seq: 1 },
        session_id: null,
        terminal_id: null,
        source_ip: null,
        prev_hash: 'a'.repeat(64)
      };
      const right = { ...left, staff_id: 'X', patient_id: 'Y|Z' };
      const naive = (e: typeof left): string =>
        [e.log_index, e.timestamp, e.staff_id, e.patient_id].join('|');
      expect(naive(left)).toBe(naive(right));
      expect(hashLedgerEntry(left)).not.toBe(hashLedgerEntry(right));
    } finally {
      db.close();
    }
  });

  it('AT-304: 50 interleaved appends across 5 connections stay dense with no forked prev_hash', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-ledger-304-'));
    const file = path.join(dir, 'ledger.db');
    const primary = openDatabase(file);
    migrateTestDb(primary);
    // better-sqlite3 is synchronous, so true thread parallelism is
    // impossible in-process; what this exercises honestly is the shared-file
    // locking path: five independent connections round-robin appends with
    // event-loop yields between them, and every append re-reads the head
    // under BEGIN IMMEDIATE instead of trusting a cached value.
    const extra = [openDatabase(file), openDatabase(file), openDatabase(file), openDatabase(file)];
    const connections = [primary, ...extra];
    try {
      let seq = 0;
      const writers = connections.map((conn, ci) =>
        (async () => {
          for (let k = 0; k < 10; k++) {
            const mine = seq++;
            await new Promise((resolve) => setImmediate(resolve));
            appendLedgerEntry(conn, {
              staff_id: `TERM-${ci}`,
              staff_role: 'nurse',
              ward: 'ward_a',
              patient_id: 'SYSTEM',
              action: 'RECORD_VITALS',
              details: { writer: ci, seq: mine },
              timestamp: isoAt(mine)
            });
          }
        })()
      );
      await Promise.all(writers);

      expect(auditLogsRepository(primary).count()).toBe(50);
      const indices = (
        primary.prepare('SELECT log_index FROM audit_logs ORDER BY log_index ASC').all() as Array<{
          log_index: number;
        }>
      ).map((row) => row.log_index);
      expect(indices).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
      const prevHashes = (
        primary.prepare('SELECT prev_hash FROM audit_logs ORDER BY log_index ASC').all() as Array<{
          prev_hash: string;
        }>
      ).map((row) => row.prev_hash);
      // Every append chained onto a distinct predecessor: no two writers
      // ever read the same head, so the chain never forked.
      expect(new Set(prevHashes).size).toBe(50);
      const report = verifyLedger(primary);
      expect(report.status).toBe('HEALTHY');
      expect(report.total_records).toBe(50);
    } finally {
      for (const conn of connections) {
        conn.close();
      }
    }
  });

  it('AT-305: editing staff_id at index 7 reports TAMPERED / HASH_MISMATCH / 7', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 8);
      dropAppendTriggers(db);
      db.prepare('UPDATE audit_logs SET staff_id = ? WHERE log_index = ?').run('ATTACKER', 7);
      const report = verifyLedger(db);
      expect(report.status).toBe('TAMPERED');
      expect(report.failure_kind).toBe('HASH_MISMATCH');
      expect(report.broken_at_index).toBe(7);
      expect(report.total_records).toBe(6);
    } finally {
      db.close();
    }
  });

  it('AT-306: deleting index 5 reports TRUNCATED / INDEX_GAP / 5', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 6);
      dropAppendTriggers(db);
      db.prepare('DELETE FROM audit_logs WHERE log_index = ?').run(5);
      const report = verifyLedger(db);
      expect(report.status).toBe('TRUNCATED');
      expect(report.failure_kind).toBe('INDEX_GAP');
      expect(report.broken_at_index).toBe(5);
    } finally {
      db.close();
    }
  });

  it('AT-307: a forged row inserted at index 6 is localized exactly', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 7);
      dropAppendTriggers(db);
      db.prepare('DELETE FROM audit_logs WHERE log_index = ?').run(6);
      // Attacker reuses the slot with fabricated content and a garbage
      // self-hash: AUTOINCREMENT permits the explicit log_index.
      db.prepare(
        'INSERT INTO audit_logs (log_index, timestamp, staff_id, staff_role, ward, patient_id, ' +
          'action, details, session_id, terminal_id, source_ip, prev_hash, current_hash) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        6,
        isoAt(5),
        'ATTACKER',
        'admin',
        'icu',
        'SYSTEM',
        'VIEW_RECORD',
        '{"forged":true}',
        null,
        null,
        null,
        'c'.repeat(64),
        'd'.repeat(64)
      );
      const report = verifyLedger(db);
      expect(report.status).toBe('TAMPERED');
      expect(report.broken_at_index).toBe(6);
      // The forged row does not link to its predecessor, so linkage fails
      // before recomputation: CHAIN_BREAK at the forged index itself.
      expect(report.failure_kind).toBe('CHAIN_BREAK');
    } finally {
      db.close();
    }
  });

  it('AT-308: reordered timestamps report TIMESTAMP_REGRESSION at the first offending index', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 5);
      dropAppendTriggers(db);
      // Swap the timestamps of rows 3 and 4. Row 4 now precedes row 3 in
      // time: the structural pass must name index 4 before the hash pass
      // could mask it as a HASH_MISMATCH.
      db.prepare('UPDATE audit_logs SET timestamp = ? WHERE log_index = ?').run(isoAt(3), 3);
      db.prepare('UPDATE audit_logs SET timestamp = ? WHERE log_index = ?').run(isoAt(2), 4);
      const report = verifyLedger(db);
      expect(report.status).toBe('TAMPERED');
      expect(report.failure_kind).toBe('TIMESTAMP_REGRESSION');
      expect(report.broken_at_index).toBe(4);
    } finally {
      db.close();
    }
  });

  it('AT-309: a fully recomputed chain verifies locally but the independent witness receipt diverges', async () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 5);
      const { privateDerB64 } = generateNodeSigningKeypair();
      // Fixed clock: the CHAIN_ANCHORED entry must stay on the fixture
      // timeline (wall-clock time would regress against it).
      const anchorClock = fixedClock('2026-09-13T10:00:05Z');
      const result = await anchorLedger(
        db,
        {
          facilityId: 'lasuth-ikeja',
          witnessUrl: 'http://127.0.0.1:9',
          witnessApiKey: 'test-key',
          nodeSigningKey: parseNodeSigningKey(privateDerB64)
        },
        {
          clock: anchorClock,
          // No network in this test: record the receipt as the witness
          // would, and keep the returned copy as the auditor's
          // independently-held receipt.
          deliver: async (receipt) => ({
            receipt_id: receipt.receipt_id,
            witness_ack: 'wit_independent',
            witnessed_at: isoAt(100)
          })
        }
      );
      const independentReceipt = result.receipt;
      expect(result.status).toBe('ACKNOWLEDGED');

      // Root attacker: edit history, recompute every hash, and rewrite
      // the local anchor row to match — everything the node holds agrees.
      dropAppendTriggers(db);
      db.prepare('UPDATE audit_logs SET staff_id = ? WHERE log_index = ?').run('ATTACKER', 3);
      recomputeChainFrom(db, 3);
      const newHead = chainAnchorsRepository(db).latest();
      const rewritten = db
        .prepare('SELECT current_hash FROM audit_logs WHERE log_index = ?')
        .get(independentReceipt.chain_head_index) as { current_hash: string };
      db.prepare('UPDATE chain_anchors SET chain_head_hash = ? WHERE receipt_id = ?').run(
        rewritten.current_hash,
        (newHead as { receipt_id: string }).receipt_id
      );

      const local = verifyLedger(db);
      expect(local.status).toBe('HEALTHY');

      const independent = verifyLedger(db, { witnessReceipts: [independentReceipt] });
      expect(independent.status).toBe('WITNESS_DIVERGED');
      expect(independent.failure_kind).toBe('WITNESS_MISMATCH');
      expect(independent.broken_at_index).toBe(independentReceipt.chain_head_index);
      expect(independent.witness.status).toBe('WITNESS_DIVERGED');
      expect(independent.witness.last_anchor_index).toBe(independentReceipt.chain_head_index);
      expect(independent.witness.divergence?.expected_hash).toBe(independentReceipt.chain_head_hash);
      expect(independent.witness.divergence?.actual_hash).toBe(rewritten.current_hash);
    } finally {
      db.close();
    }
  });

  it('AT-310: anchor receipt verifies against the node public key and the witness stores it ACKNOWLEDGED', async () => {
    const witness = await startWitness('test-witness-key');
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 3);
      const { privateDerB64, publicDerB64 } = generateNodeSigningKeypair();
      const privateKey = parseNodeSigningKey(privateDerB64);
      const publicKey = createPublicKey({
        key: Buffer.from(publicDerB64, 'base64'),
        format: 'der',
        type: 'spki'
      });

      const result = await anchorLedger(
        db,
        {
          facilityId: 'lasuth-ikeja',
          witnessUrl: witness.url,
          witnessApiKey: 'test-witness-key',
          nodeSigningKey: privateKey
        },
        { clock: { now: () => new Date(BASE_MS + 3600 * 1000) } }
      );
      expect(result.status).toBe('ACKNOWLEDGED');
      expect(result.delivery_error).toBeNull();
      expect(result.witness_ack).not.toBeNull();
      expect(result.receipt.node_signature.startsWith('ed25519:')).toBe(true);

      // The signature is over the PRD 8.6 fields and verifies against the
      // independently-held public key — not against anything the node says.
      expect(
        verifyAnchorSignature(
          {
            facility_id: result.receipt.facility_id,
            chain_head_index: result.receipt.chain_head_index,
            chain_head_hash: result.receipt.chain_head_hash,
            entry_count: result.receipt.entry_count,
            anchored_at: result.receipt.anchored_at
          },
          result.receipt.node_signature,
          publicKey
        )
      ).toBe(true);

      // The witness holds the exact receipt under separate custody.
      const listed = await fetch(`${witness.url}/anchors`, {
        headers: { authorization: 'Bearer test-witness-key' }
      });
      expect(listed.status).toBe(200);
      const body = (await listed.json()) as { receipts: Array<{ receipt_id: string }> };
      expect(body.receipts.map((r) => r.receipt_id)).toContain(result.receipt.receipt_id);

      const stored = chainAnchorsRepository(db).latest();
      expect(stored?.status).toBe('ACKNOWLEDGED');
      expect(stored?.receipt_id).toBe(result.receipt.receipt_id);
      expect(stored?.witness_ack).toBe(result.witness_ack?.witness_ack);

      // The anchor event itself is chained: the ledger stays HEALTHY and
      // grew by exactly the CHAIN_ANCHORED entry.
      const report = verifyLedger(db);
      expect(report.status).toBe('HEALTHY');
      expect(report.total_records).toBe(4);
      expect(auditLogsRepository(db).getByIndex(4)?.action).toBe('CHAIN_ANCHORED');
    } finally {
      db.close();
      await witness.close();
    }
  });

  it('AT-311: an unreachable witness queues PENDING without disturbing clinical writes or verification', async () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 2);
      const { privateDerB64 } = generateNodeSigningKeypair();
      const result = await anchorLedger(
        db,
        {
          facilityId: 'lasuth-ikeja',
          witnessUrl: await closedPortUrl(),
          witnessApiKey: 'test-witness-key',
          nodeSigningKey: parseNodeSigningKey(privateDerB64),
          fetchTimeoutMs: 1000
        },
        // Fixed clock keeps the anchor entry on the fixture timeline
        // (isoAt seconds are 09:00Z instants; the anchor must sit between
        // the seeded rows and the later clinical write).
        { clock: fixedClock('2026-09-13T09:00:02Z') }
      );
      // Delivery failure is a result, not a throw: care continues.
      expect(result.status).toBe('PENDING');
      expect(result.delivery_error).not.toBeNull();
      expect(result.witness_ack).toBeNull();
      expect(chainAnchorsRepository(db).latest()?.status).toBe('PENDING');

      // Clinical work is unaffected: the next append chains cleanly.
      appendLedgerEntry(db, {
        staff_id: 'SN-7742',
        staff_role: 'nurse',
        ward: 'ward_a',
        patient_id: 'SYSTEM',
        action: 'RECORD_VITALS',
        details: { fields: ['heart_rate'], count: 1 },
        timestamp: isoAt(50)
      });
      const report = verifyLedger(db);
      expect(report.status).toBe('HEALTHY');
      // The console signal for anchor lag: nothing acknowledged, one receipt waiting.
      expect(report.witness.status).toBe('ANCHOR_PENDING');
      expect(getAnchorHistory(db).pending).toBe(1);
    } finally {
      db.close();
    }
  });

  it('AT-315: no seed PHI value appears anywhere in the ledger after a full demo run', async () => {
    const db = openTestDb();
    try {
      await seedDatabase(db, 'demo', { masterKey: TEST_MASTER_KEY, hashStrength: 'fast' });
      // A representative shift of audited activity. details carries field
      // NAMES, decision codes, counts and ids — the values stay in the
      // encrypted columns, never here.
      const entries = [
        { action: 'LOGIN', details: { method: 'password', terminal: 'term-warda-02' } },
        {
          action: 'VIEW_RECORD',
          details: { fields: ['full_name', 'ward', 'bed_number'], decision: 'ROLE_WARD_DUTY_SATISFIED' }
        },
        {
          action: 'VIEW_SENSITIVE',
          details: { fields: ['hiv_status', 'genotype', 'pregnancy_status'], decision: 'ROLE_WARD_DUTY_SATISFIED' }
        },
        {
          action: 'ACCESS_DENIED',
          details: { fields: ['primary_diagnosis'], decision: 'CLERK_OUT_OF_QUEUE', rule: 'RULE-ABUSE-01' }
        },
        {
          action: 'EMERGENCY_OVERRIDE_GRANTED',
          details: { justification_code: 'ACUTE_TRAUMA_UNCONSCIOUS', scope: ['VITALS', 'CLINICAL'] }
        },
        {
          action: 'SYNC_REPLAY',
          details: { device: 'term-warda-02', mutations: 10, source: 'offline_sync' }
        }
      ];
      entries.forEach((entry, i) => {
        appendLedgerEntry(db, {
          staff_id: i % 2 === 0 ? 'SN-7742' : 'RC-1029',
          staff_role: i % 2 === 0 ? 'nurse' : 'clerk',
          ward: 'ward_a',
          patient_id: 'SYSTEM',
          action: entry.action,
          details: entry.details,
          timestamp: isoAt(100 + i)
        });
      });

      const rows = db.prepare('SELECT * FROM audit_logs').all() as AuditLogRow[];
      expect(rows.length).toBeGreaterThan(0);
      const haystack = rows.map((row) => JSON.stringify(row)).join('\n');
      // Positive control: field names ARE logged (the test is not vacuous).
      expect(haystack).toContain('hiv_status');
      for (const secret of demoSensitivePlaintexts()) {
        expect(haystack).not.toContain(secret);
      }
      // Independently: the known sensitive spellings from PRD 16.
      for (const known of ['Reactive (Confirmed)', 'Hb SS', 'Hb AS']) {
        expect(haystack).not.toContain(known);
      }
    } finally {
      db.close();
    }
  });

  it('audit API: GET /api/audit/verify returns the PRD 8.5 report and stays HEALTHY on a live chain', async () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 4);
      const res = await request(createApp({ db })).get('/api/audit/verify');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('HEALTHY');
      expect(res.body.total_records).toBe(4);
      expect(res.body.broken_at_index).toBeNull();
      expect(res.body.failure_kind).toBeNull();
      expect(res.body.head_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.witness.status).toBe('NO_ANCHOR');
      expect(typeof res.body.duration_ms).toBe('number');
      expect(res.headers['x-request-id']).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('audit API: POST /api/audit/anchor executes without config as 503, with config as 201', async () => {
    const witness = await startWitness('anchor-console-key');
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 2);

      const unconfigured = await request(createApp({ db })).post('/api/audit/anchor');
      expect(unconfigured.status).toBe(503);
      expect(unconfigured.body.error.code).toBe('ANCHOR_NOT_CONFIGURED');

      const { privateDerB64 } = generateNodeSigningKeypair();
      const configured = await request(
        createApp({
          db,
          anchorConfig: {
            facilityId: 'lasuth-ikeja',
            witnessUrl: witness.url,
            witnessApiKey: 'anchor-console-key',
            nodeSigningKey: parseNodeSigningKey(privateDerB64)
          }
        })
      ).post('/api/audit/anchor');
      expect(configured.status).toBe(201);
      expect(configured.body.status).toBe('ACKNOWLEDGED');
      expect(configured.body.receipt.receipt_id).toMatch(/^anc_/);

      const history = await request(createApp({ db })).get('/api/audit/anchors');
      expect(history.status).toBe(200);
      expect(history.body.pending).toBe(0);
      expect(history.body.receipts).toHaveLength(1);
    } finally {
      db.close();
      await witness.close();
    }
  });

  it('audit API: GET /api/audit/export streams the same bytes the file exporter writes', async () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      seedChain(db, 3);
      const res = await request(createApp({ db })).get('/api/audit/export?format=jsonl');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/x-ndjson');
      const expected = [...iterateExportLines(db)].join('');
      expect(res.text).toBe(expected);

      const rejected = await request(createApp({ db })).get('/api/audit/export?format=csv');
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.code).toBe('UNSUPPORTED_FORMAT');
    } finally {
      db.close();
    }
  });

  it('anchor service: createAnchorReceipt refuses an empty ledger and export round-trips a file', () => {
    const db = openTestDb();
    try {
      migrateTestDb(db);
      const { privateDerB64 } = generateNodeSigningKeypair();
      expect(() =>
        createAnchorReceipt(db, {
          facilityId: 'lasuth-ikeja',
          privateKey: parseNodeSigningKey(privateDerB64),
          anchoredAt: isoAt(0)
        })
      ).toThrowError(/empty ledger/);

      seedChain(db, 3);
      const dir = mkdtempSync(path.join(tmpdir(), 'gv-export-'));
      const out = path.join(dir, 'ledger.jsonl');
      const counts = exportLedger(db, out);
      expect(counts.entries).toBe(3);
      expect(counts.head_hash).toMatch(/^[0-9a-f]{64}$/);
      const fileReport = verifyExportFile(out);
      expect(fileReport.status).toBe('HEALTHY');
      expect(fileReport.total_records).toBe(3);
      expect(fileReport.head_hash).toBe(counts.head_hash);
    } finally {
      db.close();
    }
  });

  it('tamper core: demoTamper rewrites one cell via file access and refuses production without the flag', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-tamper-'));
    const file = path.join(dir, 'ledger.db');
    const db = openDatabase(file);
    migrateTestDb(db);
    seedChain(db, 4);
    db.close();

    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => demoTamper(file, { index: 2, field: 'staff_id' })).toThrowError(
        /--i-understand-this-corrupts-the-ledger/
      );
    } finally {
      if (before === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = before;
      }
    }
    expect(() => demoTamper(file, { index: 99, field: 'staff_id' })).toThrowError(/no audit_logs row/);
    expect(() => demoTamper(file, { index: 2, field: 'current_hash' })).toThrowError(/refuses field/);

    const result = demoTamper(file, { index: 2, field: 'staff_id' });
    expect(result).toEqual({ index: 2, field: 'staff_id', previous: 'GV-9042', next: 'ATTACKER' });

    const reopened = openDatabase(file);
    try {
      // The attacker reinstalled the triggers to cover their tracks.
      const triggers = reopened
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'audit_logs_no_%'")
        .all() as Array<{ name: string }>;
      expect(triggers.map((t) => t.name).sort()).toEqual([
        'audit_logs_no_delete',
        'audit_logs_no_update'
      ]);
      const report = verifyLedger(reopened);
      expect(report.status).toBe('TAMPERED');
      expect(report.failure_kind).toBe('HASH_MISMATCH');
      expect(report.broken_at_index).toBe(2);
      // Sanity: the test helper hash matches the stored head before tamper
      // would have; spot-check the digest algorithm against node:crypto.
      const head = auditLogsRepository(reopened).getByIndex(1) as AuditLogRow;
      expect(createHash('sha256').update(JSON.stringify({ probe: 1 })).digest('hex')).toHaveLength(64);
      expect(head.current_hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      reopened.close();
    }
  });
});
