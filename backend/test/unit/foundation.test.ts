// Foundation unit tests: clinical status derivation, outbox delivery,
// password hashing, rate limiting, tokens, config validation, security
// headers and migration failures. Pure, fast and deterministic (one real
// argon2id hash is the only slow step).

import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { deriveStatus, parseBloodPressure } from '../../src/records/status.js';
import {
  dispatchPending,
  LocalLogDriver,
  queueOutbox,
  type NotifyDriver
} from '../../src/notify/outbox.js';
import { hashSecret, verifySecret } from '../../src/auth/password.js';
import { IpRateLimiter } from '../../src/auth/rate-limit.js';
import { signAccessToken, TokenError, verifyAccessToken } from '../../src/auth/tokens.js';
import { ConfigError, loadConfig } from '../../src/config/env.js';
import { securityHeaders } from '../../src/http/middleware/security.js';
import { migrate, MigrationError } from '../../src/db/migrate.js';
import { TEST_JWT_SECRET } from '../helpers/app.js';
import { MIGRATIONS_DIR, openTestDb } from '../helpers/db.js';

const BASE = { heart_rate: 78, blood_pressure: '120/80', spo2: 98, temperature: 36.8 };

describe('foundation units', () => {
  it('parseBloodPressure accepts spaced readings and rejects garbage', () => {
    expect(parseBloodPressure('120/80')).toEqual({ systolic: 120, diastolic: 80 });
    expect(parseBloodPressure(' 158 / 95 ')).toEqual({ systolic: 158, diastolic: 95 });
    expect(parseBloodPressure('120')).toBeNull();
    expect(parseBloodPressure('abc/def')).toBeNull();
    expect(parseBloodPressure('120/80/90')).toBeNull();
  });

  it('deriveStatus trips critical, observation and stable on every arm', () => {
    expect(deriveStatus(BASE)).toBe('stable');
    const critical = [
      { ...BASE, spo2: 89 },
      { ...BASE, blood_pressure: '85/50' },
      { ...BASE, blood_pressure: '185/100' },
      { ...BASE, blood_pressure: '120/125' },
      { ...BASE, heart_rate: 39 },
      { ...BASE, heart_rate: 131 },
      { ...BASE, temperature: 39.6 },
      { ...BASE, temperature: 34.9 }
    ];
    for (const reading of critical) {
      expect(deriveStatus(reading)).toBe('critical');
    }
    const observation = [
      { ...BASE, spo2: 94 },
      { ...BASE, blood_pressure: '145/80' },
      { ...BASE, blood_pressure: '120/95' },
      { ...BASE, heart_rate: 49 },
      { ...BASE, heart_rate: 111 },
      { ...BASE, temperature: 38.2 }
    ];
    for (const reading of observation) {
      expect(deriveStatus(reading)).toBe('observation');
    }
    // An unreadable cuff never upgrades triage by itself.
    expect(deriveStatus({ ...BASE, blood_pressure: 'n/a' })).toBe('stable');
  });

  it('outbox queues, dispatches, and records failures without losing rows', async () => {
    const db = openTestDb();
    try {
      const { migrateTestDb } = await import('../helpers/db.js');
      migrateTestDb(db);
      const id = queueOutbox(db, {
        channel: 'local',
        recipient: 'GV-9101',
        subject: 'Emergency override granted',
        body: 'review required',
        priority: 'HIGH',
        related_type: 'override',
        related_id: 'ov_1'
      });
      expect(typeof id).toBe('string');
      const empty = await dispatchPending(db, new LocalLogDriver());
      expect(empty).toEqual({ attempted: 1, dispatched: 1, failed: 0 });

      const failing: NotifyDriver = {
        name: 'failing',
        dispatch: async () => {
          throw new Error('CMO phone unreachable');
        }
      };
      queueOutbox(db, {
        channel: 'local',
        recipient: 'charge_nurse:ward_a',
        subject: 's',
        body: 'b',
        priority: 'NORMAL'
      });
      const failed = await dispatchPending(db, failing);
      expect(failed).toEqual({ attempted: 1, dispatched: 0, failed: 1 });
      const row = db.prepare('SELECT attempts, last_error, status FROM notification_outbox WHERE subject = ?').get('s') as {
        attempts: number;
        last_error: string;
        status: string;
      };
      expect(row.attempts).toBe(1);
      expect(row.last_error).toContain('CMO phone unreachable');
      expect(row.status).toBe('PENDING');

      const stringThrower: NotifyDriver = {
        name: 'string-thrower',
        dispatch: async () => {
          throw 'non-error-driver-failure';
        }
      };
      const stringy = await dispatchPending(db, stringThrower);
      // Only the still-pending row is attempted; a thrown string still
      // records a usable last_error instead of crashing the worker.
      expect(stringy).toEqual({ attempted: 1, dispatched: 0, failed: 1 });
      const row2 = db.prepare('SELECT last_error FROM notification_outbox WHERE subject = ?').get('s') as {
        last_error: string;
      };
      expect(row2.last_error).toBe('dispatch failed');

      const idle = await dispatchPending(db, new LocalLogDriver());
      expect(idle).toEqual({ attempted: 1, dispatched: 1, failed: 0 });
    } finally {
      db.close();
    }
  });

  it('password hashing round-trips and fails closed on wrong or malformed input', async () => {
    const hash = await hashSecret('correct-horse-ward');
    expect(await verifySecret(hash, 'correct-horse-ward')).toBe(true);
    expect(await verifySecret(hash, 'wrong-horse-ward')).toBe(false);
    expect(await verifySecret('not-a-hash', 'anything')).toBe(false);
  });

  it('IP rate limiter locks, expires and resets', () => {
    const limiter = new IpRateLimiter({ maxAttempts: 3, windowMs: 60000, lockoutMs: 900000 });
    expect(limiter.isLocked('10.0.0.1', 0)).toBe(false);
    limiter.recordFailure('10.0.0.1', 0);
    limiter.recordFailure('10.0.0.1', 1000);
    expect(limiter.isLocked('10.0.0.1', 2000)).toBe(false);
    limiter.recordFailure('10.0.0.1', 2000);
    expect(limiter.isLocked('10.0.0.1', 2001)).toBe(true);
    // Window expiry clears the bucket.
    expect(limiter.isLocked('10.0.0.1', 70000)).toBe(false);
    limiter.recordFailure('10.0.0.2', 0);
    limiter.recordSuccess('10.0.0.2');
    expect(limiter.isLocked('10.0.0.2', 1000)).toBe(false);
  });

  it('tokens verify, expire and reject foreign or claim-stripped JWTs', () => {
    const token = signAccessToken(
      { sub: 'u1', staff_id: 'SN-7742', role: 'nurse', ward: 'ward_a', shift: 'morning', session_id: 's1' },
      TEST_JWT_SECRET,
      15
    );
    const claims = verifyAccessToken(TEST_JWT_SECRET, token);
    expect(claims.staff_id).toBe('SN-7742');
    expect(claims.policy_version).toBe('2.0.0');
    expect(() => verifyAccessToken('wrong-secret-minimum-32-chars-long!!', token)).toThrowError(TokenError);
    const stripped = jwt.sign({ sub: 'u1' }, TEST_JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
    expect(() => verifyAccessToken(TEST_JWT_SECRET, stripped)).toThrowError(/missing required claims/);
    const expired = jwt.sign(
      {
        sub: 'u1',
        staff_id: 'SN-7742',
        role: 'nurse',
        ward: 'ward_a',
        shift: 'morning',
        session_id: 's1',
        jti: 'j1'
      },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '-10s' }
    );
    expect(() => verifyAccessToken(TEST_JWT_SECRET, expired)).toThrowError(/expired/i);
  });

  it('config names the offending variable, including root-level failures', () => {
    expect(() => loadConfig(null as unknown as NodeJS.ProcessEnv)).toThrowError(ConfigError);
    try {
      loadConfig(null as unknown as NodeJS.ProcessEnv);
      expect.unreachable();
    } catch (error) {
      expect((error as ConfigError).variable).toBe('environment');
    }
    expect(() =>
      loadConfig({ ...process.env, NODE_ENV: 'production', DEMO_MODE: 'true' })
    ).toThrowError(/DEMO_MODE/);
  });

  it('security headers emit the PRD 14.2 set and gate CORS origins', () => {
    const seen: Record<string, string> = {};
    const res = { setHeader: (name: string, value: string): void => void (seen[name] = value) };
    let nextCalled = false;
    securityHeaders({ allowedOrigins: ['https://ward.local'] })(
      { headers: {} },
      res,
      () => void (nextCalled = true)
    );
    expect(nextCalled).toBe(true);
    expect(seen['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(seen['Content-Security-Policy']).not.toContain('unsafe-inline');
    expect(seen['X-Frame-Options']).toBe('DENY');
    expect(seen['Access-Control-Allow-Origin']).toBeUndefined();

    const seen2: Record<string, string> = {};
    securityHeaders({ allowedOrigins: ['https://ward.local'] })(
      { headers: { origin: 'https://ward.local' } },
      { setHeader: (name: string, value: string): void => void (seen2[name] = value) },
      () => undefined
    );
    expect(seen2['Access-Control-Allow-Origin']).toBe('https://ward.local');
    expect(seen2['Vary']).toBe('Origin');

    const seen3: Record<string, string> = {};
    securityHeaders({ allowedOrigins: ['https://ward.local'] })(
      { headers: { origin: 'https://evil.example' } },
      { setHeader: (name: string, value: string): void => void (seen3[name] = value) },
      () => undefined
    );
    expect(seen3['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('migrate refuses older-than-applied versions and surfaces apply failures', async () => {
    const { mkdtempSync, writeFileSync, cpSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const path = (await import('node:path')).default;
    const dir = mkdtempSync(path.join(tmpdir(), 'gv-migrate-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const db = openTestDb();
    try {
      // Apply with a gap: 002 arrives later than the 003 head.
      await import('node:fs').then((fs) => fs.rmSync(path.join(dir, '002_anchor_facility.sql')));
      const first = migrate(db, { migrationsDir: dir });
      expect(first.applied).toEqual([1, 3]);
      const maxApplied = Math.max(...first.applied);
      // A file older than the applied head is forward-only rejected and
      // names the migration — history cannot be rewritten underneath us.
      cpSync(
        path.join(MIGRATIONS_DIR, '002_anchor_facility.sql'),
        path.join(dir, '002_anchor_facility.sql')
      );
      try {
        migrate(db, { migrationsDir: dir });
        expect.unreachable('forward-only violation must throw');
      } catch (error) {
        expect(error).toBeInstanceOf(MigrationError);
        expect((error as MigrationError).migration).toContain('002_anchor_facility');
      }
      await import('node:fs').then((fs) => fs.rmSync(path.join(dir, '002_anchor_facility.sql')));
      // A new file with invalid SQL fails with the migration named.
      writeFileSync(
        path.join(dir, `${String(maxApplied + 1).padStart(3, '0')}_broken.sql`),
        'CREATE TABLE broken (id TEXT',
        'utf8'
      );
      try {
        migrate(db, { migrationsDir: dir });
        expect.unreachable('broken migration must throw');
      } catch (error) {
        expect(error).toBeInstanceOf(MigrationError);
        expect((error as MigrationError).message).toContain('failed to apply');
      }
      // Stray filenames are never silently skipped.
      const { parseMigrationFilename } = await import('../../src/db/migrate.js');
      expect(() => parseMigrationFilename('notes.txt', dir)).toThrowError(MigrationError);
    } finally {
      db.close();
    }
  });
});
