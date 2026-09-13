// Operational ledger acceptance: AT-312, AT-313, AT-314.
//
// These tests drive the shipped operator paths — the `gv` CLI as a child
// process and the HTTP verify endpoint — rather than calling library
// functions, because what is being proven is that the deployed artefacts
// behave: the CLI exits non-zero on a broken chain, the file verifier never
// touches a database, and a 50,000-entry ledger verifies inside the NFR-3
// budget.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/http/app.js';
import { appendLedgerEntry } from '../../src/ledger/append.js';
import { openDatabase, type GridVaultDatabase } from '../../src/db/connection.js';
import { migrateTestDb } from '../helpers/db.js';

const ROOT = process.cwd();
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const GV = path.join('backend', 'src', 'cli', 'gv.ts');

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runGv(args: string[], extraEnv: Record<string, string>): CliRun {
  try {
    const stdout = execFileSync(TSX_BIN, [GV, ...args], {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe']
    } as { cwd: string; env: NodeJS.ProcessEnv; encoding: 'utf8'; timeout: number }) as string;
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failed.status ?? 2,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? ''
    };
  }
}

const BASE_MS = Date.parse('2026-09-13T10:00:00.000+01:00');

function seedChain(db: GridVaultDatabase, n: number): void {
  const run = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      appendLedgerEntry(db, {
        staff_id: 'GV-9042',
        staff_role: 'doctor',
        ward: 'icu',
        patient_id: 'SYSTEM',
        action: 'VIEW_RECORD',
        details: { seq: i + 1 },
        timestamp: new Date(BASE_MS + i * 1000).toISOString()
      });
    }
  });
  run();
}

describe('ledger operations AT-312..AT-314', () => {
  it(
    'AT-312: a 50,000-entry ledger verifies HEALTHY in under 5 s using under 128 MB of heap',
    async () => {
      const db = openDatabase(':memory:');
      try {
        migrateTestDb(db);
        seedChain(db, 50000);

        const heapBefore = process.memoryUsage().heapUsed;
        const started = Date.now();
        const { verifyLedger } = await import('../../src/ledger/verify.js');
        const report = verifyLedger(db);
        const durationMs = Date.now() - started;
        const heapDelta = process.memoryUsage().heapUsed - heapBefore;

        expect(report.status).toBe('HEALTHY');
        expect(report.total_records).toBe(50000);
        expect(report.head_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(durationMs).toBeLessThan(5000);
        expect(heapDelta).toBeLessThan(128 * 1024 * 1024);
      } finally {
        db.close();
      }
    },
    180000
  );

  it(
    'AT-313: demo:tamper then GET /api/audit/verify names the exact broken_at_index and failure_kind',
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'gv-ops-313-'));
      const file = path.join(dir, 'gridvault.db');
      const seed = openDatabase(file);
      migrateTestDb(seed);
      seedChain(seed, 8);
      seed.close();

      const tampered = runGv(['demo:tamper', '--index', '5', '--field', 'staff_id'], {
        DATABASE_PATH: file
      });
      expect(tampered.status).toBe(0);
      expect(tampered.stdout).toContain('row 5');

      const db = openDatabase(file);
      try {
        const res = await request(createApp({ db })).get('/api/audit/verify');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('TAMPERED');
        expect(res.body.failure_kind).toBe('HASH_MISMATCH');
        expect(res.body.broken_at_index).toBe(5);
      } finally {
        db.close();
      }

      // The CLI verifier agrees, independently of the HTTP layer.
      const verified = runGv(['verify-ledger'], { DATABASE_PATH: file });
      expect(verified.status).toBe(1);
      expect(verified.stdout).toContain('TAMPERED');
      expect(verified.stdout).toContain('"broken_at_index": 5');
    },
    180000
  );

  it(
    'AT-314: export-ledger, hand-edit one line, verify-ledger --file reports TAMPERED with no DB and no network',
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'gv-ops-314-'));
      const file = path.join(dir, 'gridvault.db');
      const out = path.join(dir, 'ledger.jsonl');
      const seed = openDatabase(file);
      migrateTestDb(seed);
      seedChain(seed, 5);
      seed.close();

      const exported = runGv(['export-ledger', '--out', out], { DATABASE_PATH: file });
      expect(exported.status).toBe(0);
      expect(exported.stdout).toContain('5 ledger entries');

      // Point at a database that does not exist: the file verifier must not
      // need it (and must not create it).
      const missingDb = path.join(dir, 'does-not-exist.db');
      const healthy = runGv(['verify-ledger', '--file', out], { DATABASE_PATH: missingDb });
      expect(healthy.status).toBe(0);
      expect(healthy.stdout).toContain('HEALTHY');

      // Hand-edit line 3 (log_index 3): same JSON shape, forged content.
      const lines = readFileSync(out, 'utf8').split('\n').filter((line) => line.length > 0);
      expect(lines).toHaveLength(5);
      expect(lines[2]).toContain('"log_index":3');
      lines[2] = (lines[2] as string).replace('"staff_id":"GV-9042"', '"staff_id":"ATTACKER"');
      writeFileSync(out, lines.join('\n') + '\n', 'utf8');

      const tampered = runGv(['verify-ledger', '--file', out], { DATABASE_PATH: missingDb });
      expect(tampered.status).toBe(1);
      expect(tampered.stdout).toContain('TAMPERED');
      expect(tampered.stdout).toContain('"broken_at_index": 3');
    },
    180000
  );
});
