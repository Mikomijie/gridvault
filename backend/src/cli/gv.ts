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
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
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

async function cmdMigrate(_args: string[] = []): Promise<void> {
  void _args;
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

async function cmdDemoReset(_args: string[] = []): Promise<void> {
  void _args;
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

async function cmdAnchor(_args: string[] = []): Promise<void> {
  void _args;
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

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

// 4-hourly VACUUM INTO snapshots with a SHA-256 manifest (PRD 14.6).
// Retention is enforced by the scheduler/ops runbook; the CLI keeps every
// manifest next to its snapshot so restore can verify before swapping.
async function cmdBackup(args: string[]): Promise<void> {
  const dir = flagValue(args, '--dir') ?? 'backups';
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(dir, `gridvault_${stamp}.db`);
  const db = openDatabase(databasePath());
  try {
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
    const head = db.prepare('SELECT MAX(log_index) AS m, COUNT(*) AS n FROM audit_logs').get() as {
      m: number | null;
      n: number;
    };
    const patients = db.prepare('SELECT COUNT(*) AS n FROM patients').get() as { n: number };
    const manifest = {
      file: path.basename(out),
      sha256: sha256File(out),
      created_at: new Date().toISOString(),
      ledger_head_index: head.m,
      ledger_entries: head.n,
      patients: patients.n
    };
    writeFileSync(`${out}.manifest.json`, JSON.stringify(manifest, null, 2));
    const { appendLedgerEntry } = await import('../ledger/append.js');
    appendLedgerEntry(
      db,
      {
        staff_id: 'SYSTEM',
        staff_role: 'unknown',
        ward: 'unknown',
        patient_id: 'SYSTEM',
        action: 'BACKUP_CREATED',
        details: { file: manifest.file, sha256: manifest.sha256, ledger_entries: manifest.ledger_entries }
      },
      {}
    );
    process.stdout.write(`backup: ${out} sha256=${manifest.sha256} entries=${manifest.ledger_entries}\n`);
  } finally {
    db.close();
  }
}

// Tested restore (AT-905): verify the manifest, restore to a scratch path,
// verify the chain, and only then swap into place.
async function cmdRestore(args: string[]): Promise<void> {
  const file = flagValue(args, '--file');
  if (file === undefined) {
    process.stderr.write('error: restore requires --file <backup.db>\n');
    process.exit(2);
  }
  const manifestPath = `${file}.manifest.json`;
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sha256: string };
    const actual = sha256File(file);
    if (actual !== manifest.sha256) {
      process.stderr.write(`error: manifest checksum mismatch for ${file}\n`);
      process.exit(2);
    }
  } else {
    process.stderr.write(`warning: no manifest for ${file}, restoring without checksum verification\n`);
  }
  const scratch = `${file}.restore-scratch.db`;
  copyFileSync(file, scratch);
  const scratchDb = openDatabase(scratch);
  try {
    const { verifyLedger } = await import('../ledger/verify.js');
    const report = verifyLedger(scratchDb);
    if (report.status !== 'HEALTHY') {
      process.stderr.write(`error: backup chain is ${report.status}, refusing to restore\n`);
      process.exit(2);
    }
  } finally {
    scratchDb.close();
  }
  const target = databasePath();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(`${target}${suffix}`, { force: true });
  }
  copyFileSync(scratch, target);
  rmSync(scratch, { force: true });
  const db = openDatabase(target);
  try {
    const { appendLedgerEntry } = await import('../ledger/append.js');
    appendLedgerEntry(
      db,
      {
        staff_id: 'SYSTEM',
        staff_role: 'unknown',
        ward: 'unknown',
        patient_id: 'SYSTEM',
        action: 'RESTORE_PERFORMED',
        details: { file: path.basename(file) }
      },
      {}
    );
  } finally {
    db.close();
  }
  process.stdout.write(`restore: ${file} verified and swapped into ${target}\n`);
}

