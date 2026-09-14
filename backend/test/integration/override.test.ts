import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MutableClock } from '../../src/clock.js';
import { verifyLedger } from '../../src/ledger/verify.js';
import { dispatchPending } from '../../src/notify/outbox.js';
import { demoSensitivePlaintexts } from '../../src/db/seed.js';
import { abuseAlertsRepository } from '../../src/db/repositories/security.js';
import {
  MORNING_CLOCK,
  createSeededStack,
  demoPassword,
  type TestStack
} from '../helpers/app.js';

const NURSE = 'SN-7742';
const NURSE_PIN = '220774';
const CMO = 'GV-9101';

async function token(stack: TestStack, staffId: string): Promise<string> {
  const res = await request(stack.app)
    .post('/api/auth/login')
    .send({ staff_id: staffId, password: demoPassword(staffId) });
  if (res.status !== 200) {
    throw new Error(`login failed for ${staffId}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data.access_token as string;
}

async function execute(
  stack: TestStack,
  auth: string,
  body: Record<string, unknown> = {}
): Promise<request.Response> {
  return request(stack.app)
    .post('/api/override/execute')
    .set('Authorization', `Bearer ${auth}`)
    .send({
      patient_id: 'HOSP-LOS-2025-084',
      justification_code: 'ACUTE_TRAUMA_UNCONSCIOUS',
      pin: NURSE_PIN,
      ...body
    });
}

describe('emergency clinical override (PRD 7)', () => {
  it('AT-201: override with a valid reason and PIN issues a scoped grant', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const res = await execute(stack, auth);
    expect(res.status).toBe(201);
    expect(typeof res.body.data.override_id).toBe('string');
    expect(typeof res.body.data.audit_index).toBe('number');
    expect(typeof res.body.data.expires_at).toBe('string');
    expect(res.body.data.scope.writable).toEqual(['VITALS', 'CLINICAL']);
    expect(res.body.data.dispatch.cmo).toBeTruthy();
    expect(res.body.data.dispatch.charge_nurse).toBeTruthy();
  });

  it('AT-202: wrong PIN is 401 with a denial entry and throttles after 3 failures', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const first = await execute(stack, auth, { pin: '000000' });
    expect(first.status).toBe(401);
    const grants = stack.db
      .prepare('SELECT COUNT(*) AS n FROM emergency_overrides')
      .get() as { n: number };
    expect(grants.n).toBe(0);
    const denials = stack.db
      .prepare(
        "SELECT details FROM audit_logs WHERE action = 'EMERGENCY_OVERRIDE_REQUESTED' AND staff_id = ?"
      )
      .all(NURSE) as Array<{ details: string }>;
    expect(denials.length).toBe(1);
    expect(JSON.parse(denials[0]?.details as string)).toMatchObject({ granted: false });
    expect(await execute(stack, auth, { pin: '000000' })).toHaveProperty('status', 401);
    expect(await execute(stack, auth, { pin: '000000' })).toHaveProperty('status', 401);
    const throttled = await execute(stack, auth, { pin: '000000' });
    expect(throttled.status).toBe(429);
  });

  it('AT-203: OTHER with short notes is 400', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const res = await execute(stack, auth, { justification_code: 'OTHER', justification_notes: 'short' });
    expect(res.status).toBe(400);
  });

  it('AT-205: the granted chart is clinical RW with sensitive read-only', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    await execute(stack, auth);
    const read = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${auth}`);
    expect(read.status).toBe(200);
    expect(read.body.data.clinical.primary_diagnosis).toContain('Polytrauma');
    expect(read.body.data.sensitive.hiv_status).toBe('Reactive (Confirmed)');
    const dossier = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${auth}`);
    const version = dossier.body.data.patient.version as number;
    const sensitiveWrite = await request(stack.app)
      .patch('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${auth}`)
      .send({ version, hiv_status: 'Non-reactive' });
    expect(sensitiveWrite.status).toBe(403);
  });

  it('AT-206: the grant is chained, verifiable and free of PHI in details', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    await execute(stack, auth);
    const granted = stack.db
      .prepare("SELECT * FROM audit_logs WHERE action = 'EMERGENCY_OVERRIDE_GRANTED'")
      .get() as { details: string; log_index: number };
    expect(granted).toBeDefined();
    expect(JSON.parse(granted.details)).toMatchObject({ justification_code: 'ACUTE_TRAUMA_UNCONSCIOUS' });
    for (const secret of demoSensitivePlaintexts()) {
      expect(granted.details).not.toContain(secret);
    }
    expect(granted.details).not.toContain('Babatunde');
    const report = verifyLedger(stack.db);
    expect(report.status).toBe('HEALTHY');
  });

  it('AT-207: the outbox carries CMO and charge-nurse dispatches from the same transaction', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const executed = await execute(stack, auth);
    const rows = stack.db
      .prepare('SELECT * FROM notification_outbox WHERE related_id = ? ORDER BY recipient ASC')
      .all(executed.body.data.override_id as string) as Array<{
      recipient: string;
      priority: string;
      status: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.priority)).toEqual(['HIGH', 'HIGH']);
    expect(rows.map((row) => row.status)).toEqual(['PENDING', 'PENDING']);
    expect(rows[0]?.recipient).toContain('GV-9101');
    expect(rows[1]?.recipient).toContain('charge_nurse');
  });

  it('AT-208: a throwing notifier never blocks the grant and never loses the outbox row', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const executed = await execute(stack, auth);
    expect(executed.status).toBe(201);
    const result = await dispatchPending(stack.db, {
      name: 'failing-test-driver',
      dispatch: () => Promise.reject(new Error('CMO phone unreachable'))
    });
    expect(result).toMatchObject({ attempted: 2, dispatched: 0, failed: 2 });
    const rows = stack.db
      .prepare('SELECT status, attempts FROM notification_outbox WHERE related_id = ?')
      .all(executed.body.data.override_id as string) as Array<{ status: string; attempts: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'PENDING' && row.attempts === 1)).toBe(true);
  });

  it('AT-209: a grant is scoped to one patient', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    await execute(stack, auth);
    const other = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-090')
      .set('Authorization', `Bearer ${auth}`);
    expect(other.status).toBe(403);
  });

  it('AT-210: past expiry the grant answers 410 GRANT_EXPIRED with EXPIRED state', async () => {
    const clock = new MutableClock('2026-09-13T10:00:00Z');
    const stack = await createSeededStack(clock);
    const auth = await token(stack, NURSE);
    await execute(stack, auth);
    clock.advanceMs(61 * 60000);
    const read = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${auth}`);
    expect(read.status).toBe(410);
    expect(read.body.error.reason_code).toBe('GRANT_EXPIRED');
    const row = stack.db
      .prepare("SELECT state FROM emergency_overrides WHERE staff_id = 'SN-7742'")
      .get() as { state: string };
    expect(row.state).toBe('EXPIRED');
  });

  it('AT-211: CMO revocation takes effect on the very next request', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const nurseAuth = await token(stack, NURSE);
    const executed = await execute(stack, nurseAuth);
    const cmoAuth = await token(stack, CMO);
    const revoked = await request(stack.app)
      .post(`/api/override/${executed.body.data.override_id as string}/revoke`)
      .set('Authorization', `Bearer ${cmoAuth}`)
      .send({ reason: 'situation resolved' });
    expect(revoked.status).toBe(204);
    const read = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${nurseAuth}`);
    expect(read.status).toBe(403);
    const entry = stack.db
      .prepare("SELECT * FROM audit_logs WHERE action = 'EMERGENCY_OVERRIDE_REVOKED'")
      .get() as { log_index: number } | undefined;
    expect(entry).toBeDefined();
  });

  it('AT-212: two overrides in 60 minutes both succeed and raise RULE-ABUSE-04 CRITICAL', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const first = await execute(stack, auth);
    expect(first.status).toBe(201);
    const second = await execute(stack, auth, { patient_id: 'HOSP-LOS-2025-090' });
    expect(second.status).toBe(201);
    const alerts = abuseAlertsRepository(stack.db).listByStatus('FLAGGED');
    const spike = alerts.find((alert) => alert.rule_triggered === 'RULE-ABUSE-04');
    expect(spike?.severity).toBe('CRITICAL');
    const outbox = stack.db
      .prepare("SELECT body FROM notification_outbox WHERE related_id = ? AND recipient LIKE 'GV-%'")
      .get(second.body.data.override_id as string) as { body: string };
    expect(outbox.body).toContain('FREQUENCY SPIKE');
  });

  it('clinician close ends access; CMO review acknowledges the grant', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const nurseAuth = await token(stack, NURSE);
    const executed = await execute(stack, nurseAuth);
    const overrideId = executed.body.data.override_id as string;
    const cmoAuth = await token(stack, CMO);
    const queue = await request(stack.app)
      .get('/api/override?state=ACTIVE')
      .set('Authorization', `Bearer ${cmoAuth}`);
    expect(queue.status).toBe(200);
    expect((queue.body.data.overrides as Array<{ id: string }>).some((row) => row.id === overrideId)).toBe(true);
    const reviewed = await request(stack.app)
      .post(`/api/override/${overrideId}/review`)
      .set('Authorization', `Bearer ${cmoAuth}`)
      .send({ decision: 'acknowledged', notes: 'genuine resuscitation' });
    expect(reviewed.status).toBe(204);
    const closed = await request(stack.app)
      .post(`/api/override/${overrideId}/close`)
      .set('Authorization', `Bearer ${nurseAuth}`);
    expect(closed.status).toBe(204);
    const read = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${nurseAuth}`);
    expect(read.status).toBe(403);
    const reviewed2 = stack.db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'OVERRIDE_REVIEWED'")
      .get() as { n: number };
    expect(reviewed2.n).toBe(1);
  });
});
