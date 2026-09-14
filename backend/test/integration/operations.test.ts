// Operational acceptance: AT-514, AT-908, AT-912.
//
// These drive shipped artefacts — the real server child process killed with
// SIGKILL, the `gv` CLI as a child process, and the production pino logger —
// because what is proven is deployment behaviour, not library behaviour.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { Writable } from 'node:stream';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.js';
import { seedDatabase, demoSensitivePlaintexts } from '../../src/db/seed.js';
import { usersRepository, scheduledExtensionsRepository } from '../../src/db/repositories/users.js';
import { verifyLedger } from '../../src/ledger/verify.js';
import { createLogger } from '../../src/observability/logger.js';
import { migrateTestDb, TEST_MASTER_KEY } from '../helpers/db.js';
import {
  AFTERNOON_CLOCK,
  MORNING_CLOCK,
  createSeededStack,
  demoPassword,
  makeOnDuty
} from '../helpers/app.js';

const ROOT = process.cwd();
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const GV = path.join('backend', 'src', 'cli', 'gv.ts');
const SERVER = path.join('backend', 'src', 'index.ts');
const MASTER_KEY_B64 = Buffer.from(TEST_MASTER_KEY).toString('base64');
const JWT_SECRET = 'gridvault-ops-test-jwt-secret-minimum-32-chars!!';

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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not allocate a test port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPing(port: number, timeoutMs = 30000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health/ping`);
      if (res.ok) return;
    } catch {
      // Server is still booting.
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`server on port ${port} never became ready`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.on('exit', () => resolve());
  });
}

// tsx spawns the app as a child process of the wrapper it execs, so killing
// the wrapper alone orphans the server. Spawn detached and signal the whole
// process group: that is what actually delivers SIGKILL to the API.
function killServer(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead.
    }
  }
}

function vitalsMutation(deviceId: string, seq: number, tag: string): Record<string, unknown> {
  return {
    client_mutation_id: `cm_${tag}_${seq}`,
    device_id: deviceId,
    device_seq: seq,
    type: 'VITALS',
    patient_id: 'HOSP-LOS-2025-081',
    payload: { heart_rate: 80, blood_pressure: '120/80', spo2: 98, temperature: 36.8 },
    captured_at: new Date().toISOString(),
    captured_at_source: 'device_clock'
  };
}

describe('operations AT-514, AT-908, AT-912', () => {
  it(
    'AT-912: gv subject-access --patient prints the complete chronological history, verifiable against the ledger',
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'gv-ops-912-'));
      const file = path.join(dir, 'gridvault.db');
      const db = openDatabase(file);
      try {
        migrateTestDb(db);
        await seedDatabase(db, 'demo', { masterKey: TEST_MASTER_KEY, hashStrength: 'fast' });
      } finally {
        db.close();
      }

      // Generate access activity for the patient through the real HTTP stack.
      const live = openDatabase(file);
      try {
        const { createApp } = await import('../../src/http/app.js');
        const { fixedClock } = await import('../../src/clock.js');
        const app = createApp({
          db: live,
          clock: fixedClock('2026-09-13T10:00:00Z'),
          auth: {
            jwtSecret: JWT_SECRET,
            demoMode: true,
            masterKey: TEST_MASTER_KEY,
            masterKeyLoaded: true
          }
        });
        const login = await request(app)
          .post('/api/auth/login')
          .send({ staff_id: 'SN-7742', password: demoPassword('SN-7742') });
        expect(login.status).toBe(200);
        const auth = login.body.data.access_token as string;
        const read = await request(app)
          .get('/api/patients/HOSP-LOS-2025-082')
          .set('Authorization', `Bearer ${auth}`);
        expect(read.status).toBe(200);
      } finally {
        live.close();
      }

      const run = runGv(['subject-access', '--patient', 'HOSP-LOS-2025-082'], {
        DATABASE_PATH: file
      });
      expect(run.status).toBe(0);
      const report = JSON.parse(run.stdout) as {
        patient: string;
        entries: number;
        chain: string;
        history: Array<{ log_index: number; action: string; current_hash: string }>;
      };
      expect(report.patient).toBe('HOSP-LOS-2025-082');
      expect(report.entries).toBeGreaterThan(0);
      expect(report.chain).toBe('HEALTHY');
      const indices = report.history.map((row) => row.log_index);
      expect([...indices].sort((a, b) => a - b)).toEqual(indices);
      expect(report.history.some((row) => row.action === 'VIEW_RECORD')).toBe(true);
      for (const row of report.history) {
        expect(row.current_hash).toMatch(/^[0-9a-f]{64}$/);
      }
    },
    180000
  );

  it('AT-514: a batch that fails mid-way applies nothing; kill -9 mid-batch loses nothing and replay completes', async () => {
    // Part 1 (deterministic): a batch containing an unknown patient fails
    // the whole transaction — the valid siblings leave zero rows behind.
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'SN-7742');
    const login = await request(stack.app)
      .post('/api/auth/login')
      .send({ staff_id: 'SN-7742', password: demoPassword('SN-7742') });
    const auth = login.body.data.access_token as string;
    const tag = uuidv7().replace(/-/g, '');
    const badBatch = [
      vitalsMutation('term-atomic', 1, tag),
      { ...vitalsMutation('term-atomic', 2, tag), patient_id: 'HOSP-LOS-9999-404' },
      vitalsMutation('term-atomic', 3, tag)
    ];
    const bad = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({ mutations: badBatch });
    expect(bad.status).toBe(404);
    const leaked = stack.db
      .prepare("SELECT COUNT(*) AS n FROM vitals WHERE client_mutation_id LIKE 'cm_' || ? || '%'")
      .get(`${tag}`) as { n: number };
    expect(leaked.n).toBe(0);
    const leakedLedger = stack.db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE details LIKE '%' || ? || '%'")
      .get(`${tag}`) as { n: number };
    expect(leakedLedger.n).toBe(0);

    // Part 2 (operational): kill -9 a live server mid-batch, restart, replay.
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-ops-514-'));
    const file = path.join(dir, 'gridvault.db');
    const seed = openDatabase(file);
    try {
      migrateTestDb(seed);
      await seedDatabase(seed, 'demo', { masterKey: TEST_MASTER_KEY, hashStrength: 'fast' });
      // The spawned server runs on the real clock: cover the nurse with a
      // sanctioned extension so duty never interferes with the probe.
      const nurse = usersRepository(seed).findByStaffId('SN-7742');
      if (nurse === undefined) throw new Error('demo nurse missing');
      const now = Date.now();
      scheduledExtensionsRepository(seed).insert({
        id: uuidv7(),
        user_id: nurse.id,
        starts_at: new Date(now - 2 * 3600000).toISOString(),
        ends_at: new Date(now + 2 * 3600000).toISOString(),
        approved_by: 'GV-9101',
        reason: 'AT-514 crash probe',
        created_at: new Date(now).toISOString()
      });
    } finally {
      seed.close();
    }

    const serverEnv = {
      PORT: '',
      DATABASE_PATH: file,
      GRIDVAULT_MASTER_KEY: MASTER_KEY_B64,
      JWT_SECRET,
      NODE_ENV: 'development',
      LOG_LEVEL: 'error'
    };
    const crashTag = uuidv7().replace(/-/g, '');
    const mutations = Array.from({ length: 100 }, (_, i) =>
      vitalsMutation('term-crash', i + 1, crashTag)
    );

    const port = await freePort();
    const first = spawn(TSX_BIN, [SERVER], {
      cwd: ROOT,
      env: { ...process.env, ...serverEnv, PORT: String(port) },
      stdio: 'ignore',
      detached: true
    });
    try {
      await waitForPing(port);
      const loginRes = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ staff_id: 'SN-7742', password: demoPassword('SN-7742') })
      });
      expect(loginRes.status).toBe(200);
      const loginBody = (await loginRes.json()) as { data: { access_token: string } };
      const token = loginBody.data.access_token;

      // Fire the batch and SIGKILL without awaiting the response: whether
      // the kill lands before, during or after the single transaction, the
      // visible outcome must be all-or-nothing.
      const attempt = fetch(`http://127.0.0.1:${port}/api/sync/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ mutations })
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      killServer(first);
      await waitForExit(first);
      await attempt.catch(() => undefined);
      // The group kill must have silenced the port: guards against the
      // tsx-wrapper orphan that would otherwise keep serving.
      await new Promise((resolve) => setTimeout(resolve, 500));
      const silenced = await fetch(`http://127.0.0.1:${port}/api/health/ping`).then(
        () => false,
        () => true
      );
      expect(silenced).toBe(true);

      const probe = openDatabase(file);
      try {
        const applied = probe
          .prepare("SELECT COUNT(*) AS n FROM vitals WHERE device_id = 'term-crash'")
          .get() as { n: number };
        expect([0, 100]).toContain(applied.n);
      } finally {
        probe.close();
      }

      const port2 = await freePort();
      const second = spawn(TSX_BIN, [SERVER], {
        cwd: ROOT,
        env: { ...process.env, ...serverEnv, PORT: String(port2) },
        stdio: 'ignore',
        detached: true
      });
      try {
        await waitForPing(port2);
        const login2 = await fetch(`http://127.0.0.1:${port2}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ staff_id: 'SN-7742', password: demoPassword('SN-7742') })
        });
        expect(login2.status).toBe(200);
        const loginBody2 = (await login2.json()) as { data: { access_token: string } };
        const token2 = loginBody2.data.access_token;
        const replay = await fetch(`http://127.0.0.1:${port2}/api/sync/batch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token2}` },
          body: JSON.stringify({ mutations })
        });
        expect(replay.status).toBe(200);
        const body = (await replay.json()) as {
          data: {
            processed: number;
            duplicates_ignored: number;
            results: Array<{ status: string }>;
          };
        };
        expect(body.data.processed).toBe(100);
        const applied =
          body.data.results.filter((row) => row.status === 'applied').length +
          body.data.duplicates_ignored;
        expect(applied).toBe(100);
        const verify = await fetch(`http://127.0.0.1:${port2}/api/audit/verify`);
        expect(verify.status).toBe(200);
        const report = (await verify.json()) as { status: string };
        expect(report.status).toBe('HEALTHY');
      } finally {
        killServer(second);
        await waitForExit(second);
      }

      const final = openDatabase(file);
      try {
        const total = final
          .prepare("SELECT COUNT(*) AS n FROM vitals WHERE device_id = 'term-crash'")
          .get() as { n: number };
        expect(total.n).toBe(100);
        expect(verifyLedger(final).status).toBe('HEALTHY');
      } finally {
        final.close();
      }
    } finally {
      killServer(first);
      await waitForExit(first);
    }
  }, 240000);

  it('AT-908: log output from a full demo run contains no PHI, password, token or key material', async () => {
    // Part 1: the shipped redaction config, exercised directly.
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
        chunks.push(chunk.toString());
        callback();
      }
    });
    // Justification: pino accepts any writable stream at runtime; the cast
    // only bridges the SonicBoom-biased DestinationStream type for a test.
    const probeLogger = createLogger('info', sink as unknown as import('pino').DestinationStream);
    probeLogger.flush();
    const secrets = [
      ...demoSensitivePlaintexts(),
      'Reactive (Confirmed)',
      'Hb SS',
      'Hb AS',
      'S3ntinel-Pw-908',
      'eyJhbGciOiJIUzI1NiJ9.sentinel-token',
      MASTER_KEY_B64
    ];
    probeLogger.info(
      {
        password: 'S3ntinel-Pw-908',
        pin: '1234',
        access_token: 'eyJhbGciOiJIUzI1NiJ9.sentinel-token',
        GRIDVAULT_MASTER_KEY: MASTER_KEY_B64,
        req: { body: { password: 'S3ntinel-Pw-908', full_name: 'Amara Okafor' } },
        details: { hiv_status: 'Reactive (Confirmed)', genotype: 'Hb SS' }
      },
      'probe'
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const redacted = chunks.join('\n');
    expect(redacted).toContain('[REDACTED]');
    for (const secret of secrets) {
      expect(redacted).not.toContain(secret);
    }

    // Part 2: a full demo run through the real stack, with stdout captured.
    const captured: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      const callback = rest.find((arg): arg is () => void => typeof arg === 'function');
      if (callback !== undefined) callback();
      return true;
    }) as typeof process.stdout.write;
    let liveToken = '';
    try {
      const nurseStack = await createSeededStack(MORNING_CLOCK);
      makeOnDuty(nurseStack, 'SN-7742');
      const badPassword = 'S3ntinel-Pw-908-wrong';
      const failed = await request(nurseStack.app)
        .post('/api/auth/login')
        .send({ staff_id: 'SN-7742', password: badPassword });
      expect(failed.status).toBe(401);
      const login = await request(nurseStack.app)
        .post('/api/auth/login')
        .send({ staff_id: 'SN-7742', password: demoPassword('SN-7742') });
      expect(login.status).toBe(200);
      liveToken = login.body.data.access_token as string;
      const dossier = await request(nurseStack.app)
        .get('/api/patients/HOSP-LOS-2025-082')
        .set('Authorization', `Bearer ${liveToken}`);
      expect(dossier.status).toBe(200);
      const vitals = await request(nurseStack.app)
        .post('/api/patients/HOSP-LOS-2025-082/vitals')
        .set('Authorization', `Bearer ${liveToken}`)
        .send({ heart_rate: 88, blood_pressure: '130/85', spo2: 97, temperature: 37.0 });
      expect([200, 201]).toContain(vitals.status);

      const clerkStack = await createSeededStack(AFTERNOON_CLOCK);
      const clerkLogin = await request(clerkStack.app)
        .post('/api/auth/login')
        .send({ staff_id: 'RC-1029', password: demoPassword('RC-1029') });
      const clerkAuth = clerkLogin.body.data.access_token as string;
      const denied = await request(clerkStack.app)
        .get('/api/patients/HOSP-LOS-2025-082')
        .set('Authorization', `Bearer ${clerkAuth}`);
      expect(denied.status).toBe(403);
    } finally {
      process.stdout.write = originalWrite;
    }
    const haystack = captured.join('\n');
    expect(haystack).not.toContain('S3ntinel-Pw-908-wrong');
    expect(haystack).not.toContain(liveToken);
    expect(haystack).not.toContain(MASTER_KEY_B64);
    for (const secret of demoSensitivePlaintexts()) {
      expect(haystack).not.toContain(secret);
    }
    for (const known of ['Reactive (Confirmed)', 'Hb SS', 'Hb AS']) {
      expect(haystack).not.toContain(known);
    }
  }, 180000);
});
