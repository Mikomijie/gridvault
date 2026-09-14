import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import { abuseAlertsRepository } from '../../src/db/repositories/security.js';
import { demoSensitivePlaintexts } from '../../src/db/seed.js';
import {
  AFTERNOON_CLOCK,
  MORNING_CLOCK,
  createSeededStack,
  demoPassword,
  type TestStack
} from '../helpers/app.js';

const DOCTOR = 'GV-9042';
const NURSE = 'SN-7742';
const CLERK = 'RC-1029';
const ADMIN = 'AD-0012';

const GRACE_CLOCK = fixedClock('2026-09-13T13:15:00Z'); // 14:15 WAT: morning handover grace

async function token(stack: TestStack, staffId: string): Promise<string> {
  const res = await request(stack.app)
    .post('/api/auth/login')
    .send({ staff_id: staffId, password: demoPassword(staffId) });
  if (res.status !== 200) {
    throw new Error(`login failed for ${staffId}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.access_token as string;
}

function bodiesDoNotContain(bodies: unknown[], secrets: string[], where: string): void {
  const text = bodies.map((body) => JSON.stringify(body)).join('\n');
  for (const secret of secrets) {
    expect(text, `${where} leaks ${JSON.stringify(secret.slice(0, 24))}…`).not.toContain(secret);
  }
}

describe('policy and redaction (PRD 6)', () => {
  it('AT-101: ICU doctor reads the ICU trauma patient with full groups and audit entries', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, DOCTOR);
    const res = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sensitive.hiv_status).toBe('Reactive (Confirmed)');
    expect(res.body.data.sensitive.genotype).toBe('Hb SS');
    expect(res.body.data.clinical.primary_diagnosis).toContain('Polytrauma');
    const actions = stack.db
      .prepare('SELECT action FROM audit_logs WHERE staff_id = ? ORDER BY log_index ASC')
      .all(DOCTOR) as Array<{ action: string }>;
    expect(actions.map((row) => row.action)).toContain('VIEW_RECORD');
    expect(actions.map((row) => row.action)).toContain('VIEW_SENSITIVE');
  });

  it('AT-102: treating nurse reads sensitive read-only; a sensitive write is 403 ROLE_CANNOT_WRITE', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const read = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-082')
      .set('Authorization', `Bearer ${auth}`);
    expect(read.status).toBe(200);
    expect(read.body.data.sensitive.genotype).toBe('Hb AS');
    const version = read.body.data.patient.version as number;
    const write = await request(stack.app)
      .patch('/api/patients/HOSP-LOS-2025-082')
      .set('Authorization', `Bearer ${auth}`)
      .send({ version, hiv_status: 'Non-reactive' });
    expect(write.status).toBe(403);
    expect(write.body.error.reason_code).toBe('ROLE_CANNOT_WRITE');
  });

  it('AT-103: clerk in-queue read redacts clinical content with the server reason', async () => {
    const stack = await createSeededStack(AFTERNOON_CLOCK);
    const auth = await token(stack, CLERK);
    const res = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-081')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    expect(res.body.data.patient.full_name).toBe('Chinedu Nnamdi');
    expect(res.body.data.logistics).not.toBeNull();
    expect(res.body.data.clinical).toBeNull();
    expect(res.body.data.sensitive).toBeNull();
    const reasons = (res.body._meta.redactions as Array<{ reason_code: string }>).map(
      (entry) => entry.reason_code
    );
    expect(reasons).toContain('CLERK_NO_CLINICAL');
  });

  it('AT-104: clerk out-of-queue read is 403 CLERK_OUT_OF_QUEUE with a CRITICAL alert', async () => {
    const stack = await createSeededStack(AFTERNOON_CLOCK);
    const auth = await token(stack, CLERK);
    const res = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-082')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(403);
    expect(res.body.error.reason_code).toBe('CLERK_OUT_OF_QUEUE');
    const alerts = abuseAlertsRepository(stack.db).listByStatus('FLAGGED');
    const probe = alerts.find((alert) => alert.rule_triggered === 'RULE-ABUSE-01');
    expect(probe?.severity).toBe('CRITICAL');
    const denial = stack.db
      .prepare("SELECT details FROM audit_logs WHERE action = 'ACCESS_DENIED' AND staff_id = ?")
      .get(CLERK) as { details: string };
    const denialDetails = JSON.parse(denial.details) as { decision_id: string };
    expect(probe?.decision_id).toBe(denialDetails.decision_id);
  });

  it('AT-105: ward_a nurse reading the ICU patient is denied with a break-glass affordance', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const res = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(403);
    expect(res.body.error.reason_code).toBe('WARD_MISMATCH');
    expect(res.body.error.can_break_glass).toBe(true);
    bodiesDoNotContain([res.body], ['Polytrauma', 'Reactive (Confirmed)', 'Hb SS'], 'AT-105 body');
    const alerts = abuseAlertsRepository(stack.db).listByStatus('FLAGGED');
    expect(alerts.some((alert) => alert.rule_triggered === 'RULE-ABUSE-02')).toBe(true);
  });

  it('AT-106: admin reads are limited and an explicit sensitive request raises RULE-ABUSE-05', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, ADMIN);
    const res = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-082')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    expect(res.body.data.patient.hospital_number).toBe('HOSP-LOS-2025-082');
    expect(res.body.data.patient.full_name).toBe('[RESTRICTED]');
    expect(res.body.data.clinical).toBeNull();
    expect(res.body.data.sensitive).toBeNull();
    const alerts = abuseAlertsRepository(stack.db).listByStatus('FLAGGED');
    expect(alerts.some((alert) => alert.rule_triggered === 'RULE-ABUSE-05')).toBe(true);
  });

  it('AT-107: admin lists the full ledger', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, ADMIN);
    const res = await request(stack.app)
      .get('/api/audit/logs?limit=200')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    expect(res.body._meta.count).toBeGreaterThan(0);
  });

  it('AT-108: nurse ledger access is 403', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const res = await request(stack.app)
      .get('/api/audit/logs')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(403);
  });

  it('AT-109: doctor ledger access is scoped to own-ward events', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, DOCTOR);
    const res = await request(stack.app)
      .get('/api/audit/logs?limit=200')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ ward: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.ward === 'icu')).toBe(true);
  });

  it('AT-110: nurse roster contains ward_a only', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const res = await request(stack.app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ ward: string; hospital_number: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.ward === 'ward_a')).toBe(true);
    expect(rows.some((row) => row.hospital_number === 'HOSP-LOS-2025-084')).toBe(false);
  });

  it('AT-111: doctor off-ward roster rows are masked with a break-glass affordance', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, DOCTOR);
    const res = await request(stack.app)
      .get('/api/patients?ward=maternity')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row['masked']).toBe(true);
      expect(row['can_break_glass']).toBe(true);
      expect(String(row['full_name'])).toContain('••••');
      expect(row).not.toHaveProperty('primary_diagnosis');
    }
  });

  it('AT-112: clerk roster is the intake queue with no clinical fields', async () => {
    const stack = await createSeededStack(AFTERNOON_CLOCK);
    const auth = await token(stack, CLERK);
    const res = await request(stack.app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    const numbers = (res.body.data as Array<{ hospital_number: string }>).map(
      (row) => row.hospital_number
    );
    expect([...numbers].sort()).toEqual([
      'HOSP-LOS-2025-081',
      'HOSP-LOS-2025-091',
      'HOSP-LOS-2025-092'
    ]);
    bodiesDoNotContain([res.body], demoSensitivePlaintexts(), 'AT-112 roster');
  });

  it('AT-113: clerk enumeration of an ICU patient is 404, not 403', async () => {
    const stack = await createSeededStack(AFTERNOON_CLOCK);
    const auth = await token(stack, CLERK);
    const res = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(404);
  });

  it('AT-116: no seed sensitive plaintext appears in any redacted response body', async () => {
    const nurseStack = await createSeededStack(MORNING_CLOCK);
    const nurseAuth = await token(nurseStack, NURSE);
    const denied = await request(nurseStack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${nurseAuth}`);
    const masked = await request(nurseStack.app)
      .get('/api/patients?ward=icu')
      .set('Authorization', `Bearer ${nurseAuth}`);

    const clerkStack = await createSeededStack(AFTERNOON_CLOCK);
    const clerkAuth = await token(clerkStack, CLERK);
    const redacted = await request(clerkStack.app)
      .get('/api/patients/HOSP-LOS-2025-081')
      .set('Authorization', `Bearer ${clerkAuth}`);
    const queue = await request(clerkStack.app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${clerkAuth}`);

    const adminStack = await createSeededStack(MORNING_CLOCK);
    const adminAuth = await token(adminStack, ADMIN);
    const adminRead = await request(adminStack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${adminAuth}`);

    // The ICU doctor's allowed read is excluded: it legitimately contains plaintext.
    bodiesDoNotContain(
      [denied.body, masked.body, redacted.body, queue.body, adminRead.body],
      demoSensitivePlaintexts(),
      'AT-116 matrix'
    );
  });

  it('AT-117: swapped ciphertext fails closed with ENCRYPTION_INTEGRITY_FAILURE', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const ids = stack.db
      .prepare(
        'SELECT hospital_number, id FROM patients WHERE hospital_number IN (?, ?) ORDER BY hospital_number ASC'
      )
      .all('HOSP-LOS-2025-082', 'HOSP-LOS-2025-084') as Array<{ hospital_number: string; id: string }>;
    const first = ids[0] as { id: string };
    const second = ids[1] as { id: string };
    const enc082 = (
      stack.db.prepare('SELECT hiv_status_enc FROM clinical_data WHERE patient_id = ?').get(first.id) as {
        hiv_status_enc: string;
      }
    ).hiv_status_enc;
    const enc084 = (
      stack.db.prepare('SELECT hiv_status_enc FROM clinical_data WHERE patient_id = ?').get(second.id) as {
        hiv_status_enc: string;
      }
    ).hiv_status_enc;
    stack.db
      .prepare('UPDATE clinical_data SET hiv_status_enc = ? WHERE patient_id = ?')
      .run(enc084, first.id);
    stack.db
      .prepare('UPDATE clinical_data SET hiv_status_enc = ? WHERE patient_id = ?')
      .run(enc082, second.id);

    const auth = await token(stack, DOCTOR);
    const res = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-084')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('ENCRYPTION_INTEGRITY_FAILURE');
    bodiesDoNotContain([res.body], ['Reactive (Confirmed)', 'Non-reactive'], 'AT-117 body');
    const alerts = abuseAlertsRepository(stack.db).listByStatus('FLAGGED');
    expect(alerts.some((alert) => alert.severity === 'CRITICAL')).toBe(true);
  });

  it('AT-022: reads during handover grace are allowed', async () => {
    const stack = await createSeededStack(GRACE_CLOCK);
    const auth = await token(stack, NURSE);
    const res = await request(stack.app)
      .get('/api/patients/HOSP-LOS-2025-082')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
  });

  it('AT-023: writes during handover grace are 403 OFF_DUTY_WRITE', async () => {
    const stack = await createSeededStack(GRACE_CLOCK);
    const auth = await token(stack, NURSE);
    const res = await request(stack.app)
      .post('/api/patients/HOSP-LOS-2025-082/vitals')
      .set('Authorization', `Bearer ${auth}`)
      .send({ heart_rate: 80, blood_pressure: '120/80', spo2: 98, temperature: 36.8 });
    expect(res.status).toBe(403);
    expect(res.body.error.reason_code).toBe('OFF_DUTY_WRITE');
  });

  it('admissions queue rejects ward clinicians with QUEUE_ACCESS_DENIED', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await token(stack, NURSE);
    const res = await request(stack.app)
      .get('/api/admissions/queue')
      .set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(403);
    expect(res.body.error.reason_code).toBe('QUEUE_ACCESS_DENIED');
  });
});
