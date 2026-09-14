// GridVault offline sync service (PRD 10.5).
//
// POST /api/sync/batch accepts <= 100 mutations ordered by
// (device_id, device_seq). Additive types (VITALS, NOTE_APPEND, MAR_SIGN)
// never conflict; mutating types (PATIENT_PATCH) use optimistic concurrency
// on patients.version (409 + charge-nurse reconciliation task, never a
// silent overwrite). Idempotency is by client_mutation_id: replaying a batch
// returns the original result with duplicates_ignored counted and zero new
// rows or ledger entries (AT-508). Clock skew beyond 10 minutes stores both
// timestamps with clock_skew_flag=1; ordering always uses device_seq, never
// the clock. Sequence gaps raise SYNC_GAP_DETECTED naming device + missing
// range (AT-506). Each applied mutation writes one SYNC_REPLAY ledger entry
// carrying client_mutation_id, device_id, device_seq and both timestamps.
//
// The whole batch commits in ONE transaction: kill -9 mid-batch applies
// nothing, and replay completes cleanly (AT-514).

import { v7 as uuidv7 } from 'uuid';
import type { GridVaultDatabase } from '../db/connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import { appendLedgerEntry } from '../ledger/append.js';
import { patientsRepository } from '../db/repositories/patients.js';
import {
  clinicalNotesRepository,
  vitalsRepository
} from '../db/repositories/clinical.js';
import { syncMutationsRepository } from '../db/repositories/sync.js';
import { notificationOutboxRepository } from '../db/repositories/security.js';
import { AppError } from '../http/errors.js';
import { decide } from '../policy/decide.js';
import type { AuthenticatedSubject, RequestMeta } from '../auth/service.js';
import { deriveStatus, parseBloodPressure } from '../records/status.js';
import type { PatientBundle } from '../records/source.js';
import { SqliteRecordSource } from '../records/source.js';

export const SYNC_MAX_BATCH = 100;
export const CLOCK_SKEW_THRESHOLD_MS = 10 * 60 * 1000;

export type SyncMutationType = 'VITALS' | 'NOTE_APPEND' | 'MAR_SIGN' | 'PATIENT_PATCH' | 'PAPER_BACKFILL';

export interface SyncMutationInput {
  client_mutation_id: string;
  device_id: string;
  device_seq: number;
  type: SyncMutationType;
  /** Hospital number (e.g. HOSP-LOS-2025-082). */
  patient_id: string;
  base_version?: number | null;
  payload: Record<string, unknown>;
  captured_at: string;
  captured_at_source?: 'device_clock' | 'user_entered';
}

export interface SyncBatchResult {
  processed: number;
  duplicates_ignored: number;
  conflicts: number;
  audit_entries_created: number;
  warnings: Array<{ code: string; device_id: string; message: string }>;
  results: Array<{
    client_mutation_id: string;
    status: 'applied' | 'duplicate' | 'conflict' | 'error';
    audit_log_index: number | null;
    detail?: Record<string, string | number | boolean | null>;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCapturedAt(raw: string): number {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'captured_at is not a valid timestamp' });
  }
  return ms;
}

function assertVitalsPayload(payload: Record<string, unknown>): {
  heart_rate: number;
  blood_pressure: string;
  spo2: number;
  temperature: number;
  respiratory_rate: number | null;
  pain_score: number | null;
} {
  const hr = payload.heart_rate;
  const bp = payload.blood_pressure;
  const spo2 = payload.spo2;
  const temp = payload.temperature;
  const problems: string[] = [];
  if (!Number.isInteger(hr) || (hr as number) < 20 || (hr as number) > 250) problems.push('heart_rate');
  if (typeof bp !== 'string' || parseBloodPressure(bp) === null) problems.push('blood_pressure');
  if (!Number.isInteger(spo2) || (spo2 as number) < 50 || (spo2 as number) > 100) problems.push('spo2');
  if (typeof temp !== 'number' || temp < 30.0 || temp > 45.0) problems.push('temperature');
  const rr = payload.respiratory_rate ?? null;
  const ps = payload.pain_score ?? null;
  if (rr !== null && (!Number.isInteger(rr) || (rr as number) < 0 || (rr as number) > 80)) problems.push('respiratory_rate');
  if (ps !== null && (!Number.isInteger(ps) || (ps as number) < 0 || (ps as number) > 10)) problems.push('pain_score');
  if (problems.length > 0) {
    throw new AppError({
      code: 'INVALID_VITALS',
      httpStatus: 422,
      message: 'The vitals are outside clinically valid ranges',
      details: { fields: problems.join(',') }
    });
  }
  return {
    heart_rate: hr as number,
    blood_pressure: bp as string,
    spo2: spo2 as number,
    temperature: temp as number,
    respiratory_rate: (rr as number | null) ?? null,
    pain_score: (ps as number | null) ?? null
  };
}

