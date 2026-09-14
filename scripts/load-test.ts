// GridVault load test (AGENTS.md section 4/9.9, AT-901/AT-906).
//
// Seeds the 500-patient / 50,000-ledger-entry "load" profile (PRD 14.6),
// serves it over a real HTTP listener, and drives it with bounded-
// concurrency virtual terminals to measure the NFR-1 p95 latency budgets
// (roster/dossier/vitals) and prove NFR-3/AT-906 (40 concurrent writers,
// 60 s, zero SQLITE_BUSY surfaced to a client). Requests are scoped to a
// handful of fixed patients per persona rather than a wide sweep across
// distinct hospital numbers — a wide sweep is exactly what RULE-ABUSE-06
// (bulk enumeration) exists to throttle, and a real ward terminal running
// a chart-review shift would never enumerate hundreds of strangers'
// records either. Report: docs/load-test-report.md.
//
// Usage: npm run load-test

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../backend/src/db/connection.js';
import { migrate } from '../backend/src/db/migrate.js';
import { seedDatabase, demoPasswordFor } from '../backend/src/db/seed.js';
import { patientsRepository } from '../backend/src/db/repositories/patients.js';
import { createApp } from '../backend/src/http/app.js';
import { verifyLedger } from '../backend/src/ledger/verify.js';
import { fixedClock } from '../backend/src/clock.js';

// Fixed mid-morning WAT timestamp: every demo persona's "morning" shift is
// on duty, so latency measurements reflect the endpoint, not shift policy.
const CLOCK = fixedClock('2026-09-13T10:00:00Z');

const MIGRATIONS_DIR = path.join(process.cwd(), 'backend', 'migrations');
const MASTER_KEY = Buffer.alloc(32, 7);
const JWT_SECRET = 'gridvault-load-test-jwt-secret-at-least-32-characters-long';
const CONCURRENCY = 40;
const READ_BUDGET_SAMPLES = 240; // 6 batches of 40 concurrent requests per endpoint
const WRITE_DURATION_MS = 60_000;

interface Sample {
  ms: number;
  status: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] as number;
}

function summarize(samples: Sample[]): { p50: number; p95: number; max: number; failures: number } {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const failures = samples.filter((s) => s.status >= 400).length;
  return { p50: percentile(ms, 50), p95: percentile(ms, 95), max: ms[ms.length - 1] ?? 0, failures };
}

