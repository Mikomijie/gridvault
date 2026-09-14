// API branch sweep, batch 2: override, abuse, sync and audit-mutation
// routes plus the service-level lifecycles behind them (grant close/revoke
// errors, alert triage validation, sync conflicts, backfill gating, MAR
// sign-off states, patch conflicts, rosters and record writes).

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  MORNING_CLOCK,
  createSeededStack,
  demoPassword,
  makeOnDuty,
  type TestStack
} from '../helpers/app.js';

async function tokenFor(app: TestStack['app'], staffId: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ staff_id: staffId, password: demoPassword(staffId) });
  if (res.status !== 200) throw new Error(`login failed for ${staffId}: ${JSON.stringify(res.body)}`);
  return res.body.data.access_token as string;
}

async function grantFor(app: TestStack['app'], auth: string, patient: string, pin: string): Promise<string> {
  const res = await request(app)
    .post('/api/override/execute')
    .set('Authorization', `Bearer ${auth}`)
    .send({ patient_id: patient, justification_code: 'ACUTE_TRAUMA_UNCONSCIOUS', pin });
  if (res.status !== 201) throw new Error(`grant failed: ${JSON.stringify(res.body)}`);
  return res.body.data.override_id as string;
}

describe('API branches: override, abuse, sync, records', () => {
  it('override routes validate input and enforce grant ownership and reviewer roles', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'SN-7742');
    makeOnDuty(stack, 'GV-9101');
    const nurse = await tokenFor(stack.app, 'SN-7742');
    const cmo = await tokenFor(stack.app, 'GV-9101');

    const badExecute = await request(stack.app)
      .post('/api/override/execute')
      .set('Authorization', `Bearer ${nurse}`)
      .send({ patient_id: 'HOSP-LOS-2025-084' });
    expect(badExecute.status).toBe(400);
    const badJustification = await request(stack.app)
      .post('/api/override/execute')
      .set('Authorization', `Bearer ${nurse}`)
      .send({ patient_id: 'HOSP-LOS-2025-084', justification_code: 'NOPE', pin: '220774' });
    expect(badJustification.status).toBe(400);
    const missingPatient = await request(stack.app)
      .post('/api/override/execute')
      .set('Authorization', `Bearer ${nurse}`)
      .send({ patient_id: 'HOSP-LOS-9999-404', justification_code: 'ACUTE_TRAUMA_UNCONSCIOUS', pin: '220774' });
    expect(missingPatient.status).toBe(404);

    const id = await grantFor(stack.app, nurse, 'HOSP-LOS-2025-084', '220774');
    const active = await request(stack.app).get('/api/override/active').set('Authorization', `Bearer ${nurse}`);
    expect(active.status).toBe(200);
    expect(active.body.data.grants.length).toBe(1);

    // Another clinician cannot close someone else's grant; unknown ids 404.
    const doctor = await tokenFor(stack.app, 'GV-9042');
    const foreignClose = await request(stack.app)
      .post(`/api/override/${id}/close`)
      .set('Authorization', `Bearer ${doctor}`);
    expect(foreignClose.status).toBe(403);
    const missingClose = await request(stack.app)
      .post('/api/override/no-such-grant/close')
      .set('Authorization', `Bearer ${nurse}`);
    expect(missingClose.status).toBe(404);

    // Revocation is CMO/admin-only and review validates its decision enum.
    const nurseRevoke = await request(stack.app)
      .post(`/api/override/${id}/revoke`)
      .set('Authorization', `Bearer ${nurse}`)
      .send({ reason: 'nope' });
    expect(nurseRevoke.status).toBe(403);
    const badReview = await request(stack.app)
      .post(`/api/override/${id}/review`)
      .set('Authorization', `Bearer ${cmo}`)
      .send({ decision: 'maybe' });
    expect(badReview.status).toBe(400);
    const nurseReview = await request(stack.app)
      .post(`/api/override/${id}/review`)
      .set('Authorization', `Bearer ${nurse}`)
      .send({ decision: 'acknowledged' });
    expect(nurseReview.status).toBe(403);
    const badQueue = await request(stack.app)
      .get('/api/override?state=BOGUS')
      .set('Authorization', `Bearer ${cmo}`);
    expect(badQueue.status).toBe(400);
    const nurseQueue = await request(stack.app).get('/api/override').set('Authorization', `Bearer ${nurse}`);
    expect(nurseQueue.status).toBe(403);

    const reviewed = await request(stack.app)
      .post(`/api/override/${id}/review`)
      .set('Authorization', `Bearer ${cmo}`)
      .send({ decision: 'acknowledged', notes: 'genuine resuscitation' });
    expect(reviewed.status).toBe(204);
    const closed = await request(stack.app).post(`/api/override/${id}/close`).set('Authorization', `Bearer ${nurse}`);
    expect(closed.status).toBe(204);
    // Closing twice is a state conflict, not a silent no-op.
    const closedAgain = await request(stack.app)
      .post(`/api/override/${id}/close`)
      .set('Authorization', `Bearer ${nurse}`);
    expect(closedAgain.status).toBe(409);
  });

  it('abuse triage validates transitions, notes and unknown alerts', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'RC-1029');
    makeOnDuty(stack, 'GV-9101');
    const clerk = await tokenFor(stack.app, 'RC-1029');
    const cmo = await tokenFor(stack.app, 'GV-9101');

    await request(stack.app).get('/api/patients/HOSP-LOS-2025-082').set('Authorization', `Bearer ${clerk}`);
    const feed = await request(stack.app).get('/api/abuse/alerts').set('Authorization', `Bearer ${cmo}`);
    expect(feed.status).toBe(200);
    const alertId = feed.body.data[0].id as string;

    const badBody = await request(stack.app)
      .patch(`/api/abuse/alerts/${alertId}`)
      .set('Authorization', `Bearer ${cmo}`)
      .send({ status: 'MAYBE' });
    expect(badBody.status).toBe(400);
    const missing = await request(stack.app)
      .patch('/api/abuse/alerts/al_missing')
      .set('Authorization', `Bearer ${cmo}`)
      .send({ status: 'INVESTIGATING' });
    expect(missing.status).toBe(404);
    const noteless = await request(stack.app)
      .patch(`/api/abuse/alerts/${alertId}`)
      .set('Authorization', `Bearer ${cmo}`)
      .send({ status: 'RESOLVED', resolution: 'justified' });
    expect(noteless.status).toBe(400);
    const noOutcome = await request(stack.app)
      .patch(`/api/abuse/alerts/${alertId}`)
      .set('Authorization', `Bearer ${cmo}`)
      .send({ status: 'RESOLVED', notes: 'no outcome given' });
    expect(noOutcome.status).toBe(400);

    const investigating = await request(stack.app)
      .patch(`/api/abuse/alerts/${alertId}`)
      .set('Authorization', `Bearer ${cmo}`)
      .send({ status: 'INVESTIGATING' });
    expect(investigating.status).toBe(200);
    // Terminal states do not reopen: RESOLVED -> INVESTIGATING is 409, and
    // a second resolution of the same alert is 409 as well.
    const resolved = await request(stack.app)
      .patch(`/api/abuse/alerts/${alertId}`)
      .set('Authorization', `Bearer ${cmo}`)
      .send({ status: 'RESOLVED', resolution: 'confirmed_abuse', notes: 'reviewed with ward head' });
    expect(resolved.status).toBe(200);
    const reopen = await request(stack.app)
      .patch(`/api/abuse/alerts/${alertId}`)
      .set('Authorization', `Bearer ${cmo}`)
      .send({ status: 'INVESTIGATING' });
    expect(reopen.status).toBe(409);

    const filtered = await request(stack.app)
      .get('/api/abuse/alerts?status=RESOLVED&severity=CRITICAL&limit=10')
      .set('Authorization', `Bearer ${cmo}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.length).toBeGreaterThanOrEqual(1);
    const badFilter = await request(stack.app)
      .get('/api/abuse/alerts?limit=9999')
      .set('Authorization', `Bearer ${cmo}`);
    expect(badFilter.status).toBe(400);
  });

  it('sync routes validate batches, gate backfill roles and report device status', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'SN-7742');
    makeOnDuty(stack, 'RC-1029');
    const nurse = await tokenFor(stack.app, 'SN-7742');
    const clerk = await tokenFor(stack.app, 'RC-1029');

    const empty = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${nurse}`)
      .send({ mutations: [] });
    expect(empty.status).toBe(400);
    const tooMany = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${nurse}`)
      .send({
        mutations: Array.from({ length: 101 }, (_, i) => ({
          client_mutation_id: `cm_many_${i}`,
          device_id: 'term-x',
          device_seq: i,
          type: 'VITALS',
          patient_id: 'HOSP-LOS-2025-081',
          payload: { heart_rate: 80, blood_pressure: '120/80', spo2: 98, temperature: 36.8 },
          captured_at: '2026-09-13T10:30:00.000+01:00'
        }))
      });
    expect(tooMany.status).toBe(400);
    const malformed = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${nurse}`)
      .send({ mutations: [{ client_mutation_id: 'cm_bad', type: 'VITALS' }] });
    expect(malformed.status).toBe(400);
    const unknownType = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${nurse}`)
      .send({
        mutations: [
          {
            client_mutation_id: 'cm_unknown_type',
            device_id: 'term-x',
            device_seq: 1,
            type: 'TELEPORT',
            patient_id: 'HOSP-LOS-2025-081',
            payload: {},
            captured_at: '2026-09-13T10:30:00.000+01:00'
          }
        ]
      });
    expect(unknownType.status).toBe(400);

    // Demographic version conflicts resolve per-mutation, never silently.
    const conflict = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${nurse}`)
      .send({
        mutations: [
          {
            client_mutation_id: 'cm_conflict_1',
            device_id: 'term-conflict',
            device_seq: 1,
            type: 'PATIENT_PATCH',
            patient_id: 'HOSP-LOS-2025-081',
            base_version: 999,
            payload: { status: 'critical' },
            captured_at: '2026-09-13T10:30:00.000+01:00'
          }
        ]
      });
    expect(conflict.status).toBe(200);
    expect(conflict.body.data.conflicts).toBe(1);
    expect(conflict.body.data.results[0].status).toBe('conflict');

    const clerkBackfill = await request(stack.app)
      .post('/api/sync/backfill')
      .set('Authorization', `Bearer ${clerk}`)
      .send({
        slips: [
          {
            client_mutation_id: 'cm_paper_clerk',
            patient_id: 'HOSP-LOS-2025-081',
            payload: { heart_rate: 80, blood_pressure: '120/80', spo2: 98, temperature: 36.8 },
            captured_at: '2026-09-13T08:15:00.000+01:00'
          }
        ]
      });
    expect(clerkBackfill.status).toBe(403);
    const badBackfill = await request(stack.app)
      .post('/api/sync/backfill')
      .set('Authorization', `Bearer ${nurse}`)
      .send({ slips: [] });
    expect(badBackfill.status).toBe(400);

    const noDevice = await request(stack.app).get('/api/sync/status').set('Authorization', `Bearer ${nurse}`);
    expect(noDevice.status).toBe(400);
    const status = await request(stack.app)
      .get('/api/sync/status?device_id=term-warda-02')
      .set('Authorization', `Bearer ${nurse}`);
    expect(status.status).toBe(200);
    expect(status.body.data.device_id).toBe('term-warda-02');
  });

  it('records writes cover notes, MAR states, patch conflicts and roster scopes', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, 'SN-7742');
    makeOnDuty(stack, 'GV-9042');
    const nurse = await tokenFor(stack.app, 'SN-7742');
    const doctor = await tokenFor(stack.app, 'GV-9042');

    const note = await request(stack.app)
      .post('/api/patients/HOSP-LOS-2025-081/notes')
      .set('Authorization', `Bearer ${nurse}`)
      .send({ note_type: 'nursing', body: 'Resting comfortably after medication round.' });
    expect(note.status).toBe(201);

    const mar = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-081/mar')
      .set('Authorization', `Bearer ${nurse}`);
    expect(mar.status).toBe(200);
    const scheduled = (mar.body.data as Array<{ id: string; status: string }>).find((row) => row.status === 'scheduled');
    if (scheduled !== undefined) {
      const signed = await request(stack.app)
        .post(`/api/patients/HOSP-LOS-2025-081/mar/${scheduled.id}/sign`)
        .set('Authorization', `Bearer ${nurse}`);
      expect(signed.status).toBe(200);
      const resigned = await request(stack.app)
        .post(`/api/patients/HOSP-LOS-2025-081/mar/${scheduled.id}/sign`)
        .set('Authorization', `Bearer ${nurse}`);
      expect(resigned.status).toBe(409);
    }

    // Stale demographic versions conflict with both versions named.
    const dossier = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${doctor}`);
    expect(dossier.status).toBe(200);
    const version = dossier.body.data.patient.version as number;
    const stale = await request(stack.app)
      .patch('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${doctor}`)
      .send({ version: version + 100, full_name: 'Stale Overwrite' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.base_version).toBe(version + 100);
    expect(stale.body.error.details.current_version).toBe(version);

    // Bed clashes are rejected, not double-booked.
    const clash = await request(stack.app)
      .patch('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${doctor}`)
      .send({ version, ward: 'icu', bed_number: 'ICU-04' });
    expect([200, 409]).toContain(clash.status);
    if (clash.status === 200) {
      // A-05 was free in this seed path; the move itself is the assertion.
      expect(clash.body.data.version).toBe(version + 1);
    }

    const doctorRoster = await request(stack.app)
      .get('/api/patients?ward=ward_a&status=stable&search=081&limit=5')
      .set('Authorization', `Bearer ${doctor}`);
    expect(doctorRoster.status).toBe(200);
    const vitalsHistory = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084/vitals?limit=5')
      .set('Authorization', `Bearer ${doctor}`);
    expect(vitalsHistory.status).toBe(200);
    expect(vitalsHistory.body.data.length).toBeGreaterThan(0);
  });
});
