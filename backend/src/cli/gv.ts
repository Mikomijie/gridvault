// GridVault operator CLI: `npm run gv -- <command>`.
//
// Phase 1 implements `seed`, `migrate` and `demo:reset`. Later phases add
// verify-ledger, export-ledger, anchor, backup, restore, rotate-key,
// subject-access, create-user and demo:tamper alongside their features.

import { rmSync } from 'node:fs';
import { openDatabase } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
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

function usage(): void {
  process.stdout.write('usage: gv <seed|migrate|demo:reset> [--profile demo|load|empty]\n');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'seed') {
    await cmdSeed(rest);
  } else if (command === 'migrate') {
    await cmdMigrate();
  } else if (command === 'demo:reset') {
    await cmdDemoReset();
  } else {
    usage();
    process.exit(1);
  }
}

await main();