/** Runs `total` calls to `fn` with at most `concurrency` in flight at once. */
async function runBounded<T>(total: number, concurrency: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(total);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results[i] = await fn(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  return results;
}

async function timedFetch(url: string, init: RequestInit): Promise<Sample> {
  const started = performance.now();
  const res = await fetch(url, init);
  await res.arrayBuffer();
  return { ms: performance.now() - started, status: res.status };
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'gridvault-load-'));
  const dbPath = path.join(dataDir, 'load.db');
  console.log(`Seeding load profile (500 patients) at ${dbPath} ...`);

  const db = openDatabase(dbPath);
  migrate(db, { migrationsDir: MIGRATIONS_DIR, clock: CLOCK });
  await seedDatabase(db, 'load', { masterKey: MASTER_KEY, clock: CLOCK, hashStrength: 'fast' });

  const app = createApp({
    db,
    clock: CLOCK,
    auth: { jwtSecret: JWT_SECRET, demoMode: true, masterKey: MASTER_KEY, masterKeyLoaded: true }
  });
  const server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  async function login(staffId: string): Promise<string> {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staff_id: staffId, password: demoPasswordFor(staffId) })
    });
    if (res.status !== 200) throw new Error(`login ${staffId} failed: ${res.status}`);
    const body = (await res.json()) as { data: { access_token: string } };
    return body.data.access_token;
  }

  const nurseToken = await login('SN-7742');
  const doctorToken = await login('GV-9042');
  const wardAPatients = patientsRepository(db).listByWard('ward_a').map((p) => p.hospital_number);
  const icuPatients = patientsRepository(db).listByWard('icu').map((p) => p.hospital_number);
  if (wardAPatients.length === 0 || icuPatients.length === 0) {
    throw new Error('load profile did not seed ward_a/icu patients as expected');
  }
  const nursePatient = wardAPatients[0] as string;
  const doctorPatient = icuPatients[0] as string;
  const writeTargets = wardAPatients.slice(0, 10);

  const authHeader = (token: string) => ({ authorization: `Bearer ${token}` });

  console.log(`Server listening on ${base}. Measuring roster/dossier/vitals p95 over ${READ_BUDGET_SAMPLES} requests at concurrency ${CONCURRENCY} ...`);

  // -- AT-901: roster, dossier, vitals-write latency budgets ---------------
  const rosterSamples = await runBounded(READ_BUDGET_SAMPLES, CONCURRENCY, async (i) => {
    const token = i % 2 === 0 ? nurseToken : doctorToken;
    return timedFetch(`${base}/api/patients`, { headers: authHeader(token) });
  });

  const dossierSamples = await runBounded(READ_BUDGET_SAMPLES, CONCURRENCY, async (i) => {
    if (i % 2 === 0) return timedFetch(`${base}/api/patients/${nursePatient}`, { headers: authHeader(nurseToken) });
    return timedFetch(`${base}/api/patients/${doctorPatient}`, { headers: authHeader(doctorToken) });
  });

  const vitalsSamples = await runBounded(READ_BUDGET_SAMPLES, CONCURRENCY, async (i) => {
    const target = writeTargets[i % writeTargets.length] as string;
    return timedFetch(`${base}/api/patients/${target}/vitals`, {
      method: 'POST',
      headers: { ...authHeader(nurseToken), 'content-type': 'application/json' },
      body: JSON.stringify({ heart_rate: 70 + (i % 20), blood_pressure: '120/80', spo2: 97, temperature: 36.8 })
    });
  });

  const roster = summarize(rosterSamples);
  const dossier = summarize(dossierSamples);
  const vitals = summarize(vitalsSamples);

  // -- AT-906: 40 concurrent writers for 60 s, zero SQLITE_BUSY ------------
  console.log(`Running ${CONCURRENCY} concurrent writers for ${WRITE_DURATION_MS / 1000}s (AT-906) ...`);
  const deadline = Date.now() + WRITE_DURATION_MS;
  let sustainedWrites = 0;
  let sustainedFailures = 0;
  let sawBusyError = false;
  async function sustainedWriter(workerIndex: number): Promise<void> {
    let seq = 0;
    while (Date.now() < deadline) {
      const target = writeTargets[(workerIndex + seq) % writeTargets.length] as string;
      seq += 1;
      const res = await fetch(`${base}/api/patients/${target}/vitals`, {
        method: 'POST',
        headers: { ...authHeader(nurseToken), 'content-type': 'application/json' },
        body: JSON.stringify({ heart_rate: 60 + (seq % 40), blood_pressure: '118/76', spo2: 98, temperature: 36.9 })
      });
      sustainedWrites += 1;
      if (res.status !== 201) {
        sustainedFailures += 1;
        const text = await res.text().catch(() => '');
        if (/SQLITE_BUSY/i.test(text)) sawBusyError = true;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => sustainedWriter(i)));

  const verify = verifyLedger(db);
  server.close();
  db.close();
  rmSync(dataDir, { recursive: true, force: true });

  // -- Report ---------------------------------------------------------------
  const budgets = [
    { name: 'Roster (GET /api/patients)', budgetMs: 150, ...roster },
    { name: 'Dossier (GET /api/patients/:id)', budgetMs: 200, ...dossier },
    { name: 'Vitals write (POST /api/patients/:id/vitals)', budgetMs: 120, ...vitals }
  ];

  let ok = true;
  console.log('\n--- AT-901: latency budgets (500 patients, concurrency 40) ---');
  for (const b of budgets) {
    const pass = b.p95 <= b.budgetMs && b.failures === 0;
    ok = ok && pass;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${b.name}: p50=${b.p50.toFixed(1)}ms p95=${b.p95.toFixed(1)}ms max=${b.max.toFixed(1)}ms budget=${b.budgetMs}ms failures=${b.failures}`
    );
  }

  console.log('\n--- AT-906: 40 concurrent writers, 60s ---');
  const at906Pass = sustainedFailures === 0 && !sawBusyError;
  ok = ok && at906Pass;
  console.log(
    `${at906Pass ? 'PASS' : 'FAIL'}  ${sustainedWrites} writes attempted, ${sustainedFailures} failed, SQLITE_BUSY surfaced: ${sawBusyError}`
  );

  console.log('\n--- Ledger integrity after load ---');
  const chainOk = verify.status === 'HEALTHY';
  ok = ok && chainOk;
  console.log(`${chainOk ? 'PASS' : 'FAIL'}  chain status=${verify.status} entries verified`);

  const report = `# GridVault load test report

Generated: ${new Date().toISOString()}
Profile: load (500 patients, ~50,000 ledger entries)
Concurrency: ${CONCURRENCY} virtual terminals

## AT-901 — latency budgets (NFR-1)

| Endpoint | p50 (ms) | p95 (ms) | max (ms) | Budget (p95) | Failures | Result |
| :-- | --: | --: | --: | --: | --: | :-- |
${budgets
  .map(
    (b) =>
      `| ${b.name} | ${b.p50.toFixed(1)} | ${b.p95.toFixed(1)} | ${b.max.toFixed(1)} | ${b.budgetMs} | ${b.failures} | ${b.p95 <= b.budgetMs && b.failures === 0 ? 'PASS' : 'FAIL'} |`
  )
  .join('\n')}

## AT-906 — 40 concurrent writers, 60 s (NFR-3)

- Writes attempted: ${sustainedWrites}
- Failed writes: ${sustainedFailures}
- SQLITE_BUSY surfaced to a client: ${sawBusyError}
- Result: ${at906Pass ? 'PASS' : 'FAIL'}

## Ledger integrity

- Chain status after load: ${verify.status}
- Result: ${chainOk ? 'PASS' : 'FAIL'}

## Overall: ${ok ? 'PASS' : 'FAIL'}
`;
  const reportPath = path.join(process.cwd(), 'docs', 'load-test-report.md');
  writeFileSync(reportPath, report, 'utf8');
  console.log(`\nReport written to ${reportPath}`);

  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
