// GridVault authentication service (PRD 6.6).
//
// Route handlers parse (Zod) and serialize; everything here is the unit of
// work: credential verification, session-family management, lockout and the
// paired ledger entries. Authorization context (role, ward, shift) always
// comes from the server-side user row — request bodies carrying role/ward/
// shift are stripped by the route schema and never read here (AT-014).
//
// Every failure message is generic except the machine code: the password
// value never appears in a log, a ledger entry or an error body (AT-015).

import { v7 as uuidv7 } from 'uuid';
import type { GridVaultDatabase } from '../db/connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import { appendLedgerEntry } from '../ledger/append.js';
import {
  scheduledExtensionsRepository,
  sessionsRepository,
  usersRepository,
  type UserRow
} from '../db/repositories/users.js';
import { emergencyOverridesRepository } from '../db/repositories/overrides.js';
import { AppError } from '../http/errors.js';
import { dutyState, type DutyState } from '../policy/duty.js';
import { raiseAbuseAlert } from '../abuse/alerts.js';
import { shouldLockout } from '../abuse/rules/rule08-credential-stuffing.js';
import { isReuseOfRotatedToken } from '../abuse/rules/rule09-refresh-reuse.js';
import { IpRateLimiter, LOGIN_RATE_LIMIT_WINDOW_MS } from './rate-limit.js';
import { verifySecret } from './password.js';
import { hashRefreshToken, newRefreshToken, signAccessToken } from './tokens.js';

export interface AuthServiceOptions {
  db: GridVaultDatabase;
  clock?: Clock;
  timeZone?: string;
  jwtSecret: string;
  accessTokenTtlMinutes?: number;
  refreshTokenTtlHours?: number;
  maxLoginAttempts?: number;
  lockoutMinutes?: number;
  shiftGraceMinutes?: number;
  ipLimiter?: IpRateLimiter;
}

export interface RequestMeta {
  terminal_id?: string | null;
  source_ip?: string | null;
}

export interface AuthenticatedSubject {
  user: UserRow;
  sessionId: string;
  duty: DutyState;
}

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export const REFRESH_COOKIE_NAME = 'gv_refresh';

export interface PublicUser {
  id: string;
  staff_id: string;
  full_name: string;
  role: UserRow['role'];
  ward: string;
  shift: UserRow['assigned_shift'];
  duty_state: DutyState;
}

const GENERIC_LOGIN_MESSAGE = 'Invalid staff ID or password';

function msFromHours(hours: number): number {
  return hours * 3600000;
}

export class AuthService {
  private readonly db: GridVaultDatabase;
  private readonly clock: Clock;
  private readonly timeZone: string;
  private readonly jwtSecret: string;
  private readonly accessTtlMinutes: number;
  private readonly refreshTtlHours: number;
  private readonly maxAttempts: number;
  private readonly lockoutMinutes: number;
  private readonly graceMinutes: number;
  private readonly ipLimiter: IpRateLimiter;

  constructor(options: AuthServiceOptions) {
    if (options.jwtSecret.length === 0) {
      throw new Error('AuthService requires a JWT secret');
    }
    this.db = options.db;
    this.clock = options.clock ?? systemClock;
    this.timeZone = options.timeZone ?? 'Africa/Lagos';
    this.jwtSecret = options.jwtSecret;
    this.accessTtlMinutes = options.accessTokenTtlMinutes ?? 15;
    this.refreshTtlHours = options.refreshTokenTtlHours ?? 8;
    this.maxAttempts = options.maxLoginAttempts ?? 5;
    this.lockoutMinutes = options.lockoutMinutes ?? 15;
    this.graceMinutes = options.shiftGraceMinutes ?? 30;
    this.ipLimiter =
      options.ipLimiter ??
      new IpRateLimiter({
        maxAttempts: this.maxAttempts,
        windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
        lockoutMs: this.lockoutMinutes * 60000
      });
  }

  private stamp(at: Date = this.clock.now()): string {
    return formatIsoWithOffset(at, this.timeZone);
  }

  private dutyFor(user: UserRow, at: Date): DutyState {
    const extensions = scheduledExtensionsRepository(this.db).listActiveForUser(
      user.id,
      at.toISOString()
    );
    return dutyState({
      shift: user.assigned_shift,
      at,
      timeZone: this.timeZone,
      graceMinutes: this.graceMinutes,
      extensions
    });
  }

  refreshCookieMaxAgeMs(): number {
    return msFromHours(this.refreshTtlHours);
  }

  toPublicUser(user: UserRow, at: Date = this.clock.now()): PublicUser {
    return {
      id: user.id,
      staff_id: user.staff_id,
      full_name: user.full_name,
      role: user.role,
      ward: user.assigned_ward,
      shift: user.assigned_shift,
      duty_state: this.dutyFor(user, at)
    };
  }

