// GridVault records service (PRD 12.3).
//
// The only path from HTTP to patient data. Every method: load via the
// RecordSource -> resolve grant + queue facts -> decide() -> on DENY write
// ACCESS_DENIED, execute abuse obligations and throw (403, or 404 when the
// resource is not enumerable to the subject) -> on ALLOW build the DTO,
// decrypting sensitive fields ONLY when SENSITIVE was allowed, then write
// VIEW_RECORD (+ VIEW_SENSITIVE) and execute obligations.
//
// State changes (vitals, notes, MAR, patch) append their ledger entry
// inside the same transaction as the change: a vitals row without its
// RECORD_VITALS entry cannot exist.

import { v7 as uuidv7 } from 'uuid';
import type { GridVaultDatabase } from '../db/connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import { FieldCrypto } from '../crypto/field-encryption.js';
import { appendLedgerEntry } from '../ledger/append.js';
import {
  clinicalDataRepository,
  clinicalNotesRepository,
  vitalsRepository,
  type MarEntryRow,
  type VitalsRow
} from '../db/repositories/clinical.js';
import {
  patientLogisticsRepository,
  patientsRepository,
  type PatientRow,
  type PatientStatus
} from '../db/repositories/patients.js';
import { emergencyOverridesRepository } from '../db/repositories/overrides.js';
import { notificationOutboxRepository } from '../db/repositories/security.js';
import { AppError } from '../http/errors.js';
import { executeDecisionObligations } from '../abuse/engine.js';
import {
  detectBulkEnumeration,
  detectSensitiveSweep,
  enforceBulkThrottle,
  enforceSensitiveSweepBlock
} from '../abuse/engine.js';
import type { AbuseRuleThresholds } from '../abuse/config.js';
import { raiseAbuseAlert } from '../abuse/alerts.js';
import {
  decide,
  decideLedgerAccess,
  type Decision,
  type PolicyContext,
  type PolicyGrant,
  type PolicyResource,
  type PolicySubject
} from '../policy/decide.js';
import { PATIENT_FIELD_GROUPS, type FieldGroup, type PatientGroup } from '../policy/field-groups.js';
import { deriveStatus, parseBloodPressure } from './status.js';
import { buildMeta, maskName, RESTRICTED, type RedactionEntry, type SerializedMeta } from '../serialize/redact.js';
import type { AuthenticatedSubject, RequestMeta } from '../auth/service.js';
import type { OverrideService } from '../override/service.js';
import type { PatientBundle, RecordSource } from './source.js';

/** Break-glass scope (PRD 7.4): everything readable, VITALS+CLINICAL writable, SENSITIVE read-only. */
const GRANT_READABLE: PatientGroup[] = ['DEMOGRAPHICS', 'LOGISTICS', 'VITALS', 'CLINICAL', 'SENSITIVE'];
const GRANT_WRITABLE: PatientGroup[] = ['VITALS', 'CLINICAL'];

const ALL_PATIENT_GROUPS: PatientGroup[] = [...PATIENT_FIELD_GROUPS];

export interface DossierDto {
  data: {
    patient: Record<string, string | number | null>;
    logistics: Record<string, string | null> | null;
    vitals: { latest: Record<string, string | number | null> | null } | null;
    clinical: Record<string, string | null> | null;
    sensitive: Record<string, string | null> | null;
    mar: Array<Record<string, string | null>> | null;
    notes: Array<Record<string, string | null>> | null;
  };
  _meta: SerializedMeta;
}

export interface RosterRowDto {
  hospital_number: string;
  full_name: string;
  age: number | null;
  gender: string | null;
  ward: string;
  bed_number: string | null;
  status: string | null;
  masked: boolean;
  can_break_glass: boolean;
}

export interface VitalsInput {
  heart_rate: number;
  blood_pressure: string;
  spo2: number;
  temperature: number;
  respiratory_rate?: number | null;
  pain_score?: number | null;
  recorded_at?: string | null;
  client_mutation_id?: string | null;
}

export interface NoteInput {
  note_type: 'nursing' | 'medical' | 'handover' | 'psychiatric';
  body: string;
}

export interface PatchInput {
  version: number;
  full_name?: string;
  age?: number;
  gender?: 'male' | 'female';
  ward?: string;
  bed_number?: string;
  status?: PatientStatus;
  next_of_kin?: string | null;
  contact_phone?: string | null;
  address_lga?: string | null;
  payer?: string | null;
  admission_source?: string | null;
  primary_diagnosis?: string;
  allergies?: string | null;
  medications_summary?: string | null;
  hiv_status?: string;
  genotype?: string;
  pregnancy_status?: string | null;
  mental_health_notes?: string | null;
}

export interface RecordsServiceOptions {
  db: GridVaultDatabase;
  source: RecordSource;
  crypto: FieldCrypto | null;
  clock?: Clock;
  timeZone?: string;
  shiftGraceMinutes?: number;
  /** Present when break-glass is wired: expired grants answer 410, not 403. */
  overrides?: OverrideService;
  abuseRules?: AbuseRuleThresholds;
}

export class RecordsService {
  private readonly db: GridVaultDatabase;
  private readonly source: RecordSource;
  private readonly crypto: FieldCrypto | null;
  private readonly clock: Clock;
  private readonly timeZone: string;
  private readonly overrides: OverrideService | null;
  private readonly abuseRules: AbuseRuleThresholds | undefined;

  constructor(options: RecordsServiceOptions) {
    this.db = options.db;
    this.source = options.source;
    this.crypto = options.crypto;
    this.clock = options.clock ?? systemClock;
    this.timeZone = options.timeZone ?? 'Africa/Lagos';
    this.overrides = options.overrides ?? null;
    this.abuseRules = options.abuseRules;
  }

  private engineOptions(): { clock: Clock; timeZone: string; thresholds?: AbuseRuleThresholds } {
    return { clock: this.clock, timeZone: this.timeZone, thresholds: this.abuseRules };
  }

  private stamp(at: Date = this.clock.now()): string {
    return formatIsoWithOffset(at, this.timeZone);
  }

  private subjectOf(auth: AuthenticatedSubject): PolicySubject {
    return {
      staff_id: auth.user.staff_id,
      role: auth.user.role,
      assigned_ward: auth.user.assigned_ward,
      assigned_shift: auth.user.assigned_shift,
      account_status: auth.user.account_status,
      expires_at: auth.user.expires_at
    };
  }

