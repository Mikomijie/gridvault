import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { GridVaultDatabase } from './connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';

export const MIGRATIONS_TABLE = 'schema_migrations';

export class MigrationError extends Error {
  readonly migration: string;
  constructor(migration: string, message: string) {
    super(message);
    this.name = 'MigrationError';
    this.migration = migration;
  }
}

export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  filePath: string;
}

export interface MigrationRecord {
  version: number;
  name: string;
  checksum: string;
}

export interface MigrateOptions {
  migrationsDir: string;
  clock?: Clock;
  timeZone?: string;
}

export interface MigrateResult {
  applied: number[];
}

/**
 * Parse a migration filename of the form `NNN_name.sql`.
 * Throws MigrationError for anything that does not match, so a stray file
 * can never be silently skipped or applied out of order.
 */
export function parseMigrationFilename(filename: string, dir: string): MigrationFile {
  const match = /^(\d{3,})_([a-z0-9_]+)\.sql$/.exec(filename);
  if (match === null) {
    throw new MigrationError(filename, `Invalid migration filename: ${filename}`);
  }
  return {
    version: Number(match[1]),
    name: match[2] as string,
    filename,
    filePath: path.join(dir, filename)
  };
}

export function listMigrationFiles(migrationsDir: string): MigrationFile[] {
  const entries = readdirSync(migrationsDir).filter((entry) => entry.endsWith('.sql'));
  const files = entries.map((entry) => parseMigrationFilename(entry, migrationsDir));
  files.sort((a, b) => a.version - b.version);
  const seen = new Set<number>();
  for (const file of files) {
    if (seen.has(file.version)) {
      throw new MigrationError(
        file.filename,
        `Duplicate migration version: ${file.version}`
      );
    }
    seen.add(file.version);
  }
  return files;
}

export function checksumMigration(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

function readAppliedMigrations(db: GridVaultDatabase): MigrationRecord[] {
  const table = db
    .prepare(
      'SELECT name FROM sqlite_master WHERE type = ? AND name = ?'
    )
    .get('table', MIGRATIONS_TABLE) as { name: string } | undefined;
  if (table === undefined) {
    return [];
  }
  const rows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC')
    .all() as MigrationRecord[];
  return rows;
}

/**
 * Apply pending migrations, forward-only, each inside its own transaction
 * together with its checksum record.
 *
 * - Idempotent: re-running with unchanged files applies nothing.
 * - Fail closed: if a file's checksum no longer matches the recorded value
 *   for that version, migration refuses to run and names the migration.
 * - Forward-only: a file older than an already-applied version is rejected
 *   instead of being applied out of order.
 */
export function migrate(db: GridVaultDatabase, options: MigrateOptions): MigrateResult {
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const files = listMigrationFiles(options.migrationsDir);
  const appliedRecords = readAppliedMigrations(db);
  const appliedByVersion = new Map<number, MigrationRecord>(
    appliedRecords.map((record) => [record.version, record])
  );
  const maxApplied =
    appliedRecords.length === 0 ? 0 : Math.max(...appliedRecords.map((r) => r.version));

  const applied: number[] = [];

  for (const file of files) {
    const sql = readFileSync(file.filePath, 'utf8');
    const checksum = checksumMigration(sql);
    const recorded = appliedByVersion.get(file.version);

    if (recorded !== undefined) {
      if (recorded.checksum !== checksum) {
        throw new MigrationError(
          file.filename,
          `Migration ${file.filename} checksum mismatch: recorded ${recorded.checksum} ` +
            `but file now hashes to ${checksum}. Recorded migrations are immutable.`
        );
      }
      continue;
    }

    if (file.version < maxApplied) {
      throw new MigrationError(
        file.filename,
        `Migration ${file.filename} is older than already-applied version ${maxApplied}: forward-only.`
      );
    }

    const appliedAt = formatIsoWithOffset(clock.now(), timeZone);
    const runOne = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)'
      ).run(file.version, file.name, appliedAt, checksum);
    });
    try {
      runOne();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new MigrationError(
        file.filename,
        `Migration ${file.filename} failed to apply: ${detail}`
      );
    }
    applied.push(file.version);
  }

  return { applied };
}
