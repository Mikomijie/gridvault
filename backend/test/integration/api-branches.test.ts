// API branch sweep, batch 1: authentication middleware, auth routes,
// patients routes, handover/admissions routes, health routes and audit
// routes. Each test pins a validation, privilege or error branch that the
// AT-titled suites pass through without asserting.

import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/http/app.js';
import { TEST_JWT_SECRET, TEST_TIME_ZONE } from '../helpers/app.js';
import {
  AFTERNOON_CLOCK,
  MORNING_CLOCK,
  createSeededStack,
  createTestStack,
  demoPassword,
  makeOnDuty,
  type TestStack
} from '../helpers/app.js';
import { TEST_MASTER_KEY } from '../helpers/db.js';

async function tokenFor(app: TestStack['app'], staffId: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ staff_id: staffId, password: demoPassword(staffId) });
  if (res.status !== 200) throw new Error(`login failed for ${staffId}: ${JSON.stringify(res.body)}`);
  return res.body.data.access_token as string;
}

describe('API branches: middleware, auth, patients, handover, health, audit', () => {
  it('middleware rejects unknown users, staff mismatches, expired accounts and revoked sessions', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'SN-7742');
    const auth = await tokenFor(stack.app, 'SN-7742');

    const ghost = jwt.sign(
      {
        sub: 'ghost-id',
        staff_id: 'SN-7742',
        role: 'nurse',
        ward: 'ward_a',
        shift: 'morning',
        session_id: 'ghost-session',
        jti: 'ghost-jti',
        policy_version: '2.0.0'
      },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
    const ghostRes = await request(stack.app).get('/api/auth/me').set('Authorization', `Bearer ${ghost}`);
    expect(ghostRes.status).toBe(401);
    expect(ghostRes.body.error.code).toBe('TOKEN_INVALID');

    const decoded = jwt.decode(auth) as Record<string, string>;
    const mismatched = jwt.sign(
      {
        sub: decoded.sub,
        staff_id: 'RC-1029',
        role: 'nurse',
        ward: 'ward_a',
        shift: 'morning',
        session_id: decoded.session_id,
        jti: 'mismatch-jti',
        policy_version: '2.0.0'
      },
      TEST_JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
    const mismatchRes = await request(stack.app).get('/api/auth/me').set('Authorization', `Bearer ${mismatched}`);
    expect(mismatchRes.status).toBe(401);

    stack.db.prepare("UPDATE users SET expires_at = '2020-01-01T00:00:00+01:00' WHERE staff_id = ?").run('SN-7742');
    const expiredRes = await request(stack.app).get('/api/auth/me').set('Authorization', `Bearer ${auth}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.code).toBe('ACCOUNT_EXPIRED');
    stack.db.prepare('UPDATE users SET expires_at = NULL WHERE staff_id = ?').run('SN-7742');

    await request(stack.app).post('/api/auth/logout').set('Authorization', `Bearer ${auth}`);
    const revokedRes = await request(stack.app).get('/api/auth/me').set('Authorization', `Bearer ${auth}`);
    expect(revokedRes.status).toBe(401);
  });

  it('auth routes validate bodies, cookies, PINs and personas gating', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const badLogin = await request(stack.app).post('/api/auth/login').send({ staff_id: '' });
    expect(badLogin.status).toBe(400);
    const noCookie = await request(stack.app).post('/api/auth/refresh');
    expect(noCookie.status).toBe(401);
    const badCookie = await request(stack.app).post('/api/auth/refresh').set('Cookie', 'gv_refresh=nope');
    expect(badCookie.status).toBe(401);

    const auth = await tokenFor(stack.app, 'SN-7742');
    const badUnlock = await request(stack.app)
      .post('/api/auth/unlock')
      .set('Authorization', `Bearer ${auth}`)
      .send({});
    expect(badUnlock.status).toBe(400);
    const wrongPin = await request(stack.app)
      .post('/api/auth/unlock')
      .set('Authorization', `Bearer ${auth}`)
      .send({ pin: '0000' });
    expect(wrongPin.status).toBe(401);

    const personas = await request(stack.app).get('/api/auth/personas');
    expect(personas.status).toBe(200);
    expect(personas.body.data.personas.length).toBeGreaterThanOrEqual(5);

    // A node with demo mode off hides personas with 404.
    const plain = createApp({
      db: stack.db,
      clock: MORNING_CLOCK,
      timeZone: TEST_TIME_ZONE,
      auth: { jwtSecret: TEST_JWT_SECRET, demoMode: false, masterKey: TEST_MASTER_KEY, masterKeyLoaded: true }
    });
    const hidden = await request(plain).get('/api/auth/personas');
    expect(hidden.status).toBe(404);
    const probeDenied = await request(plain)
      .post('/api/abuse/demo/clerk-probe')
      .set('Authorization', `Bearer ${auth}`);
    expect(probeDenied.status).toBe(404);
  });

  it('patients routes validate input, report 404s and honour terminal/ip metadata', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'SN-7742');
    const auth = await tokenFor(stack.app, 'SN-7742');

    const badRoster = await request(stack.app)
      .get('/api/patients?limit=9999')
      .set('Authorization', `Bearer ${auth}`);
    expect(badRoster.status).toBe(400);
    const badStatus = await request(stack.app)
      .get('/api/patients?status=critical-ish')
      .set('Authorization', `Bearer ${auth}`);
    expect(badStatus.status).toBe(400);

    const missing = await request(stack.app)
      .get('/api/patients/HOSP-LOS-9999-404')
      .set('Authorization', `Bearer ${auth}`);
    expect(missing.status).toBe(404);

    const missingVitals = await request(stack.app)
      .get('/api/patients/HOSP-LOS-9999-404/vitals')
      .set('Authorization', `Bearer ${auth}`);
    expect(missingVitals.status).toBe(404);

    const badVitalsBody = await request(stack.app)
      .post('/api/patients/HOSP-LOS-2025-081/vitals')
      .set('Authorization', `Bearer ${auth}`)
      .send({ heart_rate: 'fast' });
    expect(badVitalsBody.status).toBe(400);

    const outOfRange = await request(stack.app)
      .post('/api/patients/HOSP-LOS-2025-081/vitals?terminal_id=term-warda-02')
      .set('Authorization', `Bearer ${auth}`)
      .send({ heart_rate: 999, blood_pressure: '120/80', spo2: 98, temperature: 36.8 });
    expect(outOfRange.status).toBe(422);

    const withTerminal = await request(stack.app)
      .post('/api/patients/HOSP-LOS-2025-081/vitals')
      .set('Authorization', `Bearer ${auth}`)
      .send({ heart_rate: 80, blood_pressure: '120/80', spo2: 98, temperature: 36.8, terminal_id: 'term-warda-02' });
    expect(withTerminal.status).toBe(201);

    const badNote = await request(stack.app)
      .post('/api/patients/HOSP-LOS-2025-081/notes')
      .set('Authorization', `Bearer ${auth}`)
      .send({ note_type: 'gossip', body: 'x' });
    expect(badNote.status).toBe(400);
    const missingNote = await request(stack.app)
      .post('/api/patients/HOSP-LOS-9999-404/notes')
      .set('Authorization', `Bearer ${auth}`)
      .send({ note_type: 'nursing', body: 'ok' });
    expect(missingNote.status).toBe(404);

    const missingMar = await request(stack.app)
      .get('/api/patients/HOSP-LOS-9999-404/mar')
      .set('Authorization', `Bearer ${auth}`);
    expect(missingMar.status).toBe(404);
    const badSign = await request(stack.app)
      .post('/api/patients/HOSP-LOS-2025-081/mar/no-such-entry/sign')
      .set('Authorization', `Bearer ${auth}`);
    expect(badSign.status).toBe(404);

    const badPatch = await request(stack.app)
      .patch('/api/patients/HOSP-LOS-2025-081')
      .set('Authorization', `Bearer ${auth}`)
      .send({ full_name: 'No Version' });
    expect(badPatch.status).toBe(400);
    const missingPatch = await request(stack.app)
      .patch('/api/patients/HOSP-LOS-9999-404')
      .set('Authorization', `Bearer ${auth}`)
      .send({ version: 1 });
    expect(missingPatch.status).toBe(404);
  });

  it('handover and admissions queue enforce clinical roles and wards', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'SN-7742');
    makeOnDuty(stack, 'RC-1029');
    const nurse = await tokenFor(stack.app, 'SN-7742');
    const clerk = await tokenFor(stack.app, 'RC-1029');

    const badQuery = await request(stack.app)
      .get('/api/handover?ward=')
      .set('Authorization', `Bearer ${nurse}`);
    expect(badQuery.status).toBe(400);
    const clerkHandover = await request(stack.app)
      .get('/api/handover?ward=ward_a')
      .set('Authorization', `Bearer ${clerk}`);
    expect(clerkHandover.status).toBe(403);
    const offWard = await request(stack.app)
      .get('/api/handover?ward=icu')
      .set('Authorization', `Bearer ${nurse}`);
    expect(offWard.status).toBe(403);
    const ok = await request(stack.app)
      .get('/api/handover?ward=ward_a')
      .set('Authorization', `Bearer ${nurse}`);
    expect(ok.status).toBe(200);
    expect(typeof ok.body.data.watermark).toBe('string');

    const queue = await request(stack.app).get('/api/admissions/queue').set('Authorization', `Bearer ${clerk}`);
    expect(queue.status).toBe(200);
    const nurseQueue = await request(stack.app)
      .get('/api/admissions/queue')
      .set('Authorization', `Bearer ${nurse}`);
    expect(nurseQueue.status).toBe(403);
  });

  it('health and audit routes report readiness, metrics, anchors and format errors', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'AD-0012');
    const admin = await tokenFor(stack.app, 'AD-0012');

    const ping = await request(stack.app).get('/api/health/ping');
    expect(ping.status).toBe(200);
    const ready = await request(stack.app).get('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data.ready).toBe(true);
    const metrics = await request(stack.app).get('/api/health/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.text).toContain('gridvault_up 1');

    const badLogs = await request(stack.app)
      .get('/api/audit/logs?limit=9999')
      .set('Authorization', `Bearer ${admin}`);
    expect(badLogs.status).toBe(400);
    const filtered = await request(stack.app)
      .get('/api/audit/logs?action=LOGIN&limit=5')
      .set('Authorization', `Bearer ${admin}`);
    expect(filtered.status).toBe(200);
    const anchors = await request(stack.app).get('/api/audit/anchors');
    expect(anchors.status).toBe(200);
    const badExport = await request(stack.app).get('/api/audit/export?format=csv');
    expect(badExport.status).toBe(400);
    const exported = await request(stack.app).get('/api/audit/export?format=jsonl');
    expect(exported.status).toBe(200);

    // Sessions do not cross databases: a token minted on the seeded stack
    // is rejected on a bare stack with no matching session row.
    const bare = createTestStack(AFTERNOON_CLOCK);
    const foreign = await request(bare.app).get('/api/audit/logs').set('Authorization', `Bearer ${admin}`);
    expect(foreign.status).toBe(401);
  });

  it('CORS echoes only configured origins with credentials, and answers preflight', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const corsApp = createApp({
      db: stack.db,
      clock: MORNING_CLOCK,
      timeZone: TEST_TIME_ZONE,
      auth: {
        jwtSecret: TEST_JWT_SECRET,
        demoMode: true,
        masterKey: TEST_MASTER_KEY,
        masterKeyLoaded: true,
        corsAllowedOrigins: ['http://localhost:5173']
      }
    });

    const allowed = await request(corsApp).get('/api/health/ping').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(corsApp).get('/api/health/ping').set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await request(corsApp)
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');

    // Foreign origins fall through to Express's default OPTIONS reply:
    // 200 with an Allow list but no CORS headers, so the browser still
    // blocks the call. Deny is the absence of ACAO, not the status.
    const foreignPreflight = await request(corsApp)
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example');
    expect(foreignPreflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(foreignPreflight.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