  /** Active, unexpired grant for this staff+patient, resolved server-side per request. */
  private grantFor(staffId: string, patientId: string, nowMs: number): PolicyGrant | null {
    const rows = emergencyOverridesRepository(this.db).listActiveForStaff(staffId);
    const live = rows.find(
      (row) => row.patient_id === patientId && Date.parse(row.expires_at) > nowMs
    );
    if (live === undefined) {
      return null;
    }
    return {
      grant_id: live.id,
      staff_id: live.staff_id,
      patient_id: live.patient_id,
      readable: GRANT_READABLE,
      writable: GRANT_WRITABLE
    };
  }

  private contextFor(
    auth: AuthenticatedSubject,
    bundle: PatientBundle,
    requested: PatientGroup[],
    nowMs: number
  ): { subject: PolicySubject; resource: PolicyResource; context: PolicyContext } {
    const subject = this.subjectOf(auth);
    const resource: PolicyResource = {
      patient_id: bundle.patient.id,
      hospital_number: bundle.patient.hospital_number,
      ward: bundle.patient.ward
    };
    const grant = this.grantFor(subject.staff_id, bundle.patient.id, nowMs);
    let inIntakeQueue = false;
    let clerkKnownWards: string[] = [];
    if (subject.role === 'clerk') {
      const queue = this.source.intakeQueuePatientIds(auth.user.id);
      inIntakeQueue = queue.includes(bundle.patient.id);
      clerkKnownWards = this.source.clerkKnownWards(auth.user.id, subject.assigned_ward);
    }
    return {
      subject,
      resource,
      context: { duty: auth.duty, nowMs, grant, inIntakeQueue, clerkKnownWards, requested }
    };
  }

  private auditBase(auth: AuthenticatedSubject, bundle: PatientBundle, meta: RequestMeta) {
    return {
      staff_id: auth.user.staff_id,
      staff_role: auth.user.role,
      ward: auth.user.assigned_ward,
      patient_id: bundle.patient.id,
      session_id: auth.sessionId,
      terminal_id: meta.terminal_id ?? null,
      source_ip: meta.source_ip ?? null
    };
  }

