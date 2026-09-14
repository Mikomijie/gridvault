// AT-504..AT-509, AT-513: offline sync batch + paper backfill (PRD 10.5).
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { verifyLedger } from '../../src/ledger/verify.js';
import {
  MORNING_CLOCK,
  createSeededStack,
  demoPassword,
  makeOnDuty,
  type TestStack
} from '../helpers/app.js';

const NURSE = 'SN-7742';

async function loginAs(stack: TestStack, staffId: string): Promise<string> {
  const res = await request(stack.app)
    .post('/api/auth/login')
    .send({ staff_id: staffId, password: demoPassword(staffId) });
  if (res.status !== 200) throw new Error(`login failed ${staffId}: ${JSON.stringify(res.body)}`);
  return res.body.data.access_token as string;
}

function vitalsMutation(
  deviceId: string,
  seq: number,
  patient: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    client_mutation_id: `cm_${uuidv7().replace(/-/g, '')}`,
    device_id: deviceId,
    device_seq: seq,
    type: 'VITALS',
    patient_id: patient,
    payload: { heart_rate: 80, blood_pressure: '120/80', spo2: 98, temperature: 36.8 },
    captured_at: '2026-09-13T10:30:00.000+01:00',
    captured_at_source: 'device_clock',
    ...overrides
  };
}

