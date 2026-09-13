import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, type GridVaultDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { fixedClock, type Clock } from '../../src/clock.js';

export const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations'
);

export const TEST_CLOCK: Clock = fixedClock('2026-09-13T10:00:00Z');

/** Fixed 32-byte test master key. Never production key material. */
export const TEST_MASTER_KEY = Buffer.alloc(32, 9);

export function openTestDb(): GridVaultDatabase {
  return openDatabase(':memory:');
}

export function migrateTestDb(db: GridVaultDatabase): { applied: number[] } {
  return migrate(db, { migrationsDir: MIGRATIONS_DIR, clock: TEST_CLOCK });
}