export class SyncService {
  private readonly db: GridVaultDatabase;
  private readonly clock: Clock;
  private readonly timeZone: string;

  constructor(options: { db: GridVaultDatabase; clock?: Clock; timeZone?: string }) {
    this.db = options.db;
    this.clock = options.clock ?? systemClock;
    this.timeZone = options.timeZone ?? 'Africa/Lagos';
  }

  private stamp(at: Date = this.clock.now()): string {
    return formatIsoWithOffset(at, this.timeZone);
  }

  deviceStatus(deviceId: string): { device_id: string; last_seq: number | null; applied: number } {
    const last = syncMutationsRepository(this.db).maxDeviceSeq(deviceId);
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM sync_mutations WHERE device_id = ?')
      .get(deviceId) as { n: number };
    return { device_id: deviceId, last_seq: last, applied: row.n };
  }

  applyBatch(
    auth: AuthenticatedSubject,
    mutations: SyncMutationInput[],
    meta: RequestMeta
  ): SyncBatchResult {
    if (mutations.length === 0) {
      throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'The batch is empty' });
    }
    if (mutations.length > SYNC_MAX_BATCH) {
      throw new AppError({
        code: 'INVALID_BODY',
        httpStatus: 400,
        message: `The batch accepts at most ${SYNC_MAX_BATCH} mutations`
      });
    }
    // Deterministic order: (device_id, device_seq). Ordering within a device
    // always uses device_seq, never the clock (PRD 10.5.5).
    const ordered = [...mutations].sort((a, b) =>
      a.device_id === b.device_id ? a.device_seq - b.device_seq : a.device_id < b.device_id ? -1 : 1
    );
    const nowMs = this.clock.now().getTime();
    const nowIso = this.stamp();

    // Gap detection is computed BEFORE the transaction so warnings survive
    // even when every mutation is a duplicate replay.
    const warnings = this.detectGaps(ordered);

    const result: SyncBatchResult = {
      processed: ordered.length,
      duplicates_ignored: 0,
      conflicts: 0,
      audit_entries_created: 0,
      warnings,
      results: []
    };

    const run = this.db.transaction(() => {
      for (const mutation of ordered) {
        const existing = syncMutationsRepository(this.db).findByClientMutationId(mutation.client_mutation_id);
        if (existing !== undefined) {
          result.duplicates_ignored += 1;
          result.results.push({
            client_mutation_id: mutation.client_mutation_id,
            status: 'duplicate',
            audit_log_index: existing.audit_log_index
          });
          continue;
        }
        try {
          const auditIndex = this.applyOne(auth, mutation, meta, nowMs, nowIso);
          result.audit_entries_created += 1;
          result.results.push({
            client_mutation_id: mutation.client_mutation_id,
            status: 'applied',
            audit_log_index: auditIndex
          });
        } catch (error) {
          if (error instanceof AppError && (error.code === 'VERSION_CONFLICT' || error.code === 'BED_OCCUPIED')) {
            result.conflicts += 1;
            result.results.push({
              client_mutation_id: mutation.client_mutation_id,
              status: 'conflict',
              audit_log_index: null,
              detail: { code: error.code, ...error.details }
            });
            continue;
          }
          throw error;
        }
      }
    });
    run();
    return result;
  }

  private detectGaps(
    ordered: SyncMutationInput[]
  ): Array<{ code: string; device_id: string; message: string }> {
    const warnings: Array<{ code: string; device_id: string; message: string }> = [];
    const byDevice = new Map<string, number[]>();
    for (const m of ordered) {
      const list = byDevice.get(m.device_id) ?? [];
      list.push(m.device_seq);
      byDevice.set(m.device_id, list);
    }
    const repo = syncMutationsRepository(this.db);
    for (const [deviceId, seqs] of byDevice) {
      const sorted = [...seqs].sort((a, b) => a - b);
      // Gap against already-stored head: batch min skips stored max+1.
      const storedMax = repo.maxDeviceSeq(deviceId);
      const first = sorted[0] as number;
      if (storedMax !== null && first > storedMax + 1) {
        warnings.push({
          code: 'SYNC_GAP_DETECTED',
          device_id: deviceId,
          message: `SYNC_GAP_DETECTED: device ${deviceId} missing seq ${storedMax + 1}..${first - 1}`
        });
      }
      // Gaps inside the batch itself.
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1] as number;
        const cur = sorted[i] as number;
        if (cur > prev + 1) {
          warnings.push({
            code: 'SYNC_GAP_DETECTED',
            device_id: deviceId,
            message: `SYNC_GAP_DETECTED: device ${deviceId} missing seq ${prev + 1}..${cur - 1}`
          });
        }
      }
    }
    return warnings;
  }

  private applyOne(
    auth: AuthenticatedSubject,
    mutation: SyncMutationInput,
    meta: RequestMeta,
    nowMs: number,
    nowIso: string
  ): number {
    const source = new SqliteRecordSource(this.db);
    const bundle = source.findByHospitalNumber(mutation.patient_id) as PatientBundle | undefined;
    if (bundle === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    const capturedMs = parseCapturedAt(mutation.captured_at);
    // Bedside timestamps are normalized to facility time on ingestion.
    // Storing raw client strings mixes UTC (+00:00) with ward (+01:00)
    // spellings, and ORDER BY recorded_at then misorders the chart: a
    // synced reading can hide behind older seed rows lexicographically
    // while being newer. Africa/Lagos has no DST, so the rendering is
    // chronological for every stored row. The verbatim client value stays
    // in the SYNC_REPLAY details for audit fidelity.
    const bedsideIso = formatIsoWithOffset(new Date(capturedMs), this.timeZone);
    const skew = Math.abs(capturedMs - nowMs) > CLOCK_SKEW_THRESHOLD_MS;
    const base = {
      staff_id: auth.user.staff_id,
      staff_role: auth.user.role,
      ward: auth.user.assigned_ward,
      patient_id: bundle.patient.id,
      session_id: auth.sessionId,
      terminal_id: meta.terminal_id ?? null,
      source_ip: meta.source_ip ?? null
    };

    switch (mutation.type) {
      case 'VITALS':
      case 'PAPER_BACKFILL': {
        if (!isRecord(mutation.payload)) {
          throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'VITALS payload must be an object' });
        }
        // Policy still governs replay: an offline capture by an unauthorized
        // subject must not launder itself into the record on reconnect.
        const subject = {
          staff_id: auth.user.staff_id,
          role: auth.user.role,
          assigned_ward: auth.user.assigned_ward,
          assigned_shift: auth.user.assigned_shift,
          account_status: auth.user.account_status,
          expires_at: auth.user.expires_at
        };
        const decision = decide(
          subject,
          'write',
          { patient_id: bundle.patient.id, hospital_number: bundle.patient.hospital_number, ward: bundle.patient.ward },
          {
            duty: auth.duty,
            nowMs,
            grant: null,
            inIntakeQueue: false,
            clerkKnownWards: [],
            requested: ['VITALS']
          }
        );
        if (decision.effect === 'DENY' || decision.groups['VITALS']?.write_allowed !== true) {
          throw new AppError({
            code: 'ACCESS_DENIED',
            httpStatus: 403,
            message: 'Access denied by policy',
            reasonCode: decision.reason_code
          });
        }
        const vitals = assertVitalsPayload(mutation.payload);
        const isPaper = mutation.type === 'PAPER_BACKFILL';
        const id = uuidv7();
        const status = deriveStatus(vitals);
        vitalsRepository(this.db).insert({
          id,
          patient_id: bundle.patient.id,
          heart_rate: vitals.heart_rate,
          blood_pressure: vitals.blood_pressure,
          spo2: vitals.spo2,
          temperature: vitals.temperature,
          respiratory_rate: vitals.respiratory_rate,
          pain_score: vitals.pain_score,
          recorded_by: auth.user.staff_id,
          recorded_at: bedsideIso,
          ingested_at: nowIso,
          is_offline_sync: 1,
          source: isPaper ? 'paper_backfill' : 'offline_sync',
          device_id: mutation.device_id,
          device_seq: mutation.device_seq,
          client_mutation_id: mutation.client_mutation_id,
          clock_skew_flag: skew ? 1 : 0
        });
        const current = patientsRepository(this.db).findById(bundle.patient.id);
        if (current !== undefined && current.status_source === 'auto' && current.status !== status) {
          this.db.prepare('UPDATE patients SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso, bundle.patient.id);
        }
        const action = isPaper ? 'BACKFILL_PAPER_SLIP' : 'SYNC_REPLAY';
        const entry = appendLedgerEntry(
          this.db,
          {
            ...base,
            action,
            details: isPaper
              ? {
                  client_mutation_id: mutation.client_mutation_id,
                  device_id: mutation.device_id,
                  device_seq: mutation.device_seq,
                  hospital_number: bundle.patient.hospital_number,
                  captured_at: mutation.captured_at,
                  ingested_at: nowIso,
                  clock_skew_flag: skew ? 1 : 0,
                  transcriber: auth.user.staff_id,
                  source: 'paper_backfill'
                }
              : {
                  client_mutation_id: mutation.client_mutation_id,
                  device_id: mutation.device_id,
                  device_seq: mutation.device_seq,
                  hospital_number: bundle.patient.hospital_number,
                  captured_at: mutation.captured_at,
                  ingested_at: nowIso,
                  clock_skew_flag: skew ? 1 : 0,
                  source: 'offline_sync'
                },
            timestamp: nowIso
          },
          { clock: this.clock, timeZone: this.timeZone }
        );
        syncMutationsRepository(this.db).insert({
          client_mutation_id: mutation.client_mutation_id,
          device_id: mutation.device_id,
          device_seq: mutation.device_seq,
          type: mutation.type,
          patient_id: bundle.patient.id,
          applied_at: nowIso,
          result_json: JSON.stringify({ vitals_id: id, status }),
          audit_log_index: entry.log_index
        });
        return entry.log_index;
      }
      case 'NOTE_APPEND': {
        if (!isRecord(mutation.payload) || typeof mutation.payload.body !== 'string') {
          throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'NOTE_APPEND requires a body' });
        }
        const noteType =
          mutation.payload.note_type === 'nursing' ||
          mutation.payload.note_type === 'medical' ||
          mutation.payload.note_type === 'handover' ||
          mutation.payload.note_type === 'psychiatric'
            ? mutation.payload.note_type
            : 'nursing';
        const id = uuidv7();
        clinicalNotesRepository(this.db).insert({
          id,
          patient_id: bundle.patient.id,
          author_staff_id: auth.user.staff_id,
          note_type: noteType,
          body: mutation.payload.body as string,
          written_at: bedsideIso,
          ingested_at: nowIso,
          source: 'offline_sync',
          client_mutation_id: mutation.client_mutation_id
        });
        const entry = appendLedgerEntry(
          this.db,
          {
            ...base,
            action: 'SYNC_REPLAY',
            details: {
              client_mutation_id: mutation.client_mutation_id,
              device_id: mutation.device_id,
              device_seq: mutation.device_seq,
              hospital_number: bundle.patient.hospital_number,
              captured_at: mutation.captured_at,
              ingested_at: nowIso,
              clock_skew_flag: skew ? 1 : 0,
              note_id: id,
              source: 'offline_sync'
            },
            timestamp: nowIso
          },
          { clock: this.clock, timeZone: this.timeZone }
        );
        syncMutationsRepository(this.db).insert({
          client_mutation_id: mutation.client_mutation_id,
          device_id: mutation.device_id,
          device_seq: mutation.device_seq,
          type: mutation.type,
          patient_id: bundle.patient.id,
          applied_at: nowIso,
          result_json: JSON.stringify({ note_id: id }),
          audit_log_index: entry.log_index
        });
        return entry.log_index;
      }
      case 'MAR_SIGN': {
        const entryId = mutation.payload.entry_id;
        if (typeof entryId !== 'string') {
          throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'MAR_SIGN requires entry_id' });
        }
        const existing = this.db
          .prepare('SELECT * FROM mar_entries WHERE id = ? AND patient_id = ?')
          .get(entryId, bundle.patient.id) as { status: string } | undefined;
        if (existing === undefined) {
          throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'MAR entry not found' });
        }
        if (existing.status !== 'scheduled') {
          throw new AppError({ code: 'INVALID_STATE', httpStatus: 409, message: 'Only scheduled entries can be signed' });
        }
        this.db
          .prepare('UPDATE mar_entries SET status = ?, administered_at = ?, administered_by = ? WHERE id = ?')
          .run('given', nowIso, auth.user.staff_id, entryId);
        const entry = appendLedgerEntry(
          this.db,
          {
            ...base,
            action: 'SYNC_REPLAY',
            details: {
              client_mutation_id: mutation.client_mutation_id,
              device_id: mutation.device_id,
              device_seq: mutation.device_seq,
              hospital_number: bundle.patient.hospital_number,
              captured_at: mutation.captured_at,
              ingested_at: nowIso,
              clock_skew_flag: skew ? 1 : 0,
              entry_id: entryId,
              source: 'offline_sync'
            },
            timestamp: nowIso
          },
          { clock: this.clock, timeZone: this.timeZone }
        );
        syncMutationsRepository(this.db).insert({
          client_mutation_id: mutation.client_mutation_id,
          device_id: mutation.device_id,
          device_seq: mutation.device_seq,
          type: mutation.type,
          patient_id: bundle.patient.id,
          applied_at: nowIso,
          result_json: JSON.stringify({ entry_id: entryId }),
          audit_log_index: entry.log_index
        });
        return entry.log_index;
      }
      case 'PATIENT_PATCH': {
        if (!isRecord(mutation.payload)) {
          throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'PATIENT_PATCH payload must be an object' });
        }
        const current = patientsRepository(this.db).findById(bundle.patient.id);
        if (current === undefined) {
          throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
        }
        const baseVersion = mutation.base_version ?? null;
        if (baseVersion === null || baseVersion !== current.version) {
          notificationOutboxRepository(this.db).insert({
            id: uuidv7(),
            channel: 'local',
            recipient: 'charge_nurse',
            subject: 'Sync reconciliation required',
            body:
              `Offline patch for ${bundle.patient.hospital_number} based on version ${String(baseVersion)}; ` +
              `current version ${current.version}. Device ${mutation.device_id} seq ${mutation.device_seq}.`,
            priority: 'HIGH',
            related_type: 'patient',
            related_id: bundle.patient.hospital_number,
            status: 'PENDING',
            attempts: 0,
            last_error: null,
            created_at: nowIso,
            dispatched_at: null,
            delivered_at: null
          });
          syncMutationsRepository(this.db).insert({
            client_mutation_id: mutation.client_mutation_id,
            device_id: mutation.device_id,
            device_seq: mutation.device_seq,
            type: mutation.type,
            patient_id: bundle.patient.id,
            applied_at: nowIso,
            result_json: JSON.stringify({ conflict: true, base_version: baseVersion, current_version: current.version }),
            audit_log_index: null
          });
          throw new AppError({
            code: 'VERSION_CONFLICT',
            httpStatus: 409,
            message: 'The record changed since the device last synced',
            details: {
              base_version: baseVersion ?? -1,
              current_version: current.version
            }
          });
        }
        const nextStatus =
          mutation.payload.status === 'stable' ||
          mutation.payload.status === 'observation' ||
          mutation.payload.status === 'critical' ||
          mutation.payload.status === 'discharged'
            ? (mutation.payload.status as string)
            : current.status;
        this.db
          .prepare('UPDATE patients SET status = ?, version = ?, updated_at = ? WHERE id = ?')
          .run(nextStatus, current.version + 1, nowIso, current.id);
        const entry = appendLedgerEntry(
          this.db,
          {
            ...base,
            action: 'SYNC_REPLAY',
            details: {
              client_mutation_id: mutation.client_mutation_id,
              device_id: mutation.device_id,
              device_seq: mutation.device_seq,
              hospital_number: bundle.patient.hospital_number,
              captured_at: mutation.captured_at,
              ingested_at: nowIso,
              clock_skew_flag: skew ? 1 : 0,
              version: current.version + 1,
              source: 'offline_sync'
            },
            timestamp: nowIso
          },
          { clock: this.clock, timeZone: this.timeZone }
        );
        syncMutationsRepository(this.db).insert({
          client_mutation_id: mutation.client_mutation_id,
          device_id: mutation.device_id,
          device_seq: mutation.device_seq,
          type: mutation.type,
          patient_id: bundle.patient.id,
          applied_at: nowIso,
          result_json: JSON.stringify({ version: current.version + 1 }),
          audit_log_index: entry.log_index
        });
        return entry.log_index;
      }
      default: {
        throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'Unknown mutation type' });
      }
    }
  }
}