  async login(input: {
    staff_id: string;
    password: string;
    terminal_id?: string | null;
    source_ip?: string | null;
  }): Promise<LoginResult> {
    const now = this.clock.now();
    const at = this.stamp(now);
    const terminalId = input.terminal_id ?? null;
    const sourceIp = input.source_ip ?? null;
    const users = usersRepository(this.db);

    const user = users.findByStaffId(input.staff_id);
    if (user === undefined) {
      appendLedgerEntry(
        this.db,
        {
          staff_id: 'UNKNOWN',
          staff_role: 'unknown',
          ward: 'unknown',
          patient_id: 'SYSTEM',
          action: 'LOGIN_FAILED',
          details: { reason: 'unknown_staff_id', terminal_id: terminalId },
          terminal_id: terminalId,
          source_ip: sourceIp,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      throw new AppError({
        code: 'INVALID_CREDENTIALS',
        httpStatus: 401,
        message: GENERIC_LOGIN_MESSAGE
      });
    }

    if (user.locked_until !== null && Date.parse(user.locked_until) > now.getTime()) {
      appendLedgerEntry(
        this.db,
        {
          staff_id: user.staff_id,
          staff_role: user.role,
          ward: user.assigned_ward,
          patient_id: 'SYSTEM',
          action: 'LOGIN_FAILED',
          details: { reason: 'account_locked', terminal_id: terminalId },
          terminal_id: terminalId,
          source_ip: sourceIp,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      throw new AppError({
        code: 'ACCOUNT_LOCKED',
        httpStatus: 429,
        message: 'Too many failed attempts. The account is temporarily locked.'
      });
    }

    if (user.account_status !== 'active') {
      throw new AppError({
        code: 'ACCOUNT_INACTIVE',
        httpStatus: 401,
        message: 'This account is not active'
      });
    }
    if (user.expires_at !== null && Date.parse(user.expires_at) <= now.getTime()) {
      throw new AppError({
        code: 'ACCOUNT_EXPIRED',
        httpStatus: 401,
        message: 'This account has expired'
      });
    }

    if (sourceIp !== null && this.ipLimiter.isLocked(sourceIp, now.getTime())) {
      throw new AppError({
        code: 'ACCOUNT_LOCKED',
        httpStatus: 429,
        message: 'Too many failed attempts. Try again later.'
      });
    }

    const ok = await verifySecret(user.password_hash, input.password);
    if (!ok) {
      if (sourceIp !== null) {
        this.ipLimiter.recordFailure(sourceIp, now.getTime());
      }
      const failures = user.failed_attempts + 1;
      const locked = shouldLockout(failures, this.maxAttempts);
      const lockedUntil = locked
        ? this.stamp(new Date(now.getTime() + this.lockoutMinutes * 60000))
        : null;
      const write = this.db.transaction(() => {
        users.recordFailedAttempt(user.staff_id, failures, lockedUntil, at);
        appendLedgerEntry(
          this.db,
          {
            staff_id: user.staff_id,
            staff_role: user.role,
            ward: user.assigned_ward,
            patient_id: 'SYSTEM',
            action: 'LOGIN_FAILED',
            details: {
              reason: locked ? 'locked_after_failures' : 'bad_password',
              failures,
              terminal_id: terminalId
            },
            terminal_id: terminalId,
            source_ip: sourceIp,
            timestamp: at
          },
          { clock: this.clock, timeZone: this.timeZone }
        );
        if (locked) {
          raiseAbuseAlert(
            this.db,
            {
              staff_id: user.staff_id,
              patient_id: 'SYSTEM',
              rule_triggered: 'RULE-ABUSE-08',
              severity: 'WARNING',
              facts: { failures, window: '10m', lockout_minutes: this.lockoutMinutes },
              terminal_id: terminalId,
              source_ip: sourceIp,
              staff_role: user.role,
              ward: user.assigned_ward
            },
            { clock: this.clock, timeZone: this.timeZone }
          );
        }
      });
      write();
      if (locked) {
        throw new AppError({
          code: 'ACCOUNT_LOCKED',
          httpStatus: 429,
          message: 'Too many failed attempts. The account is temporarily locked.'
        });
      }
      throw new AppError({
        code: 'INVALID_CREDENTIALS',
        httpStatus: 401,
        message: GENERIC_LOGIN_MESSAGE
      });
    }

    if (sourceIp !== null) {
      this.ipLimiter.recordSuccess(sourceIp);
    }
    const sessionId = uuidv7();
    const familyId = uuidv7();
    const refreshToken = newRefreshToken();
    const refreshExpiresAt = this.stamp(new Date(now.getTime() + msFromHours(this.refreshTtlHours)));
    const write = this.db.transaction(() => {
      users.resetLoginState(user.staff_id, at);
      sessionsRepository(this.db).insert({
        id: sessionId,
        user_id: user.id,
        family_id: familyId,
        refresh_hash: hashRefreshToken(refreshToken),
        terminal_id: terminalId,
        source_ip: sourceIp,
        issued_at: at,
        expires_at: refreshExpiresAt,
        revoked_at: null,
        revoked_reason: null
      });
      appendLedgerEntry(
        this.db,
        {
          staff_id: user.staff_id,
          staff_role: user.role,
          ward: user.assigned_ward,
          patient_id: 'SYSTEM',
          action: 'LOGIN',
          details: { session_id: sessionId, terminal_id: terminalId },
          session_id: sessionId,
          terminal_id: terminalId,
          source_ip: sourceIp,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    write();

    const accessToken = signAccessToken(
      {
        sub: user.id,
        staff_id: user.staff_id,
        role: user.role,
        ward: user.assigned_ward,
        shift: user.assigned_shift,
        session_id: sessionId
      },
      this.jwtSecret,
      this.accessTtlMinutes
    );
    return {
      user: this.toPublicUser({ ...user, failed_attempts: 0, locked_until: null }, now),
      accessToken,
      refreshToken,
      expiresInSeconds: this.accessTtlMinutes * 60
    };
  }

  async refresh(input: {
    refreshToken: string;
    terminal_id?: string | null;
    source_ip?: string | null;
  }): Promise<{ accessToken: string; refreshToken: string; expiresInSeconds: number }> {
    const now = this.clock.now();
    const at = this.stamp(now);
    const sessions = sessionsRepository(this.db);
    const row = sessions.findByRefreshHash(hashRefreshToken(input.refreshToken));
    if (row === undefined) {
      throw new AppError({
        code: 'INVALID_REFRESH',
        httpStatus: 401,
        message: 'The session is no longer valid'
      });
    }
    const user = usersRepository(this.db).findById(row.user_id);
    if (user === undefined || user.account_status !== 'active') {
      throw new AppError({
        code: 'INVALID_REFRESH',
        httpStatus: 401,
        message: 'The session is no longer valid'
      });
    }
    if (row.revoked_at !== null) {
      if (isReuseOfRotatedToken(row.revoked_reason)) {
        // Reuse of a rotated token: the family is compromised. Kill it and
        // raise RULE-ABUSE-09 CRITICAL (AT-019).
        const kill = this.db.transaction(() => {
          sessions.revokeFamily(row.family_id, 'reuse_detected', at);
          raiseAbuseAlert(
            this.db,
            {
              staff_id: user.staff_id,
              patient_id: 'SYSTEM',
              rule_triggered: 'RULE-ABUSE-09',
              severity: 'CRITICAL',
              facts: { family_id: row.family_id, session_id: row.id },
              session_id: row.id,
              terminal_id: row.terminal_id,
              source_ip: input.source_ip ?? row.source_ip,
              staff_role: user.role,
              ward: user.assigned_ward
            },
            { clock: this.clock, timeZone: this.timeZone }
          );
        });
        kill();
      }
      throw new AppError({
        code: 'SESSION_REVOKED',
        httpStatus: 401,
        message: 'The session is no longer valid. Please log in again.'
      });
    }
    if (Date.parse(row.expires_at) <= now.getTime()) {
      sessions.revokeSession(row.id, 'expired', at);
      throw new AppError({
        code: 'SESSION_REVOKED',
        httpStatus: 401,
        message: 'The session has expired. Please log in again.'
      });
    }

    const nextSessionId = uuidv7();
    const nextRefresh = newRefreshToken();
    const rotate = this.db.transaction(() => {
      sessions.revokeSession(row.id, 'rotated', at);
      sessions.insert({
        id: nextSessionId,
        user_id: row.user_id,
        family_id: row.family_id,
        refresh_hash: hashRefreshToken(nextRefresh),
        terminal_id: input.terminal_id ?? row.terminal_id,
        source_ip: input.source_ip ?? row.source_ip,
        issued_at: at,
        expires_at: row.expires_at,
        revoked_at: null,
        revoked_reason: null
      });
    });
    rotate();

    const accessToken = signAccessToken(
      {
        sub: user.id,
        staff_id: user.staff_id,
        role: user.role,
        ward: user.assigned_ward,
        shift: user.assigned_shift,
        session_id: nextSessionId
      },
      this.jwtSecret,
      this.accessTtlMinutes
    );
    return { accessToken, refreshToken: nextRefresh, expiresInSeconds: this.accessTtlMinutes * 60 };
  }

  logout(subject: AuthenticatedSubject, meta: RequestMeta = {}): void {
    const at = this.stamp();
    const write = this.db.transaction(() => {
      sessionsRepository(this.db).revokeSession(subject.sessionId, 'logout', at);
      appendLedgerEntry(
        this.db,
        {
          staff_id: subject.user.staff_id,
          staff_role: subject.user.role,
          ward: subject.user.assigned_ward,
          patient_id: 'SYSTEM',
          action: 'LOGOUT',
          details: { session_id: subject.sessionId },
          session_id: subject.sessionId,
          terminal_id: meta.terminal_id ?? null,
          source_ip: meta.source_ip ?? null,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      // A grant does not survive logout (PRD 7.2 lifecycle): close every
      // ACTIVE grant so the next login starts without emergency access.
      const grants = emergencyOverridesRepository(this.db).listActiveForStaff(subject.user.staff_id);
      for (const grant of grants) {
        this.db
          .prepare("UPDATE emergency_overrides SET state = 'CLOSED', closed_at = ? WHERE id = ?")
          .run(at, grant.id);
        appendLedgerEntry(
          this.db,
          {
            staff_id: subject.user.staff_id,
            staff_role: subject.user.role,
            ward: grant.ward,
            patient_id: grant.patient_id,
            action: 'EMERGENCY_OVERRIDE_CLOSED',
            details: { override_id: grant.id, reason: 'logout' },
            session_id: subject.sessionId,
            terminal_id: meta.terminal_id ?? null,
            source_ip: meta.source_ip ?? null,
            timestamp: at
          },
          { clock: this.clock, timeZone: this.timeZone }
        );
      }
    });
    write();
  }

  recordLock(subject: AuthenticatedSubject, meta: RequestMeta = {}): void {
    appendLedgerEntry(
      this.db,
      {
        staff_id: subject.user.staff_id,
        staff_role: subject.user.role,
        ward: subject.user.assigned_ward,
        patient_id: 'SYSTEM',
        action: 'SESSION_LOCK',
        details: { session_id: subject.sessionId, reason: 'idle_lock' },
        session_id: subject.sessionId,
        terminal_id: meta.terminal_id ?? null,
        source_ip: meta.source_ip ?? null
      },
      { clock: this.clock, timeZone: this.timeZone }
    );
  }

  async unlock(
    subject: AuthenticatedSubject,
    pin: string,
    meta: RequestMeta = {}
  ): Promise<{ accessToken: string; expiresInSeconds: number }> {
    const ok = await verifySecret(subject.user.pin_hash, pin);
    if (!ok) {
      throw new AppError({ code: 'INVALID_PIN', httpStatus: 401, message: 'Incorrect PIN' });
    }
    appendLedgerEntry(
      this.db,
      {
        staff_id: subject.user.staff_id,
        staff_role: subject.user.role,
        ward: subject.user.assigned_ward,
        patient_id: 'SYSTEM',
        action: 'SESSION_UNLOCK',
        details: { session_id: subject.sessionId },
        session_id: subject.sessionId,
        terminal_id: meta.terminal_id ?? null,
        source_ip: meta.source_ip ?? null
      },
      { clock: this.clock, timeZone: this.timeZone }
    );
    const accessToken = signAccessToken(
      {
        sub: subject.user.id,
        staff_id: subject.user.staff_id,
        role: subject.user.role,
        ward: subject.user.assigned_ward,
        shift: subject.user.assigned_shift,
        session_id: subject.sessionId
      },
      this.jwtSecret,
      this.accessTtlMinutes
    );
    return { accessToken, expiresInSeconds: this.accessTtlMinutes * 60 };
  }

  /** /api/auth/me: user + duty state + currently active break-glass grants. */
  me(subject: AuthenticatedSubject): {
    user: PublicUser;
    session_id: string;
    active_grants: Array<{ id: string; patient_id: string; expires_at: string }>;
  } {
    const now = this.clock.now();
    // Expiry is compared as instants in JS: stored timestamps carry the
    // facility offset, so lexicographic SQL comparison would be wrong.
    const grants = emergencyOverridesRepository(this.db)
      .listActiveForStaff(subject.user.staff_id)
      .filter((row) => Date.parse(row.expires_at) > now.getTime())
      .map((row) => ({ id: row.id, patient_id: row.patient_id, expires_at: row.expires_at }));
    return {
      user: this.toPublicUser(subject.user, now),
      session_id: subject.sessionId,
      active_grants: grants
    };
  }
}