  /** Deny path: ACCESS_DENIED + obligations, then 403 (or 404 when not enumerable). */
  private deny(
    decision: Decision,
    auth: AuthenticatedSubject,
    bundle: PatientBundle,
    meta: RequestMeta
  ): never {
    // An expired grant is a distinct state from a denial: the clinician acted
    // lawfully, the hour ran out. AT-210 pins 410 GRANT_EXPIRED here.
    if (this.overrides !== null) {
      const expired = this.overrides.consumeExpiredGrant(auth.user.staff_id, bundle.patient.id, {
        session_id: auth.sessionId,
        terminal_id: meta.terminal_id ?? null,
        source_ip: meta.source_ip ?? null
      });
      if (expired !== null) {
        throw new AppError({
          code: 'GRANT_EXPIRED',
          httpStatus: 410,
          message: 'The emergency grant has expired. A fresh override is required.',
          reasonCode: 'GRANT_EXPIRED'
        });
      }
    }
    const base = this.auditBase(auth, bundle, meta);
    const write = this.db.transaction(() => {
      appendLedgerEntry(
        this.db,
        {
          ...base,
          action: 'ACCESS_DENIED',
          details: {
            decision_id: decision.decision_id,
            reason: decision.reason_code,
            hospital_number: bundle.patient.hospital_number
          },
          timestamp: this.stamp()
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      executeDecisionObligations(
        this.db,
        decision,
        {
          staff_id: auth.user.staff_id,
          staff_role: auth.user.role,
          ward: auth.user.assigned_ward,
          patient_id: bundle.patient.id,
          decision_id: decision.decision_id,
          session_id: auth.sessionId,
          terminal_id: meta.terminal_id ?? null,
          source_ip: meta.source_ip ?? null
        },
        this.engineOptions()
      );
    });
    write();
    if (decision.notEnumerable) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    throw new AppError({
      code: 'ACCESS_DENIED',
      httpStatus: 403,
      message: 'Access denied by policy',
      reasonCode: decision.reason_code,
      details: { decision_id: decision.decision_id },
      canBreakGlass: decision.can_break_glass
    });
  }

  private decryptSensitive(bundle: PatientBundle): Record<string, string | null> {
    const clinical = bundle.clinical;
    if (clinical === null) {
      return { hiv_status: null, genotype: null, pregnancy_status: null, mental_health_notes: null };
    }
    if (this.crypto === null) {
      throw new AppError({
        code: 'ENCRYPTION_UNAVAILABLE',
        httpStatus: 500,
        message: 'Field decryption is unavailable on this node'
      });
    }
    try {
      const patientId = bundle.patient.id;
      return {
        hiv_status: this.crypto.decryptField(patientId, 'hiv_status', clinical.hiv_status_enc),
        genotype: this.crypto.decryptField(patientId, 'genotype', clinical.genotype_enc),
        pregnancy_status:
          clinical.pregnancy_status_enc === null
            ? null
            : this.crypto.decryptField(patientId, 'pregnancy_status', clinical.pregnancy_status_enc),
        mental_health_notes:
          clinical.mental_health_notes_enc === null
            ? null
            : this.crypto.decryptField(patientId, 'mental_health_notes', clinical.mental_health_notes_enc)
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      // AAD/tag mismatch: swapped ciphertext, bit flip or wrong key — a
      // detected integrity failure, never garbage plaintext (AT-117).
      raiseAbuseAlert(
        this.db,
        {
          staff_id: 'SYSTEM',
          patient_id: bundle.patient.id,
          rule_triggered: 'ENCRYPTION_INTEGRITY',
          severity: 'CRITICAL',
          facts: { hospital_number: bundle.patient.hospital_number, columns: 'sensitive' },
          ward: bundle.patient.ward
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      throw new AppError({
        code: 'ENCRYPTION_INTEGRITY_FAILURE',
        httpStatus: 500,
        message: 'The record failed an integrity check and cannot be displayed'
      });
    }
  }

  private patientDto(bundle: PatientBundle, limited: boolean): Record<string, string | number | null> {
    const p = bundle.patient;
    if (!limited) {
      return {
        hospital_number: p.hospital_number,
        full_name: p.full_name,
        age: p.age,
        gender: p.gender,
        ward: p.ward,
        bed_number: p.bed_number,
        admission_date: p.admission_date,
        status: p.status,
        version: p.version
      };
    }
    // Admin/CMO see id + ward only (PRD 6.3); the rest is restricted.
    return {
      hospital_number: p.hospital_number,
      full_name: RESTRICTED,
      age: RESTRICTED,
      gender: RESTRICTED,
      ward: p.ward,
      bed_number: RESTRICTED,
      admission_date: RESTRICTED,
      status: RESTRICTED,
      version: p.version
    };
  }

  private limitedDemoRedactions(): RedactionEntry[] {
    return (['full_name', 'age', 'gender', 'bed_number', 'admission_date', 'status'] as const).map(
      (field) => ({
        field,
        group: 'DEMOGRAPHICS' as FieldGroup,
        reason_code: 'ADMIN_NO_CLINICAL',
        classification: 'NDPA-2023-STANDARD' as const,
        can_break_glass: false
      })
    );
  }

  readDossier(auth: AuthenticatedSubject, hospitalNumber: string, meta: RequestMeta): DossierDto {
    const bundle = this.source.findByHospitalNumber(hospitalNumber);
    if (bundle === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    const nowMs = this.clock.now().getTime();
    const { subject, resource, context } = this.contextFor(auth, bundle, ALL_PATIENT_GROUPS, nowMs);
    const decision = decide(subject, 'read', resource, context);
    if (decision.effect === 'DENY') {
      this.deny(decision, auth, bundle, meta);
    }
    // P6 rule engine: synchronous, before serialization, can block (PRD 9.1).
    // Bulk throttle (RULE-ABUSE-06, 429) and sensitive-sweep block
    // (RULE-ABUSE-07, 403) fire before a single clinical byte is serialized.
    enforceBulkThrottle(this.db, auth.user.staff_id, this.engineOptions());
    enforceSensitiveSweepBlock(
      this.db,
      { staff_id: auth.user.staff_id, under_grant: context.grant !== null },
      this.engineOptions()
    );
    const groups = decision.groups;
    const limitedDemo = subject.role === 'admin' || subject.role === 'cmo';
    const sensitiveAllowed = groups['SENSITIVE']?.allowed === true;
    const sensitive = sensitiveAllowed ? this.decryptSensitive(bundle) : null;

    const dto: DossierDto = {
      data: {
        patient: this.patientDto(bundle, limitedDemo),
        logistics:
          groups['LOGISTICS']?.allowed === true && bundle.logistics !== null
            ? {
                next_of_kin: bundle.logistics.next_of_kin,
                contact_phone: bundle.logistics.contact_phone,
                address_lga: bundle.logistics.address_lga,
                payer: bundle.logistics.payer,
                admission_source: bundle.logistics.admission_source
              }
            : null,
        vitals:
          groups['VITALS']?.allowed === true
            ? { latest: bundle.latestVitals === null ? null : vitalsToDto(bundle.latestVitals) }
            : null,
        clinical:
          groups['CLINICAL']?.allowed === true && bundle.clinical !== null
            ? {
                primary_diagnosis: bundle.clinical.primary_diagnosis,
                allergies: bundle.clinical.allergies,
                medications_summary: bundle.clinical.medications_summary
              }
            : null,
        sensitive,
        mar:
          groups['CLINICAL']?.allowed === true
            ? this.source.marForPatient(bundle.patient.id).map(marToDto)
            : null,
        notes:
          groups['CLINICAL']?.allowed === true
            ? this.source.notesForPatient(bundle.patient.id).map(noteToDto)
            : null
      },
      _meta: buildMeta(decision, ALL_PATIENT_GROUPS)
    };
    if (limitedDemo) {
      dto._meta.redactions.push(...this.limitedDemoRedactions());
    }

    const base = this.auditBase(auth, bundle, meta);
    const allowedGroups = ALL_PATIENT_GROUPS.filter((group) => groups[group]?.allowed === true);
    const write = this.db.transaction(() => {
      appendLedgerEntry(
        this.db,
        {
          ...base,
          action: 'VIEW_RECORD',
          details: {
            decision_id: decision.decision_id,
            reason: decision.reason_code,
            hospital_number: bundle.patient.hospital_number,
            groups: allowedGroups,
            redactions: dto._meta.redactions.length
          },
          timestamp: this.stamp()
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      if (sensitiveAllowed) {
        appendLedgerEntry(
          this.db,
          {
            ...base,
            action: 'VIEW_SENSITIVE',
            details: {
              decision_id: decision.decision_id,
              hospital_number: bundle.patient.hospital_number,
              fields: ['hiv_status', 'genotype', 'pregnancy_status', 'mental_health_notes']
            },
            timestamp: this.stamp()
          },
          { clock: this.clock, timeZone: this.timeZone }
        );
      }
      executeDecisionObligations(
        this.db,
        decision,
        {
          staff_id: auth.user.staff_id,
          staff_role: auth.user.role,
          ward: auth.user.assigned_ward,
          patient_id: bundle.patient.id,
          decision_id: decision.decision_id,
          session_id: auth.sessionId,
          terminal_id: meta.terminal_id ?? null,
          source_ip: meta.source_ip ?? null
        },
        this.engineOptions()
      );
    });
    write();
    // Post-read detectors: bulk enumeration (RULE-ABUSE-06) and sensitive
    // sweep (RULE-ABUSE-07). Fires once per window; grant-scoped reads never
    // count toward the sweep.
    detectBulkEnumeration(
      this.db,
      {
        staff_id: auth.user.staff_id,
        staff_role: auth.user.role,
        ward: auth.user.assigned_ward,
        patient_id: bundle.patient.id,
        session_id: auth.sessionId,
        terminal_id: meta.terminal_id ?? null,
        source_ip: meta.source_ip ?? null
      },
      this.engineOptions()
    );
    detectSensitiveSweep(
      this.db,
      {
        staff_id: auth.user.staff_id,
        user_id: auth.user.id,
        staff_role: auth.user.role,
        ward: auth.user.assigned_ward,
        patient_id: bundle.patient.id,
        under_grant: context.grant !== null,
        session_id: auth.sessionId,
        terminal_id: meta.terminal_id ?? null,
        source_ip: meta.source_ip ?? null
      },
      this.engineOptions()
    );
    return dto;
  }

  readRoster(
    auth: AuthenticatedSubject,
    filters: { ward?: string; status?: string; search?: string },
    meta: RequestMeta
  ): { data: RosterRowDto[]; _meta: { count: number } } {
    const role = auth.user.role;
    let candidates: PatientRow[];
    if (role === 'clerk') {
      // The queue is the clerk's roster; the ward filter narrows it.
      const ids = new Set(this.source.intakeQueuePatientIds(auth.user.id));
      candidates = this.source.listAll().filter((patient) => ids.has(patient.id));
      if (filters.ward !== undefined) {
        candidates = candidates.filter((patient) => patient.ward === filters.ward);
      }
    } else if (filters.ward !== undefined && filters.ward !== auth.user.assigned_ward) {
      candidates = this.source.listByWard(filters.ward);
    } else {
      candidates = this.source.listByWard(auth.user.assigned_ward);
    }
    if (filters.status !== undefined) {
      candidates = candidates.filter((patient) => patient.status === filters.status);
    }
    if (filters.search !== undefined && filters.search.trim().length > 0) {
      const needle = filters.search.trim().toLowerCase();
      candidates = candidates.filter(
        (patient) =>
          patient.full_name.toLowerCase().includes(needle) ||
          patient.hospital_number.toLowerCase().includes(needle)
      );
    }

    const rows: RosterRowDto[] = candidates.map((patient) => {
      const ownWard = patient.ward === auth.user.assigned_ward;
      const inQueue =
        role === 'clerk' &&
        this.source.intakeQueuePatientIds(auth.user.id).includes(patient.id);
      if (ownWard || inQueue || role === 'admin' || role === 'cmo') {
        if (role === 'admin' || role === 'cmo') {
          return {
            hospital_number: patient.hospital_number,
            full_name: RESTRICTED,
            age: null,
            gender: null,
            ward: patient.ward,
            bed_number: null,
            status: null,
            masked: true,
            can_break_glass: role === 'cmo'
          };
        }
        return {
          hospital_number: patient.hospital_number,
          full_name: patient.full_name,
          age: patient.age,
          gender: patient.gender,
          ward: patient.ward,
          bed_number: patient.bed_number,
          status: patient.status,
          masked: false,
          can_break_glass: false
        };
      }
      return {
        hospital_number: patient.hospital_number,
        full_name: maskName(patient.full_name),
        age: null,
        gender: null,
        ward: patient.ward,
        bed_number: null,
        status: null,
        masked: true,
        can_break_glass: true
      };
    });

    appendLedgerEntry(
      this.db,
      {
        staff_id: auth.user.staff_id,
        staff_role: auth.user.role,
        ward: auth.user.assigned_ward,
        patient_id: 'SYSTEM',
        action: 'VIEW_ROSTER',
        details: {
          ward: filters.ward ?? auth.user.assigned_ward,
          count: rows.length
        },
        session_id: auth.sessionId,
        terminal_id: meta.terminal_id ?? null,
        source_ip: meta.source_ip ?? null,
        timestamp: this.stamp()
      },
      { clock: this.clock, timeZone: this.timeZone }
    );
    return { data: rows, _meta: { count: rows.length } };
  }

  readVitals(
    auth: AuthenticatedSubject,
    hospitalNumber: string,
    options: { since?: string; limit?: number },
    meta: RequestMeta
  ): { data: Array<Record<string, string | number | null>>; _meta: SerializedMeta } {
    const bundle = this.source.findByHospitalNumber(hospitalNumber);
    if (bundle === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    const nowMs = this.clock.now().getTime();
    const { subject, resource, context } = this.contextFor(auth, bundle, ['VITALS'], nowMs);
    const decision = decide(subject, 'read', resource, context);
    if (decision.effect === 'DENY' || decision.groups['VITALS']?.allowed !== true) {
      if (decision.effect === 'DENY') {
        this.deny(decision, auth, bundle, meta);
      }
      this.denyField(decision, auth, bundle, meta, 'VITALS');
    }
    let history = this.source.vitalsHistory(bundle.patient.id, options.limit ?? 20);
    if (options.since !== undefined) {
      history = history.filter((row) => row.recorded_at >= (options.since as string));
    }
    return { data: history.map(vitalsToDto), _meta: buildMeta(decision, ['VITALS']) };
  }

  /** Field-level denial on an otherwise allowed request (redaction path helper). */
  private denyField(
    decision: Decision,
    auth: AuthenticatedSubject,
    bundle: PatientBundle,
    meta: RequestMeta,
    group: PatientGroup
  ): never {
    const verdict = decision.groups[group];
    const base = this.auditBase(auth, bundle, meta);
    appendLedgerEntry(
      this.db,
      {
        ...base,
        action: 'ACCESS_DENIED',
        details: {
          decision_id: decision.decision_id,
          reason: verdict?.reason_code ?? decision.reason_code,
          hospital_number: bundle.patient.hospital_number,
          group
        },
        timestamp: this.stamp()
      },
      { clock: this.clock, timeZone: this.timeZone }
    );
    throw new AppError({
      code: 'ACCESS_DENIED',
      httpStatus: 403,
      message: 'Access denied by policy',
      reasonCode: verdict?.reason_code ?? decision.reason_code,
      details: { decision_id: decision.decision_id },
      canBreakGlass: verdict?.can_break_glass ?? false
    });
  }

  writeVitals(
    auth: AuthenticatedSubject,
    hospitalNumber: string,
    input: VitalsInput,
    meta: RequestMeta
  ): { data: Record<string, string | number | null> } {
    assertVitalsInput(input);
    const bundle = this.source.findByHospitalNumber(hospitalNumber);
    if (bundle === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    const nowMs = this.clock.now().getTime();
    const { subject, resource, context } = this.contextFor(auth, bundle, ['VITALS'], nowMs);
    const decision = decide(subject, 'write', resource, context);
    if (decision.effect === 'DENY' || decision.groups['VITALS']?.write_allowed !== true) {
      if (decision.effect === 'DENY') {
        this.deny(decision, auth, bundle, meta);
      }
      this.denyField(decision, auth, bundle, meta, 'VITALS');
    }
    // Same facility-time normalization as the sync path: mixed-offset
    // spellings misorder ORDER BY recorded_at lexicographically.
    let recordedAt = this.stamp();
    if (input.recorded_at !== undefined && input.recorded_at !== null) {
      const ms = Date.parse(input.recorded_at);
      if (Number.isNaN(ms)) {
        throw new AppError({
          code: 'INVALID_BODY',
          httpStatus: 400,
          message: 'recorded_at is not a valid timestamp'
        });
      }
      recordedAt = formatIsoWithOffset(new Date(ms), this.timeZone);
    }
    const id = uuidv7();
    const status = deriveStatus(input);
    const base = this.auditBase(auth, bundle, meta);
    const write = this.db.transaction(() => {
      vitalsRepository(this.db).insert({
        id,
        patient_id: bundle.patient.id,
        heart_rate: input.heart_rate,
        blood_pressure: input.blood_pressure,
        spo2: input.spo2,
        temperature: input.temperature,
        respiratory_rate: input.respiratory_rate ?? null,
        pain_score: input.pain_score ?? null,
        recorded_by: auth.user.staff_id,
        recorded_at: recordedAt,
        ingested_at: this.stamp(),
        is_offline_sync: 0,
        source: 'live',
        device_id: null,
        device_seq: null,
        client_mutation_id: input.client_mutation_id ?? uuidv7(),
        clock_skew_flag: 0
      });
      // Auto-triage recompute; a manual clinician-set status is never
      // overwritten here (migration 003).
      const current = patientsRepository(this.db).findById(bundle.patient.id);
      let statusChanged = false;
      if (current !== undefined && current.status_source === 'auto' && current.status !== status) {
        this.db
          .prepare('UPDATE patients SET status = ?, updated_at = ? WHERE id = ?')
          .run(status, this.stamp(), bundle.patient.id);
        statusChanged = true;
      }
      appendLedgerEntry(
        this.db,
        {
          ...base,
          action: 'RECORD_VITALS',
          details: {
            decision_id: decision.decision_id,
            hospital_number: bundle.patient.hospital_number,
            vitals_id: id,
            status,
            status_changed: statusChanged
          },
          timestamp: this.stamp()
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    write();
    const row = this.db.prepare('SELECT * FROM vitals WHERE id = ?').get(id) as VitalsRow;
    const patient = patientsRepository(this.db).findById(bundle.patient.id);
    return {
      data: {
        ...vitalsToDto(row),
        patient_status: patient?.status ?? status,
        triage_note: 'Auto-triage flag · not a clinical diagnosis'
      }
    };
  }

  appendNote(
    auth: AuthenticatedSubject,
    hospitalNumber: string,
    input: NoteInput,
    meta: RequestMeta
  ): { data: Record<string, string | null> } {
    const bundle = this.source.findByHospitalNumber(hospitalNumber);
    if (bundle === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    const nowMs = this.clock.now().getTime();
    const { subject, resource, context } = this.contextFor(auth, bundle, ['CLINICAL'], nowMs);
    const decision = decide(subject, 'append', resource, context);
    if (decision.effect === 'DENY' || decision.groups['CLINICAL']?.write_allowed !== true) {
      if (decision.effect === 'DENY') {
        this.deny(decision, auth, bundle, meta);
      }
      this.denyField(decision, auth, bundle, meta, 'CLINICAL');
    }
    const id = uuidv7();
    const base = this.auditBase(auth, bundle, meta);
    const write = this.db.transaction(() => {
      clinicalNotesRepository(this.db).insert({
        id,
        patient_id: bundle.patient.id,
        author_staff_id: auth.user.staff_id,
        note_type: input.note_type,
        body: input.body,
        written_at: this.stamp(),
        ingested_at: this.stamp(),
        source: 'live',
        client_mutation_id: uuidv7()
      });
      appendLedgerEntry(
        this.db,
        {
          ...base,
          action: 'APPEND_NOTE',
          details: {
            decision_id: decision.decision_id,
            hospital_number: bundle.patient.hospital_number,
            note_id: id,
            note_type: input.note_type
          },
          timestamp: this.stamp()
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    write();
    return { data: { id, patient_id: bundle.patient.id } };
  }

  readMar(
    auth: AuthenticatedSubject,
    hospitalNumber: string,
    meta: RequestMeta
  ): { data: Array<Record<string, string | null>>; _meta: SerializedMeta } {
    const bundle = this.source.findByHospitalNumber(hospitalNumber);
    if (bundle === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    const nowMs = this.clock.now().getTime();
    const { subject, resource, context } = this.contextFor(auth, bundle, ['CLINICAL'], nowMs);
    const decision = decide(subject, 'read', resource, context);
    if (decision.effect === 'DENY' || decision.groups['CLINICAL']?.allowed !== true) {
      if (decision.effect === 'DENY') {
        this.deny(decision, auth, bundle, meta);
      }
      this.denyField(decision, auth, bundle, meta, 'CLINICAL');
    }
    return { data: this.source.marForPatient(bundle.patient.id).map(marToDto), _meta: buildMeta(decision, ['CLINICAL']) };
  }

  signMar(
    auth: AuthenticatedSubject,
    hospitalNumber: string,
    entryId: string,
    meta: RequestMeta
  ): { data: Record<string, string | null> } {
    const bundle = this.source.findByHospitalNumber(hospitalNumber);
    if (bundle === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    const nowMs = this.clock.now().getTime();
    const { subject, resource, context } = this.contextFor(auth, bundle, ['CLINICAL'], nowMs);
    // Sign-off is an attestation append: doctors and nurses only.
    const decision = decide(subject, 'append', resource, context);
    if (decision.effect === 'DENY' || decision.groups['CLINICAL']?.write_allowed !== true) {
      if (decision.effect === 'DENY') {
        this.deny(decision, auth, bundle, meta);
      }
      this.denyField(decision, auth, bundle, meta, 'CLINICAL');
    }
    const entry = this.db
      .prepare('SELECT * FROM mar_entries WHERE id = ? AND patient_id = ?')
      .get(entryId, bundle.patient.id) as MarEntryRow | undefined;
    if (entry === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'MAR entry not found' });
    }
    if (entry.status !== 'scheduled') {
      throw new AppError({
        code: 'INVALID_STATE',
        httpStatus: 409,
        message: 'Only scheduled entries can be signed'
      });
    }
    const base = this.auditBase(auth, bundle, meta);
    const write = this.db.transaction(() => {
      this.db
        .prepare('UPDATE mar_entries SET status = ?, administered_at = ?, administered_by = ? WHERE id = ?')
        .run('given', this.stamp(), auth.user.staff_id, entryId);
      appendLedgerEntry(
        this.db,
        {
          ...base,
          action: 'SIGN_MAR',
          details: {
            decision_id: decision.decision_id,
            hospital_number: bundle.patient.hospital_number,
            entry_id: entryId,
            medication: entry.medication
          },
          timestamp: this.stamp()
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    write();
    return { data: { id: entryId, status: 'given', administered_by: auth.user.staff_id } };
  }

  patchPatient(
    auth: AuthenticatedSubject,
    hospitalNumber: string,
    patch: PatchInput,
    meta: RequestMeta
  ): { data: Record<string, string | number | null> } {
    const bundle = this.source.findByHospitalNumber(hospitalNumber);
    if (bundle === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    const requested = requestedGroupsForPatch(patch);
    const nowMs = this.clock.now().getTime();
    const { subject, resource, context } = this.contextFor(auth, bundle, requested, nowMs);
    const decision = decide(subject, 'write', resource, context);
    if (decision.effect === 'DENY') {
      this.deny(decision, auth, bundle, meta);
    }
    for (const group of requested) {
      if (decision.groups[group]?.write_allowed !== true) {
        this.denyField(decision, auth, bundle, meta, group);
      }
    }
    const current = patientsRepository(this.db).findById(bundle.patient.id);
    if (current === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }
    if (patch.version !== current.version) {
      // Optimistic-concurrency conflict: no silent overwrite. A
      // charge-nurse reconciliation task is queued in the outbox.
      notificationOutboxRepository(this.db).insert({
        id: uuidv7(),
        channel: 'local',
        recipient: 'charge_nurse',
        subject: 'Demographic version conflict',
        body: `Patch for ${bundle.patient.hospital_number} based on version ${patch.version}; current version ${current.version}.`,
        priority: 'HIGH',
        related_type: 'patient',
        related_id: bundle.patient.hospital_number,
        status: 'PENDING',
        attempts: 0,
        last_error: null,
        created_at: this.stamp(),
        dispatched_at: null,
        delivered_at: null
      });
      throw new AppError({
        code: 'VERSION_CONFLICT',
        httpStatus: 409,
        message: 'The record changed since you loaded it',
        details: { base_version: patch.version, current_version: current.version }
      });
    }

    const touched: string[] = [];
    const base = this.auditBase(auth, bundle, meta);
    const write = this.db.transaction(() => {
      // Static full-row update: every value is a bound parameter and the
      // statement text is fixed, so the no-template-literal-sql rule holds
      // by construction. `touched` still records only changed fields.
      const next = {
        full_name: patch.full_name ?? current.full_name,
        age: patch.age ?? current.age,
        gender: patch.gender ?? current.gender,
        ward: patch.ward ?? current.ward,
        bed_number: patch.bed_number ?? current.bed_number
      };
      for (const [key, value] of Object.entries({
        full_name: patch.full_name,
        age: patch.age,
        gender: patch.gender,
        ward: patch.ward,
        bed_number: patch.bed_number
      })) {
        if (value !== undefined) {
          touched.push(key);
        }
      }
      if (patch.ward !== undefined || patch.bed_number !== undefined) {
        const ward = patch.ward ?? current.ward;
        const bed = patch.bed_number ?? current.bed_number;
        const clash = this.db
          .prepare(
            "SELECT id FROM patients WHERE ward = ? AND bed_number = ? AND id != ? AND status != 'discharged'"
          )
          .get(ward, bed, current.id) as { id: string } | undefined;
        if (clash !== undefined) {
          throw new AppError({
            code: 'BED_OCCUPIED',
            httpStatus: 409,
            message: 'The bed is already occupied'
          });
        }
      }
      let manualStatus = false;
      const nextStatus = patch.status ?? current.status;
      const nextSource = patch.status !== undefined ? 'manual' : current.status_source;
      const nextSetBy = patch.status !== undefined ? auth.user.staff_id : current.status_set_by;
      if (patch.status !== undefined) {
        touched.push('status');
        manualStatus = true;
      }
      this.db
        .prepare(
          'UPDATE patients SET full_name = ?, age = ?, gender = ?, ward = ?, bed_number = ?, ' +
            'status = ?, status_source = ?, status_set_by = ?, version = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          next.full_name,
          next.age,
          next.gender,
          next.ward,
          next.bed_number,
          nextStatus,
          nextSource,
          nextSetBy,
          current.version + 1,
          this.stamp(),
          current.id
        );
      if (patch.next_of_kin !== undefined || patch.contact_phone !== undefined || patch.address_lga !== undefined || patch.payer !== undefined || patch.admission_source !== undefined) {
        const existing =
          patientLogisticsRepository(this.db).findByPatientId(bundle.patient.id);
        if (existing === undefined) {
          patientLogisticsRepository(this.db).insert({
            patient_id: bundle.patient.id,
            next_of_kin: patch.next_of_kin ?? null,
            contact_phone: patch.contact_phone ?? null,
            address_lga: patch.address_lga ?? null,
            payer: patch.payer ?? null,
            admission_source: patch.admission_source ?? null,
            updated_at: this.stamp()
          });
        } else {
          this.db
            .prepare(
              'UPDATE patient_logistics SET next_of_kin = ?, contact_phone = ?, address_lga = ?, payer = ?, admission_source = ?, updated_at = ? WHERE patient_id = ?'
            )
            .run(
              patch.next_of_kin ?? existing.next_of_kin,
              patch.contact_phone ?? existing.contact_phone,
              patch.address_lga ?? existing.address_lga,
              patch.payer ?? existing.payer,
              patch.admission_source ?? existing.admission_source,
              this.stamp(),
              bundle.patient.id
            );
        }
        for (const [key, value] of Object.entries({
          next_of_kin: patch.next_of_kin,
          contact_phone: patch.contact_phone,
          address_lga: patch.address_lga,
          payer: patch.payer,
          admission_source: patch.admission_source
        })) {
          if (value !== undefined) {
            touched.push(key);
          }
        }
      }
      const clinical = clinicalDataRepository(this.db).findByPatientId(bundle.patient.id);
      if (
        (patch.hiv_status !== undefined ||
          patch.genotype !== undefined ||
          patch.pregnancy_status !== undefined ||
          patch.mental_health_notes !== undefined) &&
        this.crypto === null
      ) {
        throw new AppError({
          code: 'ENCRYPTION_UNAVAILABLE',
          httpStatus: 500,
          message: 'Field decryption is unavailable on this node'
        });
      }
      if (clinical !== undefined) {
        // AAD column names match the seed/store convention (hiv_status,
        // genotype, ...); the storage columns carry the _enc suffix.
        const encrypt = (column: 'hiv_status' | 'genotype' | 'pregnancy_status' | 'mental_health_notes', value: string | undefined, field: string): string | null => {
          if (value === undefined || this.crypto === null) {
            return null;
          }
          touched.push(field);
          return this.crypto.encryptField(bundle.patient.id, column, value, clinical.key_version);
        };
        // Static full-row update: fixed statement text, bound values.
        this.db
          .prepare(
            'UPDATE clinical_data SET primary_diagnosis = ?, allergies = ?, medications_summary = ?, ' +
              'hiv_status_enc = ?, genotype_enc = ?, pregnancy_status_enc = ?, mental_health_notes_enc = ?, ' +
              'updated_at = ? WHERE patient_id = ?'
          )
          .run(
            patch.primary_diagnosis ?? clinical.primary_diagnosis,
            patch.allergies ?? clinical.allergies,
            patch.medications_summary ?? clinical.medications_summary,
            encrypt('hiv_status', patch.hiv_status, 'hiv_status') ?? clinical.hiv_status_enc,
            encrypt('genotype', patch.genotype, 'genotype') ?? clinical.genotype_enc,
            encrypt('pregnancy_status', patch.pregnancy_status ?? undefined, 'pregnancy_status') ??
              clinical.pregnancy_status_enc,
            encrypt('mental_health_notes', patch.mental_health_notes ?? undefined, 'mental_health_notes') ??
              clinical.mental_health_notes_enc,
            this.stamp(),
            clinical.patient_id
          );
        for (const [key, value] of Object.entries({
          primary_diagnosis: patch.primary_diagnosis,
          allergies: patch.allergies,
          medications_summary: patch.medications_summary
        })) {
          if (value !== undefined) {
            touched.push(key);
          }
        }
      }
      appendLedgerEntry(
        this.db,
        {
          ...base,
          action: 'UPDATE_CLINICAL',
          details: {
            decision_id: decision.decision_id,
            hospital_number: bundle.patient.hospital_number,
            fields: touched,
            version: current.version + 1,
            manual_status: manualStatus,
            author: auth.user.staff_id
          },
          timestamp: this.stamp()
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    write();
    const updated = patientsRepository(this.db).findById(bundle.patient.id);
    return {
      data: {
        hospital_number: bundle.patient.hospital_number,
        version: updated?.version ?? current.version + 1,
        updated_fields: touched.join(',')
      }
    };
  }

  handover(
    auth: AuthenticatedSubject,
    ward: string,
    meta: RequestMeta
  ): { data: Record<string, unknown> } {
    if (auth.user.role !== 'doctor' && auth.user.role !== 'nurse') {
      const reason = auth.user.role === 'clerk' ? 'CLERK_NO_CLINICAL' : 'ADMIN_NO_CLINICAL';
      throw new AppError({
        code: 'ACCESS_DENIED',
        httpStatus: 403,
        message: 'Access denied by policy',
        reasonCode: reason
      });
    }
    if (ward !== auth.user.assigned_ward) {
      throw new AppError({
        code: 'ACCESS_DENIED',
        httpStatus: 403,
        message: 'Access denied by policy',
        reasonCode: 'WARD_MISMATCH',
        canBreakGlass: true
      });
    }
    const patients = this.source.listByWard(ward);
    const sheets = [];
    for (const patient of patients) {
      const bundle = this.source.findByHospitalNumber(patient.hospital_number);
      if (bundle === undefined) {
        continue;
      }
      const nowMs = this.clock.now().getTime();
      const { subject, resource, context } = this.contextFor(auth, bundle, ['CLINICAL', 'VITALS'], nowMs);
      const decision = decide(subject, 'read', resource, context);
      if (decision.effect === 'DENY' || decision.groups['CLINICAL']?.allowed !== true) {
        continue;
      }
      const latest = bundle.latestVitals;
      sheets.push({
        hospital_number: patient.hospital_number,
        full_name: patient.full_name,
        age: patient.age,
        gender: patient.gender,
        bed_number: patient.bed_number,
        status: patient.status,
        sbar: {
          situation: `${patient.status}: ${bundle.clinical?.primary_diagnosis ?? 'no diagnosis recorded'}`,
          background: `${patient.age}yo ${patient.gender}, admitted ${patient.admission_date}`,
          assessment:
            latest === null
              ? 'no vitals recorded'
              : `HR ${latest.heart_rate}, BP ${latest.blood_pressure}, SpO2 ${latest.spo2}, T ${latest.temperature}`,
          recommendation:
            patient.status === 'critical'
              ? 'Escalate to the attending doctor immediately'
              : 'Continue routine monitoring'
        }
      });
    }
    const watermark =
      `PRINTED BY ${auth.user.full_name.toUpperCase()} (${auth.user.staff_id}) · ` +
      `${meta.terminal_id ?? 'unknown-terminal'} · ${this.stamp()} WAT · CONFIDENTIAL`;
    appendLedgerEntry(
      this.db,
      {
        staff_id: auth.user.staff_id,
        staff_role: auth.user.role,
        ward: auth.user.assigned_ward,
        patient_id: 'SYSTEM',
        action: 'EXPORT_HANDOVER',
        details: { ward, count: sheets.length, watermark: true },
        session_id: auth.sessionId,
        terminal_id: meta.terminal_id ?? null,
        source_ip: meta.source_ip ?? null,
        timestamp: this.stamp()
      },
      { clock: this.clock, timeZone: this.timeZone }
    );
    return { data: { ward, generated_at: this.stamp(), watermark, patients: sheets } };
  }

  admissionQueue(auth: AuthenticatedSubject): { data: Array<Record<string, string | number | null>> } {
    if (auth.user.role !== 'clerk' && auth.user.role !== 'admin' && auth.user.role !== 'cmo') {
      throw new AppError({
        code: 'ACCESS_DENIED',
        httpStatus: 403,
        message: 'Access denied by policy',
        reasonCode: 'QUEUE_ACCESS_DENIED'
      });
    }
    const rows =
      auth.user.role === 'clerk'
        ? this.source.intakeQueuePatientIds(auth.user.id)
        : this.source.listAll().map((patient) => patient.id);
    const data = [];
    for (const patientId of rows) {
      const row = this.db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as
        | PatientRow
        | undefined;
      if (row === undefined) {
        continue;
      }
      if (auth.user.role === 'clerk') {
        data.push({
          hospital_number: row.hospital_number,
          full_name: row.full_name,
          ward: row.ward,
          bed_number: row.bed_number,
          status: row.status
        });
      } else {
        data.push({ hospital_number: row.hospital_number, ward: row.ward });
      }
    }
    return { data };
  }

  ledgerLogs(
    auth: AuthenticatedSubject,
    filters: { limit?: number; staff_id?: string; patient_id?: string; action?: string }
  ): { data: Array<Record<string, unknown>>; _meta: { count: number } } {
    const access = decideLedgerAccess(this.subjectOf(auth));
    if (access.effect === 'DENY') {
      throw new AppError({
        code: 'ACCESS_DENIED',
        httpStatus: 403,
        message: 'Access denied by policy',
        reasonCode: access.reason_code
      });
    }
    const limit = Math.min(filters.limit ?? 50, 200);
    // Static statement: optional filters are NULL-or-equal predicates with
    // bound parameters, so the SQL text never varies.
    const rows = this.db
      .prepare(
        'SELECT * FROM audit_logs ' +
          'WHERE (? IS NULL OR ward = ?) AND (? IS NULL OR staff_id = ?) AND ' +
          '(? IS NULL OR patient_id = ?) AND (? IS NULL OR action = ?) ' +
          'ORDER BY log_index DESC LIMIT ?'
      )
      .all(
        access.wardScope,
        access.wardScope,
        filters.staff_id ?? null,
        filters.staff_id ?? null,
        filters.patient_id ?? null,
        filters.patient_id ?? null,
        filters.action ?? null,
        filters.action ?? null,
        limit
      ) as Array<Record<string, unknown>>;
    return { data: rows, _meta: { count: rows.length } };
  }
}

function requestedGroupsForPatch(patch: PatchInput): PatientGroup[] {
  const groups = new Set<PatientGroup>();
  if (
    patch.full_name !== undefined ||
    patch.age !== undefined ||
    patch.gender !== undefined ||
    patch.ward !== undefined ||
    patch.bed_number !== undefined ||
    patch.status !== undefined
  ) {
    groups.add('DEMOGRAPHICS');
  }
  if (
    patch.next_of_kin !== undefined ||
    patch.contact_phone !== undefined ||
    patch.address_lga !== undefined ||
    patch.payer !== undefined ||
    patch.admission_source !== undefined
  ) {
    groups.add('LOGISTICS');
  }
  if (
    patch.primary_diagnosis !== undefined ||
    patch.allergies !== undefined ||
    patch.medications_summary !== undefined
  ) {
    groups.add('CLINICAL');
  }
  if (
    patch.hiv_status !== undefined ||
    patch.genotype !== undefined ||
    patch.pregnancy_status !== undefined ||
    patch.mental_health_notes !== undefined
  ) {
    groups.add('SENSITIVE');
  }
  return [...groups];
}

function assertVitalsInput(input: VitalsInput): void {
  const problems: string[] = [];
  if (!Number.isInteger(input.heart_rate) || input.heart_rate < 20 || input.heart_rate > 250) {
    problems.push('heart_rate');
  }
  if (parseBloodPressure(input.blood_pressure) === null) {
    problems.push('blood_pressure');
  }
  if (!Number.isInteger(input.spo2) || input.spo2 < 50 || input.spo2 > 100) {
    problems.push('spo2');
  }
  if (typeof input.temperature !== 'number' || input.temperature < 30.0 || input.temperature > 45.0) {
    problems.push('temperature');
  }
  if (
    input.respiratory_rate !== undefined &&
    input.respiratory_rate !== null &&
    (!Number.isInteger(input.respiratory_rate) || input.respiratory_rate < 0 || input.respiratory_rate > 80)
  ) {
    problems.push('respiratory_rate');
  }
  if (
    input.pain_score !== undefined &&
    input.pain_score !== null &&
    (!Number.isInteger(input.pain_score) || input.pain_score < 0 || input.pain_score > 10)
  ) {
    problems.push('pain_score');
  }
  if (problems.length > 0) {
    // Field NAMES only — the offending values might be PHI-adjacent input.
    throw new AppError({
      code: 'INVALID_VITALS',
      httpStatus: 422,
      message: 'The vitals are outside clinically valid ranges',
      details: { fields: problems.join(',') }
    });
  }
}

function vitalsToDto(row: VitalsRow): Record<string, string | number | null> {
  return {
    id: row.id,
    heart_rate: row.heart_rate,
    blood_pressure: row.blood_pressure,
    spo2: row.spo2,
    temperature: row.temperature,
    respiratory_rate: row.respiratory_rate,
    pain_score: row.pain_score,
    recorded_by: row.recorded_by,
    recorded_at: row.recorded_at,
    source: row.source
  };
}

function marToDto(row: MarEntryRow): Record<string, string | null> {
  return {
    id: row.id,
    medication: row.medication,
    dose: row.dose,
    route: row.route,
    scheduled_at: row.scheduled_at,
    administered_at: row.administered_at,
    administered_by: row.administered_by,
    status: row.status
  };
}

function noteToDto(row: { id: string; author_staff_id: string; note_type: string; body: string; written_at: string }): Record<string, string | null> {
  return {
    id: row.id,
    author_staff_id: row.author_staff_id,
    note_type: row.note_type,
    body: row.body,
    written_at: row.written_at
  };
}
