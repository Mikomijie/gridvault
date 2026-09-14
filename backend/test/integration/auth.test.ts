import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { auditLogsRepository } from '../../src/db/repositories/ledger.js';
import { abuseAlertsRepository } from '../../src/db/repositories/security.js';
import { sessionsRepository, usersRepository } from '../../src/db/repositories/users.js';
import { scheduledExtensionsRepository } from '../../src/db/repositories/users.js';
import { v7 as uuidv7 } from 'uuid';
import { openTestDb } from '../helpers/db.js';
import {
  AFTERNOON_CLOCK,
  TEST_JWT_SECRET,
  TEST_TIME_ZONE,
  createSeededStack,
  createTestStack,
  demoPassword,
  type TestStack
} from '../helpers/app.js';
import { createApp } from '../../src/http/app.js';
import { formatIsoWithOffset } from '../../src/clock.js';

const NURSE = 'SN-7742';
const CLERK = 'RC-1029';

async function login(stack: TestStack, staffId: string, password?: string) {
  return request(stack.app)
    .post('/api/auth/login')
    .send({ staff_id: staffId, password: password ?? demoPassword(staffId) });
}

function refreshCookieValue(res: { headers: Record<string, unknown> }): string {
  const setCookies = res.headers['set-cookie'] as unknown as string[];
  const line = setCookies.find((line) => line.startsWith('gv_refresh='));
  if (line === undefined) {
    throw new Error('refresh cookie missing');
  }
  return (line.split(';')[0] as string).slice('gv_refresh='.length);
}