// Key rotation: re-encrypt every sensitive column under key_version+1 with
// the new master key, in batches inside one transaction. Reads keep working
// across rotations because decrypt derives the DEK from the payload version.
async function cmdRotateKey(args: string[]): Promise<void> {
  const newKeyB64 = flagValue(args, '--new-key') ?? process.env.GRIDVAULT_NEW_MASTER_KEY;
  if (newKeyB64 === undefined) {
    process.stderr.write('error: rotate-key requires --new-key <base64> or GRIDVAULT_NEW_MASTER_KEY\n');
    process.exit(2);
  }
  const { FieldCrypto } = await import('../crypto/field-encryption.js');
  const oldCrypto = new FieldCrypto(masterKey());
  const newBytes = Buffer.from(newKeyB64.trim(), 'base64');
  if (newBytes.byteLength !== 32) {
    process.stderr.write('error: new key must decode to exactly 32 bytes\n');
    process.exit(2);
  }
  const newCrypto = new FieldCrypto(newBytes);
  const db = openDatabase(databasePath());
  try {
    const rows = db.prepare('SELECT * FROM clinical_data').all() as Array<{
      patient_id: string;
      hiv_status_enc: string;
      genotype_enc: string;
      pregnancy_status_enc: string | null;
      mental_health_notes_enc: string | null;
      key_version: number;
    }>;
    const run = db.transaction(() => {
      for (const row of rows) {
        const nextVersion = row.key_version + 1;
        const hiv = oldCrypto.decryptField(row.patient_id, 'hiv_status', row.hiv_status_enc);
        const geno = oldCrypto.decryptField(row.patient_id, 'genotype', row.genotype_enc);
        const preg =
          row.pregnancy_status_enc === null
            ? null
            : oldCrypto.decryptField(row.patient_id, 'pregnancy_status', row.pregnancy_status_enc);
        const mh =
          row.mental_health_notes_enc === null
            ? null
            : oldCrypto.decryptField(row.patient_id, 'mental_health_notes', row.mental_health_notes_enc);
        db.prepare(
          'UPDATE clinical_data SET hiv_status_enc = ?, genotype_enc = ?, pregnancy_status_enc = ?, mental_health_notes_enc = ?, key_version = ? WHERE patient_id = ?'
        ).run(
          newCrypto.encryptField(row.patient_id, 'hiv_status', hiv, nextVersion),
          newCrypto.encryptField(row.patient_id, 'genotype', geno, nextVersion),
          preg === null ? null : newCrypto.encryptField(row.patient_id, 'pregnancy_status', preg, nextVersion),
          mh === null ? null : newCrypto.encryptField(row.patient_id, 'mental_health_notes', mh, nextVersion),
          nextVersion,
          row.patient_id
        );
      }
    });
    run();
    process.stdout.write(`rotate-key: re-encrypted ${rows.length} clinical rows to key_version+1\n`);
  } finally {
    db.close();
  }
}

// Subject access (NDPA 34, AT-912): the complete chronological access history
// for one patient, verifiable against the ledger (indices + hashes).
async function cmdSubjectAccess(args: string[]): Promise<void> {
  const patient = flagValue(args, '--patient');
  if (patient === undefined) {
    process.stderr.write('error: subject-access requires --patient <hospital-number>\n');
    process.exit(2);
  }
  const db = openDatabase(databasePath());
  try {
    const prow = db.prepare('SELECT id, hospital_number, full_name FROM patients WHERE hospital_number = ?').get(patient) as
      | { id: string; hospital_number: string; full_name: string }
      | undefined;
    if (prow === undefined) {
      process.stderr.write(`error: unknown patient ${patient}\n`);
      process.exit(2);
    }
    const rows = db
      .prepare('SELECT log_index, timestamp, staff_id, staff_role, action, details, prev_hash, current_hash FROM audit_logs WHERE patient_id = ? ORDER BY log_index ASC')
      .all(prow.id) as Array<Record<string, unknown>>;
    const { verifyLedger } = await import('../ledger/verify.js');
    const report = verifyLedger(db);
    process.stdout.write(
      JSON.stringify(
        { patient: prow.hospital_number, entries: rows.length, chain: report.status, history: rows },
        null,
        2
      ) + '\n'
    );
  } finally {
    db.close();
  }
}

