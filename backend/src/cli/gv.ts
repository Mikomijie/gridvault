// GridVault operator CLI: `npm run gv -- <command>`.
//
// There is no HTTP endpoint that mutates the ledger — this process, run by
// a human operator on the node itself, is the only writer outside the
// application's append path, and only for `demo:tamper`, which simulates a
// host attacker by opening the database file directly.
//
// Exit codes for verify-ledger: 0 HEALTHY, 1 TAMPERED / TRUNCATED /
// WITNESS_DIVERGED, 2 operational failure (missing file, bad key, no DB).

import { rmSync } from 'node:fs';
import { openDatabase } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { verifyLedger } from '../ledger/verify.js';
import { exportLedger, verifyExportFile } from '../ledger/export.js';
import {
  AnchorError,
  anchorLedger,
  fetchWitnessReceipts
} from '../ledger/anchor.js';
import { demoTamper, TamperRefusedError } from '../ledger/tamper.js';
import { parseNodeSigningKey } from '../crypto/signing.js';
import {
  DEMO_PATIENTS,
  DEMO_PINS,
  DEMO_STAFF,
  demoPasswordFor,
  seedDatabase,
  type SeedProfile
} from '../db/seed.js';

const DEV_MASTER_KEY_B64 = 'k8s9J3nF9x0q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6=';

function databasePath(): string {
  return process.env.DATABASE_PATH ?? './data/gridvault.db';
}

function masterKey(): Buffer {
  const raw = process.env.GRIDVAULT_MASTER_KEY ?? DEV_MASTER_KEY_B64;
  if (process.env.GRIDVAULT_MASTER_KEY === undefined) {
    process.stderr.write('warning: GRIDVAULT_MASTER_KEY unset, using the development key\n');
  }
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.byteLength !== 32) {
    process.stderr.write('error: GRIDVAULT_MASTER_KEY must decode to exactly 32 bytes\n');
    process.exit(1);
  }
  return key;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseProfile(args: string[]): SeedProfile {
  const profile = flagValue(args, '--profile') ?? 'demo';
  if (profile !== 'demo' && profile !== 'load' && profile !== 'empty') {
    process.stderr.write(`error: unknown seed profile: ${profile} (demo|load|empty)\n`);
    process.exit(1);
  }
  return profile;
}

async function cmdSeed(args: string[]): Promise<void> {
  const profile = parseProfile(args);
  const db = openDatabase(databasePath());
  try {
    const result = await seedDatabase(db, profile, { masterKey: masterKey() });
    process.stdout.write(
      `seeded profile=${result.profile} staff=${result.staff} patients=${result.patients} vitals=${result.vitals}\n`
    );
    if (profile === 'demo') {
      printPersonas();
    }
  } finally {
    db.close();
  }
}

async function cmdMigrate(): Promise<void> {
  const db = openDatabase(databasePath());
  try {
    const result = migrate(db, { migrationsDir: 'backend/migrations' });
    process.stdout.write(
      result.applied.length === 0
        ? 'migrations: nothing to apply\n'
        : `migrations applied: ${result.applied.join(', ')}\n`
    );
  } finally {
    db.close();
  }
}

async function cmdDemoReset(): Promise<void> {
  const dbPath = databasePath();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
  await cmdSeed(['--profile', 'demo']);
}

function printPersonas(): void {
  process.stdout.write('demo personas (staff_id / password / pin):\n');
  for (const staff of DEMO_STAFF) {
    const pin = DEMO_PINS[staff.staffId] ?? 'unset';
    process.stdout.write(
      `  ${staff.staffId} ${staff.fullName} [${staff.role}/${staff.ward}/${staff.shift}] ` +
        `password=${demoPasswordFor(staff.staffId)} pin=${pin}\n`
    );
  }
  process.stdout.write(`seeded patients: ${DEMO_PATIENTS.length}\n`);
}

function printVerifyReport(report: ReturnType<typeof verifyLedger>): number {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status === 'HEALTHY') {
    process.stdout.write(
      `verify: HEALTHY (${report.total_records} entries, head ${report.head_hash}, ${report.duration_ms} ms)\n`
    );
    return 0;
  }
  process.stdout.write(
    `verify: ${report.status} at index ${String(report.broken_at_index)} (${String(report.failure_kind)})\n`
  );
  return 1;
}