describe('authentication and session (PRD 6.6)', () => {
  it('AT-013: login with correct credentials issues tokens and writes a LOGIN entry', async () => {
    const stack = await createSeededStack();
    const res = await login(stack, NURSE);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.access_token).toBe('string');
    expect(res.body.data.user.staff_id).toBe(NURSE);
    const setCookies = res.headers['set-cookie'] as unknown as string[];
    const cookie = setCookies.find((line) => line.startsWith('gv_refresh='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const entries = stack.db
      .prepare("SELECT * FROM audit_logs WHERE action = 'LOGIN' AND staff_id = ?")
      .all(NURSE) as unknown[];
    expect(entries.length).toBe(1);
  });

  it('AT-014: role and ward in the login body are ignored; the token carries the record', async () => {
    const stack = await createSeededStack();
    const res = await request(stack.app)
      .post('/api/auth/login')
      .send({ staff_id: NURSE, password: demoPassword(NURSE), role: 'admin', ward: 'icu' });
    expect(res.status).toBe(200);
    const me = await request(stack.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.data.access_token as string}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.role).toBe('nurse');
    expect(me.body.data.user.ward).toBe('ward_a');
  });

  it('AT-015: wrong password is a generic 401 with a LOGIN_FAILED entry and no secret leakage', async () => {
    const stack = await createSeededStack();
    const password = 'definitely-not-the-password-123';
    const res = await login(stack, NURSE, password);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('definitely-not-the-password');
    const rows = stack.db
      .prepare("SELECT * FROM audit_logs WHERE action = 'LOGIN_FAILED' AND staff_id = ?")
      .all(NURSE) as Array<{ details: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.details).not.toContain('definitely-not-the-password');
  });

  it('AT-016: five failures lock the account for 15 minutes and raise RULE-ABUSE-08', async () => {
    const stack = await createSeededStack();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await login(stack, NURSE, `wrong-${i}`);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    const correct = await login(stack, NURSE);
    expect(correct.status).toBe(429);
    const user = usersRepository(stack.db).findByStaffId(NURSE);
    expect(user?.locked_until).not.toBeNull();
    const alerts = abuseAlertsRepository(stack.db).listByStatus('FLAGGED');
    expect(alerts.some((alert) => alert.rule_triggered === 'RULE-ABUSE-08')).toBe(true);
  });

  it('AT-017: an expired access token is 401 with code TOKEN_EXPIRED', async () => {
    const stack = await createSeededStack();
    const logged = await login(stack, NURSE);
    const decoded = jwt.decode(logged.body.data.access_token as string) as Record<string, string>;
    const expired = jwt.sign(
      {
        sub: decoded.sub,
        staff_id: decoded.staff_id,
        role: decoded.role,
        ward: decoded.ward,
        shift: decoded.shift,
        session_id: decoded.session_id,
        jti: 'expired-test-jti',
        policy_version: '2.0.0'
      },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '-10s' }
    );
    const res = await request(stack.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('AT-018: refresh rotation issues a new pair and kills the old refresh token', async () => {
    const stack = await createSeededStack();
    const logged = await login(stack, NURSE);
    const firstCookie = refreshCookieValue(logged);
    const rotated = await request(stack.app)
      .post('/api/auth/refresh')
      .set('Cookie', `gv_refresh=${firstCookie}`);
    expect(rotated.status).toBe(200);
    expect(typeof rotated.body.data.access_token).toBe('string');
    expect(refreshCookieValue(rotated)).not.toBe(firstCookie);
    const replay = await request(stack.app)
      .post('/api/auth/refresh')
      .set('Cookie', `gv_refresh=${firstCookie}`);
    expect(replay.status).toBe(401);
  });

  it('AT-019: replaying a rotated refresh token revokes the family and raises RULE-ABUSE-09', async () => {
    const stack = await createSeededStack();
    const logged = await login(stack, NURSE);
    const firstCookie = refreshCookieValue(logged);
    await request(stack.app).post('/api/auth/refresh').set('Cookie', `gv_refresh=${firstCookie}`);
    const replay = await request(stack.app)
      .post('/api/auth/refresh')
      .set('Cookie', `gv_refresh=${firstCookie}`);
    expect(replay.status).toBe(401);
    const sessions = sessionsRepository(stack.db);
    const live = sessions.listByFamily(
      (sessions.findByRefreshHash(
        (await import('../../src/auth/tokens.js')).hashRefreshToken(firstCookie)
      )?.family_id ?? 'missing') as string
    );
    expect(live.every((row) => row.revoked_at !== null)).toBe(true);
    const alerts = abuseAlertsRepository(stack.db).listByStatus('FLAGGED');
    const reuse = alerts.find((alert) => alert.rule_triggered === 'RULE-ABUSE-09');
    expect(reuse?.severity).toBe('CRITICAL');
  });

  it('AT-024: a valid scheduled extension keeps the subject on_duty outside shift hours', async () => {
    const stack = await createSeededStack();
    const logged = await login(stack, CLERK);
    expect(logged.status).toBe(200);
    const before = await request(stack.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${logged.body.data.access_token as string}`);
    expect(before.body.data.user.duty_state).toBe('off_duty');
    const user = usersRepository(stack.db).findByStaffId(CLERK);
    const nowMs = stack.clock.now().getTime();
    scheduledExtensionsRepository(stack.db).insert({
      id: uuidv7(),
      user_id: (user as { id: string }).id,
      starts_at: new Date(nowMs - 3600000).toISOString(),
      ends_at: new Date(nowMs + 3600000).toISOString(),
      approved_by: 'GV-9101',
      reason: 'overtime cover',
      created_at: formatIsoWithOffset(stack.clock.now(), TEST_TIME_ZONE)
    });
    const after = await request(stack.app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${logged.body.data.access_token as string}`);
    expect(after.status).toBe(200);
    expect(after.body.data.user.duty_state).toBe('on_duty');
  });

  it('AT-025: suspended and expired accounts are rejected even with a valid password', async () => {
    const stack = await createSeededStack();
    stack.db.prepare("UPDATE users SET account_status = 'suspended' WHERE staff_id = ?").run(NURSE);
    const suspended = await login(stack, NURSE);
    expect(suspended.status).toBe(401);
    expect(suspended.body.error.code).toBe('ACCOUNT_INACTIVE');
    stack.db
      .prepare("UPDATE users SET account_status = 'active', expires_at = '2020-01-01T00:00:00+01:00' WHERE staff_id = ?")
      .run(NURSE);
    const expired = await login(stack, NURSE);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('ACCOUNT_EXPIRED');
  });

  it('AT-911: readiness is 503 with a specific reason when migrations are pending or the key is unloaded', async () => {
    const bare = openTestDb();
    const pendingApp = createApp({
      db: bare,
      auth: { jwtSecret: TEST_JWT_SECRET, migrationsDir: 'backend/migrations' }
    });
    const pending = await request(pendingApp).get('/api/health/ready');
    expect(pending.status).toBe(503);
    expect(pending.body.error.details.reason).toBe('MIGRATIONS_PENDING');
    bare.close();

    const stack = createTestStack();
    const noKeyApp = createApp({
      db: stack.db,
      auth: { jwtSecret: TEST_JWT_SECRET, masterKeyLoaded: false, migrationsDir: 'backend/migrations' }
    });
    const noKey = await request(noKeyApp).get('/api/health/ready');
    expect(noKey.status).toBe(503);
    expect(noKey.body.error.details.reason).toBe('KEY_UNLOADED');
    stack.db.close();
  });

  it('AT-907: security headers are present on every response', async () => {
    const stack = await createSeededStack();
    const expected: Record<string, string> = {
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()'
    };
    const ok = await request(stack.app).get('/api/health/ping');
    for (const [header, value] of Object.entries(expected)) {
      expect(ok.headers[header], `ping ${header}`).toBe(value);
    }
    const missing = await request(stack.app).get('/api/no-such-route');
    expect(missing.status).toBe(404);
    for (const [header, value] of Object.entries(expected)) {
      expect(missing.headers[header], `404 ${header}`).toBe(value);
    }
    expect(ok.headers['content-security-policy']).not.toContain('unsafe-inline');
  });

  it('session lock and PIN unlock write ledger entries and restore access', async () => {
    const stack = await createSeededStack(AFTERNOON_CLOCK);
    const logged = await login(stack, CLERK);
    const token = logged.body.data.access_token as string;
    const locked = await request(stack.app)
      .post('/api/auth/lock')
      .set('Authorization', `Bearer ${token}`);
    expect(locked.status).toBe(204);
    const unlocked = await request(stack.app)
      .post('/api/auth/unlock')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: '221029' });
    expect(unlocked.status).toBe(200);
    expect(typeof unlocked.body.data.access_token).toBe('string');
    const count = (
      stack.db
        .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('SESSION_LOCK', 'SESSION_UNLOCK')")
        .get() as { n: number }
    ).n;
    expect(count).toBe(2);
    expect(auditLogsRepository(stack.db).count()).toBeGreaterThan(0);
  });
});
