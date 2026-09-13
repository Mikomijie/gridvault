import Database from 'better-sqlite3';

export type GridVaultDatabase = Database.Database;

/**
 * Open the GridVault SQLite database with the production pragmas.
 *
 * - WAL mode: crash-safe single-file durability, readers never block writers.
 * - foreign_keys = ON: relational integrity is enforced, not assumed.
 * - busy_timeout = 5000: concurrent ward terminals wait instead of
 *   surfacing SQLITE_BUSY (AGENTS.md failure playbook).
 * - synchronous = NORMAL: durable with WAL without paying full fsync per
 *   commit; safe against process crash and OS crash, not against power loss
 *   mid-checkpoint (bounded by the 4-hourly backup + offline cache design).
 */
export function openDatabase(path: string): GridVaultDatabase {
  const db: GridVaultDatabase = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}