describe('offline sync (PRD 10.5)', () => {
  it('AT-504: POST /api/sync/batch with 10 mutations applies all with SYNC_REPLAY entries and a verifiable chain', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    const mutations = Array.from({ length: 10 }, (_, i) =>
      vitalsMutation('term-warda-02', i + 1, 'HOSP-LOS-2025-081')
    );
    const res = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({ mutations });
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(10);
    expect(res.body.data.duplicates_ignored).toBe(0);
    expect(res.body.data.results.filter((r: { status: string }) => r.status === 'applied')).toHaveLength(10);
    const offline = stack.db
      .prepare("SELECT COUNT(*) AS n FROM vitals WHERE is_offline_sync = 1 AND source = 'offline_sync'")
      .get() as { n: number };
    expect(offline.n).toBe(10);
    const replay = stack.db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'SYNC_REPLAY'")
      .get() as { n: number };
    expect(replay.n).toBe(10);
    expect(verifyLedger(stack.db).status).toBe('HEALTHY');
  });

  it('AT-505: 3 devices x 10 mutations interleaved apply all 30 ordered by device_seq with none lost', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    const mutations: Record<string, unknown>[] = [];
    for (let seq = 1; seq <= 10; seq++) {
      for (const device of ['term-a', 'term-b', 'term-c']) {
        mutations.push(vitalsMutation(device, seq, 'HOSP-LOS-2025-081'));
      }
    }
    const res = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({ mutations });
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(30);
    const offline = stack.db
      .prepare("SELECT COUNT(*) AS n FROM vitals WHERE is_offline_sync = 1")
      .get() as { n: number };
    expect(offline.n).toBe(30);
    for (const device of ['term-a', 'term-b', 'term-c']) {
      const seqs = stack.db
        .prepare('SELECT device_seq FROM vitals WHERE device_id = ? ORDER BY device_seq ASC')
        .all(device) as Array<{ device_seq: number }>;
      expect(seqs.map((r) => r.device_seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  it('AT-506: a device_seq gap (41, 43) applies with a SYNC_GAP_DETECTED warning naming device and missing range', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    const mutations = [vitalsMutation('term-gap', 41, 'HOSP-LOS-2025-081'), vitalsMutation('term-gap', 43, 'HOSP-LOS-2025-081')];
    const res = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({ mutations });
    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBe(2);
    const warnings = res.body.data.warnings as Array<{ code: string; device_id: string; message: string }>;
    expect(warnings.some((w) => w.code === 'SYNC_GAP_DETECTED' && w.device_id === 'term-gap')).toBe(true);
    expect(warnings.some((w) => w.message.includes('42'))).toBe(true);
  });

  it('synced bedside timestamps normalize to facility time so latest-vitals ordering survives mixed offsets', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    // A UTC ('Z') spelling sorts before '+01:00' spellings of earlier
    // instants lexicographically; normalized storage keeps the chart order
    // chronological and the replayed reading becomes the latest.
    const res = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        mutations: [
          {
            client_mutation_id: `cm_${uuidv7().replace(/-/g, '')}`,
            device_id: 'term-tz',
            device_seq: 1,
            type: 'VITALS',
            patient_id: 'HOSP-LOS-2025-081',
            payload: { heart_rate: 99, blood_pressure: '120/80', spo2: 98, temperature: 36.8 },
            captured_at: '2026-09-13T12:00:00.000Z',
            captured_at_source: 'device_clock'
          }
        ]
      });
    expect(res.status).toBe(200);
    const row = stack.db
      .prepare('SELECT recorded_at FROM vitals WHERE device_id = ?')
      .get('term-tz') as { recorded_at: string };
    expect(row.recorded_at).toMatch(/\+01:00$/);
    expect(row.recorded_at).toContain('13:00');
    const latest = stack.db
      .prepare('SELECT heart_rate FROM vitals WHERE patient_id = (SELECT id FROM patients WHERE hospital_number = ?) ORDER BY recorded_at DESC LIMIT 1')
      .get('HOSP-LOS-2025-081') as { heart_rate: number };
    expect(latest.heart_rate).toBe(99);
  });

  it('AT-507: captured_at 45 minutes in the past stores both timestamps with clock_skew_flag=1, ordered by device_seq', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    const res = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        mutations: [
          vitalsMutation('term-skew', 1, 'HOSP-LOS-2025-081', {
            captured_at: '2026-09-13T09:45:00.000+01:00'
          })
        ]
      });
    expect(res.status).toBe(200);
    const row = stack.db
      .prepare('SELECT recorded_at, ingested_at, clock_skew_flag FROM vitals WHERE device_id = ?')
      .get('term-skew') as { recorded_at: string; ingested_at: string; clock_skew_flag: number };
    expect(row.clock_skew_flag).toBe(1);
    expect(row.recorded_at).toContain('09:45');
    expect(row.ingested_at).not.toContain('09:45');
    const entry = stack.db
      .prepare("SELECT details FROM audit_logs WHERE action = 'SYNC_REPLAY' ORDER BY log_index DESC LIMIT 1")
      .get() as { details: string };
    const details = JSON.parse(entry.details) as { captured_at: string; ingested_at: string };
    expect(details.captured_at).toContain('09:45');
    expect(details.ingested_at).toBeTruthy();
  });

  it('AT-508: replaying an identical batch twice reports duplicates_ignored with zero new rows or ledger entries', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    const mutations = Array.from({ length: 5 }, (_, i) =>
      vitalsMutation('term-replay', i + 1, 'HOSP-LOS-2025-081')
    );
    const first = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({ mutations });
    expect(first.status).toBe(200);
    const vitalsBefore = (stack.db.prepare('SELECT COUNT(*) AS n FROM vitals').get() as { n: number }).n;
    const ledgerBefore = (stack.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number }).n;
    const second = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({ mutations });
    expect(second.status).toBe(200);
    expect(second.body.data.duplicates_ignored).toBe(5);
    expect(second.body.data.results.every((r: { status: string }) => r.status === 'duplicate')).toBe(true);
    const vitalsAfter = (stack.db.prepare('SELECT COUNT(*) AS n FROM vitals').get() as { n: number }).n;
    const ledgerAfter = (stack.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number }).n;
    expect(vitalsAfter).toBe(vitalsBefore);
    expect(ledgerAfter).toBe(ledgerBefore);
  });

  it('AT-509: a demographic patch with a stale base_version is 409 with both versions and queues reconciliation', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    const res = await request(stack.app)
      .post('/api/sync/batch')
      .set('Authorization', `Bearer ${auth}`)
      .send({
        mutations: [
          {
            client_mutation_id: `cm_${uuidv7().replace(/-/g, '')}`,
            device_id: 'term-conflict',
            device_seq: 1,
            type: 'PATIENT_PATCH',
            patient_id: 'HOSP-LOS-2025-081',
            base_version: 999,
            payload: { status: 'critical' },
            captured_at: '2026-09-13T10:30:00.000+01:00',
            captured_at_source: 'device_clock'
          }
        ]
      });
    expect(res.status).toBe(200);
    expect(res.body.data.conflicts).toBe(1);
    expect(res.body.data.results[0].status).toBe('conflict');
    expect(res.body.data.results[0].detail.current_version).toBe(1);
    expect(res.body.data.results[0].detail.base_version).toBe(999);
    const task = stack.db
      .prepare("SELECT * FROM notification_outbox WHERE subject = 'Sync reconciliation required'")
      .get() as { recipient: string } | undefined;
    expect(task?.recipient).toContain('charge_nurse');
    // No silent overwrite: the live status is unchanged.
    const patient = stack.db
      .prepare('SELECT status FROM patients WHERE hospital_number = ?')
      .get('HOSP-LOS-2025-081') as { status: string };
    expect(patient.status).toBe('stable');
  });

  it('AT-513: paper backfill of 3 slips records source=paper_backfill with both timestamps, transcriber and BACKFILL_PAPER_SLIP entries', async () => {
    const stack = await createSeededStack(MORNING_CLOCK);
    makeOnDuty(stack, NURSE);
    const auth = await loginAs(stack, NURSE);
    const slips = [1, 2, 3].map((i) => ({
      client_mutation_id: `cm_${uuidv7().replace(/-/g, '')}`,
      patient_id: 'HOSP-LOS-2025-081',
      payload: { heart_rate: 80 + i, blood_pressure: '120/80', spo2: 98, temperature: 36.8 },
      captured_at: `2026-09-13T08:0${i}:00.000+01:00`
    }));
    const res = await request(stack.app)
      .post('/api/sync/backfill')
      .set('Authorization', `Bearer ${auth}`)
      .send({ slips });
    expect(res.status).toBe(201);
    const rows = stack.db
      .prepare("SELECT source, recorded_at, ingested_at FROM vitals WHERE source = 'paper_backfill'")
      .all() as Array<{ source: string; recorded_at: string; ingested_at: string }>;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.recorded_at).not.toBe(row.ingested_at);
    }
    const entries = stack.db
      .prepare("SELECT details FROM audit_logs WHERE action = 'BACKFILL_PAPER_SLIP'")
      .all() as Array<{ details: string }>;
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      const details = JSON.parse(entry.details) as { transcriber: string; source: string };
      expect(details.transcriber).toBe(NURSE);
      expect(details.source).toBe('paper_backfill');
    }
  });
});