async function cmdCreateUser(args: string[]): Promise<void> {
  const staffId = flagValue(args, '--staff-id');
  const name = flagValue(args, '--name') ?? staffId ?? 'New User';
  const role = flagValue(args, '--role') ?? 'nurse';
  const ward = flagValue(args, '--ward') ?? 'ward_a';
  const shift = flagValue(args, '--shift') ?? 'morning';
  const password = flagValue(args, '--password');
  const pin = flagValue(args, '--pin') ?? '1234';
  if (staffId === undefined || password === undefined) {
    process.stderr.write('error: create-user requires --staff-id and --password\n');
    process.exit(2);
  }
  if (!['doctor', 'nurse', 'clerk', 'admin', 'cmo'].includes(role)) {
    process.stderr.write('error: unknown role ' + role + '\n');
    process.exit(2);
  }
  if (!['morning', 'afternoon', 'night'].includes(shift)) {
    process.stderr.write('error: unknown shift ' + shift + '\n');
    process.exit(2);
  }
  const argon2 = (await import('argon2')).default;
  const { v7: uuidv7 } = await import('uuid');
  const { appendLedgerEntry } = await import('../ledger/append.js');
  // Hash first (async), then a single short transaction for insert + entry.
  const pwHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  const pinHash = await argon2.hash(pin, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  const db = openDatabase(databasePath());
  try {
    const write = db.transaction(() => {
      db.prepare(
        "INSERT INTO users (id, staff_id, full_name, role, assigned_ward, assigned_shift, password_hash, pin_hash, account_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))"
      ).run(uuidv7(), staffId, name, role, ward, shift, pwHash, pinHash);
      appendLedgerEntry(
        db,
        { staff_id: 'SYSTEM', staff_role: 'unknown', ward: 'unknown', patient_id: 'SYSTEM', action: 'USER_CREATED', details: { staff_id: staffId, role, ward } },
        {}
      );
    });
    write();
    process.stdout.write('create-user: ' + staffId + ' [' + role + '/' + ward + '] created\n');
  } finally {
    db.close();
  }
}

function usage(): void {
  process.stdout.write(
    'usage: gv <seed|migrate|demo:reset|verify-ledger|export-ledger|anchor|demo:tamper|backup|restore|rotate-key|subject-access|create-user> [options]\n' +
      '  seed [--profile demo|load|empty]\n' +
      '  migrate\n' +
      '  demo:reset\n' +
      '  verify-ledger [--file ledger.jsonl] [--against-witness]\n' +
      '  export-ledger [--out ledger.jsonl]\n' +
      '  anchor\n' +
      '  demo:tamper [--index N] [--field staff_id] [--value V] [--i-understand-this-corrupts-the-ledger]\n' +
      '  backup [--dir backups]\n' +
      '  restore --file <backup.db>\n' +
      '  rotate-key --new-key <base64> (or GRIDVAULT_NEW_MASTER_KEY)\n' +
      '  subject-access --patient <hospital-number>\n' +
      '  create-user --staff-id <id> --password <pw> [--name N] [--role R] [--ward W] [--shift S] [--pin P]\n'
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'seed') {
    await cmdSeed(rest);
  } else if (command === 'migrate') {
    await cmdMigrate(rest);
  } else if (command === 'demo:reset') {
    await cmdDemoReset(rest);
  } else if (command === 'verify-ledger') {
    await cmdVerifyLedger(rest);
  } else if (command === 'export-ledger') {
    await cmdExportLedger(rest);
  } else if (command === 'anchor') {
    await cmdAnchor(rest);
  } else if (command === 'demo:tamper') {
    await cmdDemoTamper(rest);
  } else if (command === 'backup') {
    await cmdBackup(rest);
  } else if (command === 'restore') {
    await cmdRestore(rest);
  } else if (command === 'rotate-key') {
    await cmdRotateKey(rest);
  } else if (command === 'subject-access') {
    await cmdSubjectAccess(rest);
  } else if (command === 'create-user') {
    await cmdCreateUser(rest);
  } else {
    usage();
    process.exit(1);
  }
}

await main();
