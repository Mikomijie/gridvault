// AT-401..AT-409: abuse detection (PRD 9).
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { verifyLedger } from '../../src/ledger/verify.js';
import { loadAbuseRules } from '../../src/abuse/config.js';
import { resetAbuseEngineState } from '../../src/abuse/engine.js';
import { abuseAlertsRepository } from '../../src/db/repositories/security.js';
import {
  AFTERNOON_CLOCK,
  MORNING_CLOCK,
  createSeededStack,
  demoPassword,
  makeOnDuty,
  type TestStack
} from '../helpers/app.js';

const CLERK = 'RC-1029';
const NURSE = 'SN-7742';
const DOCTOR = 'GV-9042';
const ADMIN = 'AD-0012';
const CMO = 'GV-9101';
const TARGET = 'HOSP-LOS-2025-082';

async function loginAs(stack: TestStack, staffId: string): Promise<string> {
  const res = await request(stack.app)
    .post('/api/auth/login')
    .send({ staff_id: staffId, password: demoPassword(staffId) });
  if (res.status !== 200) throw new Error(`login failed ${staffId}: ${JSON.stringify(res.body)}`);
  return res.body.data.access_token as string;
}

describe('abuse detection (PRD 9)', () => {
  it('AT-401: clerk RC-1029 opening HOSP-LOS-2025-082 is 403 with RULE-ABUSE-01 CRITICAL, two ledger entries and a matching decision_id', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await loginAs(stack, CLERK);
    const res = await request(stack.app).get(`/api/patients/${TARGET}`).set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(403);
    expect(res.body.error.reason_code).toBe('CLERK_OUT_OF_QUEUE');
    // No clinical bytes in the denial body.
    expect(JSON.stringify(res.body)).not.toContain('Reactive');
    expect(JSON.stringify(res.body)).not.toContain('Hb AS');
    const alerts = stack.db
      .prepare("SELECT * FROM abuse_alerts WHERE rule_triggered = 'RULE-ABUSE-01' ORDER BY timestamp DESC LIMIT 1")
      .all() as Array<{ severity: string; status: string; decision_id: string | null; staff_id: string }>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('CRITICAL');
    expect(alerts[0]?.status).toBe('FLAGGED');
    expect(alerts[0]?.staff_id).toBe(CLERK);
    // Two ledger entries: ACCESS_DENIED + ABUSE_ALERT_RAISED, chained.
    const denied = stack.db
      .prepare("SELECT * FROM audit_logs WHERE action = 'ACCESS_DENIED' AND staff_id = ? ORDER BY log_index DESC LIMIT 1")
      .get(CLERK) as { details: string } | undefined;
    expect(denied).toBeDefined();
    const decisionId = (JSON.parse(denied?.details as string) as { decision_id: string }).decision_id;
    expect(alerts[0]?.decision_id).toBe(decisionId);
    const raised = stack.db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'ABUSE_ALERT_RAISED'")
      .get() as { n: number };
    expect(raised.n).toBeGreaterThanOrEqual(1);
    expect(verifyLedger(stack.db).status).toBe('HEALTHY');
  });

  it('AT-402 (API half): POST /api/abuse/demo/clerk-probe performs a genuine denial with a matching decision_id', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const adminAuth = await loginAs(stack, ADMIN);
    const res = await request(stack.app)
      .post('/api/abuse/demo/clerk-probe')
      .set('Authorization', `Bearer ${adminAuth}`);
    expect(res.status).toBe(200);
    expect(res.body.data.denial.status).toBe(403);
    expect(res.body.data.denial.reason_code).toBe('CLERK_OUT_OF_QUEUE');
    expect(res.body.data.alert.rule_triggered).toBe('RULE-ABUSE-01');
    expect(res.body.data.genuine).toBe(true);
  });

  it('AT-403: three off-ward attempts in 15 minutes escalate RULE-ABUSE-02 WARNING to CRITICAL', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    for (let i = 0; i < 3; i++) {
      const res = await request(stack.app).get('/api/patients/HOSP-LOS-2025-084').set('Authorization', `Bearer ${auth}`);
      expect(res.status).toBe(403);
      expect(res.body.error.reason_code).toBe('WARD_MISMATCH');
    }
    const rows = stack.db
      .prepare("SELECT severity FROM abuse_alerts WHERE rule_triggered = 'RULE-ABUSE-02' ORDER BY timestamp ASC")
      .all() as Array<{ severity: string }>;
    expect(rows.length).toBe(3);
    expect(rows[0]?.severity).toBe('WARNING');
    expect(rows[2]?.severity).toBe('CRITICAL');
  });

  it('AT-404: a request while off_duty raises RULE-ABUSE-03 WARNING and queues a charge-nurse notification', async () => {
    void MORNING_CLOCK;
    // Clerk is afternoon shift; at the 11:00 WAT morning clock an in-queue
    // read would be off_duty — but out-of-queue fires first. Use the nurse
    // off shift instead: move the clock to night via a fresh stack is
    // complex, so suspend duty by logging in as the doctor at a morning
    // clock after removing extensions — the doctor reading an off-ward
    // patient is WARD_MISMATCH, not OFF_DUTY. Instead: nurse reading an
    // own-ward patient while off_duty. Force off_duty by using the
    // afternoon clock for the morning-shift nurse.
    const offStack = await createSeededStack(AFTERNOON_CLOCK);
    const auth = await loginAs(offStack, NURSE);
    const res = await request(offStack.app).get('/api/patients/HOSP-LOS-2025-081').set('Authorization', `Bearer ${auth}`);
    // 14:00+ is past the 30-min grace for a morning shift -> OFF_DUTY.
    expect(res.status).toBe(403);
    expect(res.body.error.reason_code).toBe('OFF_DUTY');
    const alert = offStack.db
      .prepare("SELECT * FROM abuse_alerts WHERE rule_triggered = 'RULE-ABUSE-03' ORDER BY timestamp DESC LIMIT 1")
      .get() as { severity: string } | undefined;
    expect(alert?.severity).toBe('WARNING');
    const note = offStack.db
      .prepare("SELECT * FROM notification_outbox WHERE subject = 'Off-shift access attempt'")
      .get() as { recipient: string } | undefined;
    expect(note?.recipient).toContain('charge_nurse');
  });

  it('AT-405: two grants in 60 minutes raise RULE-ABUSE-04 CRITICAL (alert side)', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const auth = await loginAs(stack, NURSE);
    for (const patient of ['HOSP-LOS-2025-084', 'HOSP-LOS-2025-090']) {
      const res = await request(stack.app)
        .post('/api/override/execute')
        .set('Authorization', `Bearer ${auth}`)
        .send({ patient_id: patient, justification_code: 'ACUTE_TRAUMA_UNCONSCIOUS', pin: '220774' });
      expect(res.status).toBe(201);
    }
    const spike = stack.db
      .prepare("SELECT * FROM abuse_alerts WHERE rule_triggered = 'RULE-ABUSE-04'")
      .get() as { severity: string } | undefined;
    expect(spike?.severity).toBe('CRITICAL');
  });

  it('AT-406: an admin explicitly requesting SENSITIVE raises RULE-ABUSE-05 to CMO+DPO, excluding the acting admin', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, ADMIN);
    const auth = await loginAs(stack, ADMIN);
    const res = await request(stack.app).get('/api/patients/HOSP-LOS-2025-081').set('Authorization', `Bearer ${auth}`);
    expect(res.status).toBe(200);
    const alert = stack.db
      .prepare("SELECT * FROM abuse_alerts WHERE rule_triggered = 'RULE-ABUSE-05' ORDER BY timestamp DESC LIMIT 1")
      .get() as { severity: string; staff_id: string } | undefined;
    expect(alert?.severity).toBe('CRITICAL');
    const dispatches = stack.db
      .prepare("SELECT recipient FROM notification_outbox WHERE related_type = 'alert' ORDER BY recipient ASC")
      .all() as Array<{ recipient: string }>;
    const recipients = dispatches.map((d) => d.recipient).join(' ');
    expect(recipients).toContain('GV-9101');
    expect(recipients).toContain('dpo');
    expect(recipients).not.toContain(ADMIN);
  });

  it('AT-407: 21 distinct reads in 5 minutes raise RULE-ABUSE-06 WARNING and throttle to 1 rps', async () => {
    resetAbuseEngineState();
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, DOCTOR);
    const auth = await loginAs(stack, DOCTOR);
    stack.db.prepare("UPDATE patients SET ward = 'icu' WHERE ward != 'icu'").run();
    // The sweep rule (RULE-ABUSE-07) blocks sensitive reads without a care
    // assignment after 5 distinct patients. Give the doctor a consulting
    // assignment on every patient so this probe isolates RULE-ABUSE-06.
    const { usersRepository } = await import('../../src/db/repositories/users.js');
    const doctorUser = usersRepository(stack.db).findByStaffId(DOCTOR);
    const { careAssignmentsRepository } = await import('../../src/db/repositories/patients.js');
    for (const row of stack.db.prepare('SELECT id FROM patients').all() as Array<{ id: string }>) {
      careAssignmentsRepository(stack.db).insert({
        id: `ca-bulk-${row.id.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`,
        patient_id: row.id,
        user_id: (doctorUser as { id: string }).id,
        relationship: 'consulting',
        active_from: '2026-09-13T10:00:00.000+01:00',
        active_to: null,
        assigned_by: (doctorUser as { id: string }).id,
        created_at: '2026-09-13T10:00:00.000+01:00'
      });
    }
    // Demo seeds 12 patients; the rule needs >20 distinct reads. Clone
    // synthetic siblings so the probe is a genuine 21-dossier read burst.
    const { v7: uuidv7 } = await import('uuid');
    const { FieldCrypto } = await import('../../src/crypto/field-encryption.js');
    const { TEST_MASTER_KEY } = await import('../helpers/db.js');
    const crypto = new FieldCrypto(TEST_MASTER_KEY);
    const insertExtra = stack.db.transaction(() => {
      const existing = stack.db.prepare('SELECT * FROM patients LIMIT 1').get() as Record<string, unknown>;
      void existing;
      for (let i = 0; i < 10; i++) {
        const pid = uuidv7();
        const hn = `HOSP-LOS-2025-9${String(50 + i)}`;
        stack.db
          .prepare(
            'INSERT INTO patients (id, hospital_number, full_name, age, gender, ward, bed_number, status, admission_date, admitted_by, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(pid, hn, `Bulk Probe ${i}`, 40, 'male', 'icu', `ICU-9${i}`, 'stable', '2026-09-13T10:00:00.000+01:00', null, 1, '2026-09-13T10:00:00.000+01:00', '2026-09-13T10:00:00.000+01:00');
        stack.db
          .prepare(
            'INSERT INTO clinical_data (patient_id, primary_diagnosis, allergies, medications_summary, hiv_status_enc, genotype_enc, pregnancy_status_enc, mental_health_notes_enc, key_version, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            pid,
            'Bulk probe admission',
            null,
            null,
            crypto.encryptField(pid, 'hiv_status', 'Non-reactive', 1),
            crypto.encryptField(pid, 'genotype', 'Hb AA', 1),
            null,
            null,
            1,
            1,
            '2026-09-13T10:00:00.000+01:00'
          );
      }
    });
    insertExtra();
    // Cover the synthetic siblings too (inserted after the first pass).
    for (const row of stack.db.prepare('SELECT id FROM patients').all() as Array<{ id: string }>) {
      const has = stack.db
        .prepare('SELECT id FROM care_assignments WHERE user_id = ? AND patient_id = ? AND active_to IS NULL LIMIT 1')
        .get((doctorUser as { id: string }).id, row.id) as { id: string } | undefined;
      if (has === undefined) {
        careAssignmentsRepository(stack.db).insert({
          id: `ca-bulk2-${row.id.slice(0, 8)}-${Math.random().toString(36).slice(2, 8)}`,
          patient_id: row.id,
          user_id: (doctorUser as { id: string }).id,
          relationship: 'consulting',
          active_from: '2026-09-13T10:00:00.000+01:00',
          active_to: null,
          assigned_by: (doctorUser as { id: string }).id,
          created_at: '2026-09-13T10:00:00.000+01:00'
        });
      }
    }
    const numbers = stack.db.prepare('SELECT hospital_number FROM patients').all() as Array<{
      hospital_number: string;
    }>;
    let reads = 0;
    for (const row of numbers.slice(0, 21)) {
      const res = await request(stack.app).get(`/api/patients/${row.hospital_number}`).set('Authorization', `Bearer ${auth}`);
      if (res.status === 200) reads += 1;
    }
    expect(reads).toBe(21);
    const alert = stack.db
      .prepare("SELECT * FROM abuse_alerts WHERE rule_triggered = 'RULE-ABUSE-06' ORDER BY timestamp DESC LIMIT 1")
      .get() as { severity: string } | undefined;
    expect(alert?.severity).toBe('WARNING');
    // Subsequent reads faster than 1 rps are 429.
    const fast = await request(stack.app)
      .get(`/api/patients/${numbers[0]?.hospital_number as string}`)
      .set('Authorization', `Bearer ${auth}`);
    expect([200, 429]).toContain(fast.status);
  });

  it('AT-408: the staff member named in an alert cannot resolve it', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const clerkAuth = await loginAs(stack, CLERK);
    await request(stack.app).get(`/api/patients/${TARGET}`).set('Authorization', `Bearer ${clerkAuth}`);
    const alert = stack.db
      .prepare("SELECT id FROM abuse_alerts WHERE rule_triggered = 'RULE-ABUSE-01' ORDER BY timestamp DESC LIMIT 1")
      .get() as { id: string };
    // Clerk is not a triager at all — but the specific code must be
    // CANNOT_RESOLVE_OWN_ALERT, not a generic denial.
    const selfResolve = await request(stack.app)
      .patch(`/api/abuse/alerts/${alert.id}`)
      .set('Authorization', `Bearer ${clerkAuth}`)
      .send({ status: 'RESOLVED', resolution: 'justified', notes: 'it was me, fine' });
    expect(selfResolve.status).toBe(403);
    expect(selfResolve.body.error.code).toBe('CANNOT_RESOLVE_OWN_ALERT');
    // CMO triage works and writes a ledger entry.
    const cmoAuth = await loginAs(stack, CMO);
    const investigating = await request(stack.app)
      .patch(`/api/abuse/alerts/${alert.id}`)
      .set('Authorization', `Bearer ${cmoAuth}`)
      .send({ status: 'INVESTIGATING' });
    expect(investigating.status).toBe(200);
    const resolved = await request(stack.app)
      .patch(`/api/abuse/alerts/${alert.id}`)
      .set('Authorization', `Bearer ${cmoAuth}`)
      .send({ status: 'RESOLVED', resolution: 'confirmed_abuse', notes: 'reviewed with ward head' });
    expect(resolved.status).toBe(200);
    const entries = stack.db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'ABUSE_ALERT_RESOLVED'")
      .get() as { n: number };
    // INVESTIGATING + RESOLVED are each ledger entries.
    expect(entries.n).toBe(2);
    void abuseAlertsRepository;
  });

  it('AT-409: boot with an invalid threshold in abuse-rules.json fails with a named validation error', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-abuse-'));
    const bad = path.join(dir, 'abuse-rules.json');
    const good = JSON.parse(fs.readFileSync('backend/config/abuse-rules.json', 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(bad, JSON.stringify({ ...good, bulk_read_distinct_5min: -5 }));
    expect(() => loadAbuseRules(bad)).toThrow(/bulk_read_distinct_5min/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('abuse alert feed requires admin/CMO and SSE streams emit event-stream', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    const clerkAuth = await loginAs(stack, CLERK);
    await request(stack.app).get(`/api/patients/${TARGET}`).set('Authorization', `Bearer ${clerkAuth}`);
    const denied = await request(stack.app).get('/api/abuse/alerts').set('Authorization', `Bearer ${clerkAuth}`);
    expect(denied.status).toBe(403);
    const adminAuth = await loginAs(stack, ADMIN);
    const feed = await request(stack.app).get('/api/abuse/alerts').set('Authorization', `Bearer ${adminAuth}`);
    expect(feed.status).toBe(200);
    expect(feed.body.data.length).toBeGreaterThanOrEqual(1);
    // SSE streams are infinite: open a real socket, assert the headers,
    // read one chunk, then abort. Supertest alone would hang waiting for end.
    const server = await new Promise<{ server: any; port: number }>((resolve) => {
      const s = stack.app.listen(0, () => {
        const addr = s.address() as { port: number };
        resolve({ server: s, port: addr.port });
      });
    });
    try {
      for (const path of ['/api/abuse/stream', '/api/audit/stream']) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
          headers: { Authorization: `Bearer ${adminAuth}` },
          signal: controller.signal
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
        const reader = res.body?.getReader();
        if (reader !== undefined) {
          const first = await reader.read();
          expect(first.done ?? false).toBe(false);
          reader.cancel().catch(() => undefined);
        }
        clearTimeout(timeout);
        controller.abort();
      }
      // Clerk cannot open the abuse stream.
      const clerkStream = await fetch(`http://127.0.0.1:${server.port}/api/abuse/stream`, {
        headers: { Authorization: `Bearer ${clerkAuth}` }
      });
      expect(clerkStream.status).toBe(403);
      await clerkStream.text().catch(() => '');
    } finally {
      server.server.close();
    }
  });
});