async function cmdVerifyLedger(args: string[]): Promise<void> {
  const file = flagValue(args, '--file');
  if (file !== undefined) {
    // Standalone path: the file is the only input. No database is opened
    // here — by construction, not by discipline.
    const report = verifyExportFile(file);
    process.exit(printVerifyReport(report));
  }
  const db = openDatabase(databasePath());
  try {
    if (hasFlag(args, '--against-witness')) {
      const witnessUrl = (process.env.WITNESS_URL ?? 'http://localhost:9090').trim();
      const witnessApiKey = (process.env.WITNESS_API_KEY ?? '').trim();
      try {
        const receipts = await fetchWitnessReceipts({
          witnessUrl,
          witnessApiKey,
          fetchTimeoutMs: 5000
        });
        process.exit(printVerifyReport(verifyLedger(db, { witnessReceipts: receipts })));
      } catch (error) {
        // The witness is down; the chain verdict still stands on its own.
        process.stderr.write(
          `warning: witness unreachable, verifying against local anchors: ${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exit(printVerifyReport(verifyLedger(db, { witnessUnreachable: true })));
      }
    }
    process.exit(printVerifyReport(verifyLedger(db)));
  } finally {
    db.close();
  }
}

async function cmdExportLedger(args: string[]): Promise<void> {
  const out = flagValue(args, '--out') ?? 'ledger.jsonl';
  const db = openDatabase(databasePath());
  try {
    const counts = exportLedger(db, out);
    process.stdout.write(
      `exported ${counts.entries} ledger entries + ${counts.anchors} anchor receipts ` +
        `(${counts.bytes} bytes) to ${counts.path}, head ${counts.head_hash ?? 'empty'}\n`
    );
  } finally {
    db.close();
  }
}

async function cmdAnchor(): Promise<void> {
  const rawKey = (process.env.NODE_SIGNING_KEY ?? '').trim();
  if (rawKey.length === 0) {
    process.stderr.write('error: NODE_SIGNING_KEY is required to sign an anchor receipt\n');
    process.exit(2);
  }
  let nodeSigningKey;
  try {
    nodeSigningKey = parseNodeSigningKey(rawKey);
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
  const db = openDatabase(databasePath());
  try {
    const result = await anchorLedger(db, {
      facilityId: (process.env.FACILITY_ID ?? '').trim() || 'gridvault-ward-node',
      witnessUrl: (process.env.WITNESS_URL ?? 'http://localhost:9090').trim(),
      witnessApiKey: (process.env.WITNESS_API_KEY ?? '').trim(),
      nodeSigningKey
    });
    process.stdout.write(
      `anchor: ${result.status} receipt=${result.receipt.receipt_id} ` +
        `head_index=${result.receipt.chain_head_index} head_hash=${result.receipt.chain_head_hash}\n`
    );
    if (result.delivery_error !== null) {
      process.stdout.write(`anchor delivery deferred (PENDING): ${result.delivery_error}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `error: anchor failed: ${error instanceof AnchorError || error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(2);
  } finally {
    db.close();
  }
}

async function cmdDemoTamper(args: string[]): Promise<void> {
  const indexRaw = flagValue(args, '--index') ?? '2';
  const field = flagValue(args, '--field') ?? 'staff_id';
  const value = flagValue(args, '--value');
  const index = Number(indexRaw);
  try {
    const result = demoTamper(databasePath(), {
      index,
      field,
      value,
      allowProductionCorruption: hasFlag(args, '--i-understand-this-corrupts-the-ledger')
    });
    process.stdout.write(
      `tampered audit_logs row ${result.index}: ${result.field} ` +
        `'${result.previous ?? 'NULL'}' -> '${result.next}' (triggers reinstalled)\n`
    );
  } catch (error) {
    process.stderr.write(
      `error: ${error instanceof TamperRefusedError || error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(2);
  }
}

function usage(): void {
  process.stdout.write(
    'usage: gv <seed|migrate|demo:reset|verify-ledger|export-ledger|anchor|demo:tamper> [options]\n' +
      '  seed [--profile demo|load|empty]\n' +
      '  migrate\n' +
      '  demo:reset\n' +
      '  verify-ledger [--file ledger.jsonl] [--against-witness]\n' +
      '  export-ledger [--out ledger.jsonl]\n' +
      '  anchor\n' +
      '  demo:tamper [--index N] [--field staff_id] [--value V] [--i-understand-this-corrupts-the-ledger]\n'
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'seed') {
    await cmdSeed(rest);
  } else if (command === 'migrate') {
    await cmdMigrate();
  } else if (command === 'demo:reset') {
    await cmdDemoReset();
  } else if (command === 'verify-ledger') {
    await cmdVerifyLedger(rest);
  } else if (command === 'export-ledger') {
    await cmdExportLedger(rest);
  } else if (command === 'anchor') {
    await cmdAnchor();
  } else if (command === 'demo:tamper') {
    await cmdDemoTamper(rest);
  } else {
    usage();
    process.exit(1);
  }
}

await main();
