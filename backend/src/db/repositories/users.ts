// Identity repositories: users, sessions, scheduled_extensions.
// Hand-written SQL, always parameterised. No query is built by string
// interpolation; see the gridvault/no-template-literal-sql lint rule.

import type { GridVaultDatabase } from '../connection.js';

export type UserRole = 'doctor' | 'nurse' | 'clerk' | 'admin' | 'cmo';
export type AssignedShift = 'morning' | 'afternoon' | 'night';
export type AccountStatus = 'active' | 'suspended' | 'expired';

export interface UserRow {
  id: string;
  staff_id: string;
  full_name: string;
  role: UserRole;
  assigned_ward: string;
  assigned_shift: AssignedShift;
  password_hash: string;
  pin_hash: string;
  account_status: AccountStatus;
  expires_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  refresh_hash: string;
  terminal_id: string | null;
  source_ip: string | null;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface ScheduledExtensionRow {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  approved_by: string;
  reason: string;
  created_at: string;
}

export function usersRepository(db: GridVaultDatabase) {
  return {
    insert(row: UserRow): void {
      db.prepare(
        'INSERT INTO users (id, staff_id, full_name, role, assigned_ward, assigned_shift, ' +
          'password_hash, pin_hash, account_status, expires_at, failed_attempts, locked_until, ' +
          'created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.staff_id,
        row.full_name,
        row.role,
        row.assigned_ward,
        row.assigned_shift,
        row.password_hash,
        row.pin_hash,
        row.account_status,
        row.expires_at,
        row.failed_attempts,
        row.locked_until,
        row.created_at,
        row.updated_at
      );
    },
    findByStaffId(staffId: string): UserRow | undefined {
      return db.prepare('SELECT * FROM users WHERE staff_id = ?').get(staffId) as
        | UserRow
        | undefined;
    },
    findById(id: string): UserRow | undefined {
      return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    },
    recordFailedAttempt(staffId: string, failedAttempts: number, lockedUntil: string | null, at: string): void {
      db.prepare(
        'UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE staff_id = ?'
      ).run(failedAttempts, lockedUntil, at, staffId);
    },
    resetLoginState(staffId: string, at: string): void {
      db.prepare(
        'UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE staff_id = ?'
      ).run(at, staffId);
    },
    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
      return row.n;
    },
    listStaffIds(): string[] {
      const rows = db.prepare('SELECT staff_id FROM users ORDER BY staff_id ASC').all() as Array<{
        staff_id: string;
      }>;
      return rows.map((r) => r.staff_id);
    }
  };
}

export function sessionsRepository(db: GridVaultDatabase) {
  return {
    insert(row: SessionRow): void {
      db.prepare(
        'INSERT INTO sessions (id, user_id, family_id, refresh_hash, terminal_id, source_ip, ' +
          'issued_at, expires_at, revoked_at, revoked_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.user_id,
        row.family_id,
        row.refresh_hash,
        row.terminal_id,
        row.source_ip,
        row.issued_at,
        row.expires_at,
        row.revoked_at,
        row.revoked_reason
      );
    },
    findById(id: string): SessionRow | undefined {
      return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
        | SessionRow
        | undefined;
    },
    listByFamily(familyId: string): SessionRow[] {
      return db.prepare('SELECT * FROM sessions WHERE family_id = ?').all(familyId) as SessionRow[];
    },
    findByRefreshHash(refreshHash: string): SessionRow | undefined {
      return db.prepare('SELECT * FROM sessions WHERE refresh_hash = ?').get(refreshHash) as
        | SessionRow
        | undefined;
    },
    revokeSession(id: string, reason: string, at: string): void {
      db.prepare(
        'UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL'
      ).run(at, reason, id);
    },
    revokeFamily(familyId: string, reason: string, at: string): number {
      const result = db
        .prepare(
          'UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE family_id = ? AND revoked_at IS NULL'
        )
        .run(at, reason, familyId);
      return Number(result.changes);
    }
  };
}

export function scheduledExtensionsRepository(db: GridVaultDatabase) {
  return {
    insert(row: ScheduledExtensionRow): void {
      db.prepare(
        'INSERT INTO scheduled_extensions (id, user_id, starts_at, ends_at, approved_by, reason, created_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        row.id,
        row.user_id,
        row.starts_at,
        row.ends_at,
        row.approved_by,
        row.reason,
        row.created_at
      );
    },
    listActiveForUser(userId: string, at: string): ScheduledExtensionRow[] {
      return db
        .prepare(
          'SELECT * FROM scheduled_extensions WHERE user_id = ? AND starts_at <= ? AND ends_at > ?'
        )
        .all(userId, at, at) as ScheduledExtensionRow[];
    }
  };
}
