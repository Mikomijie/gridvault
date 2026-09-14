// GridVault emergency clinical override (PRD 7, "break-glass").
//
// Immediate (no approval step), never coverable (grant row + chained audit
// entries + CMO/charge-nurse outbox dispatch + UI banner), scoped (one
// staff, one patient, 60 minutes, revocable), honest (the modal states the
// consequence first — enforced client-side; the server states it again in
// the REQUESTED entry).
//
// PIN entry is exempt from IP lockout (a ward terminal must not be bricked
// by another user's typos) but never from per-staff PIN throttling: 3 wrong
// PINs throttle override attempts for 15 minutes.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { GridVaultDatabase } from '../db/connection.js';
import { formatIsoWithOffset, systemClock, type Clock } from '../clock.js';
import { appendLedgerEntry } from '../ledger/append.js';
import { emergencyOverridesRepository, type EmergencyOverrideRow } from '../db/repositories/overrides.js';
import { patientsRepository } from '../db/repositories/patients.js';
import { AppError } from '../http/errors.js';
import { raiseAbuseAlert } from '../abuse/alerts.js';
import { verifySecret } from '../auth/password.js';
import { queueOutbox, type NotifyDriver, LocalLogDriver } from '../notify/outbox.js';
import type { AuthenticatedSubject, RequestMeta } from '../auth/service.js';

const justificationsSchema = z.object({
  codes: z.array(z.string().min(1)).min(1),
  other_min_notes_length: z.number().int().min(1).default(20)
});

function defaultJustificationsPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config', 'justifications.json');
}

/**
 * Load and validate the justification-code configuration. A bad file fails
 * startup loudly rather than running with emergency access ungoverned.
 */
export function loadJustifications(filePath: string = defaultJustificationsPath()): {
  codes: string[];
  otherMinNotes: number;
} {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`justifications config unreadable: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`justifications config is not valid JSON: ${filePath}`);
  }
  const result = justificationsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `justifications config invalid (${filePath}): ${result.error.issues.map((issue) => issue.message).join('; ')}`
    );
  }
  return { codes: result.data.codes, otherMinNotes: result.data.other_min_notes_length };
}

/** Per-staff PIN failure throttle for override attempts (in-memory, one node). */
export class OverridePinThrottle {
  private readonly attempts = new Map<string, { count: number; blockedUntilMs: number }>();
  private readonly maxFailures: number;
  private readonly blockMs: number;

  constructor(maxFailures = 3, blockMs: number = 15 * 60 * 1000) {
    this.maxFailures = maxFailures;
    this.blockMs = blockMs;
  }

  isBlocked(staffId: string, nowMs: number): boolean {
    const record = this.attempts.get(staffId);
    if (record === undefined) {
      return false;
    }
    if (nowMs >= record.blockedUntilMs && record.blockedUntilMs > 0) {
      this.attempts.delete(staffId);
      return false;
    }
    return record.blockedUntilMs > nowMs;
  }

  recordFailure(staffId: string, nowMs: number): void {
    const record = this.attempts.get(staffId);
    const count = (record?.count ?? 0) + 1;
    this.attempts.set(staffId, {
      count,
      blockedUntilMs: count >= this.maxFailures ? nowMs + this.blockMs : 0
    });
  }

  reset(staffId: string): void {
    this.attempts.delete(staffId);
  }
}

export interface OverrideExecuteInput {
  patient_id: string;
  justification_code: string;
  justification_notes?: string | null;
  pin: string;
}

export interface OverrideExecuteResult {
  override_id: string;
  audit_index: number;
  expires_at: string;
  scope: { patient_id: string; readable: string[]; writable: string[] };
  dispatch: { cmo: string; charge_nurse: string };
}

export interface OverrideServiceOptions {
  db: GridVaultDatabase;
  clock?: Clock;
  timeZone?: string;
  ttlMinutes?: number;
  justifications?: string[];
  otherMinNotes?: number;
  pinThrottle?: OverridePinThrottle;
  driver?: NotifyDriver;
}

const GRANT_READABLE = ['DEMOGRAPHICS', 'LOGISTICS', 'VITALS', 'CLINICAL', 'SENSITIVE'];
const GRANT_WRITABLE = ['VITALS', 'CLINICAL'];
const FREQUENCY_WINDOW_MINUTES = 60;

export class OverrideService {
  private readonly db: GridVaultDatabase;
  private readonly clock: Clock;
  private readonly timeZone: string;
  private readonly ttlMinutes: number;
  private readonly justifications: string[];
  private readonly otherMinNotes: number;
  private readonly pinThrottle: OverridePinThrottle;
  private readonly driver: NotifyDriver;

  constructor(options: OverrideServiceOptions) {
    this.db = options.db;
    this.clock = options.clock ?? systemClock;
    this.timeZone = options.timeZone ?? 'Africa/Lagos';
    this.ttlMinutes = options.ttlMinutes ?? 60;
    this.justifications = options.justifications ?? loadJustifications().codes;
    this.otherMinNotes = options.otherMinNotes ?? 20;
    this.pinThrottle = options.pinThrottle ?? new OverridePinThrottle();
    this.driver = options.driver ?? new LocalLogDriver();
    void this.driver;
  }

  private stamp(at: Date = this.clock.now()): string {
    return formatIsoWithOffset(at, this.timeZone);
  }

  private cmoRecipient(): string {
    const row = this.db.prepare("SELECT staff_id FROM users WHERE role = 'cmo' LIMIT 1").get() as
      | { staff_id: string }
      | undefined;
    return row?.staff_id ?? 'role:cmo';
  }

  async execute(
    auth: AuthenticatedSubject,
    input: OverrideExecuteInput,
    meta: RequestMeta
  ): Promise<OverrideExecuteResult> {
    const now = this.clock.now();
    const at = this.stamp(now);
    const terminalId = meta.terminal_id ?? null;
    const sourceIp = meta.source_ip ?? null;

    if (!this.justifications.includes(input.justification_code)) {
      throw new AppError({
        code: 'INVALID_JUSTIFICATION',
        httpStatus: 400,
        message: 'The justification code is not recognised'
      });
    }
    if (
      input.justification_code === 'OTHER' &&
      (input.justification_notes ?? '').trim().length < this.otherMinNotes
    ) {
      throw new AppError({
        code: 'INVALID_JUSTIFICATION',
        httpStatus: 400,
        message: `OTHER requires at least ${this.otherMinNotes} characters of notes`
      });
    }
    if (this.pinThrottle.isBlocked(auth.user.staff_id, now.getTime())) {
      throw new AppError({
        code: 'PIN_THROTTLED',
        httpStatus: 429,
        message: 'Too many wrong PINs. Override attempts are temporarily throttled.'
      });
    }

    const patient = patientsRepository(this.db).findByHospitalNumber(input.patient_id);
    if (patient === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Patient not found' });
    }

    const pinOk = await verifySecret(auth.user.pin_hash, input.pin);
    if (!pinOk) {
      this.pinThrottle.recordFailure(auth.user.staff_id, now.getTime());
      appendLedgerEntry(
        this.db,
        {
          staff_id: auth.user.staff_id,
          staff_role: auth.user.role,
          ward: patient.ward,
          patient_id: patient.id,
          action: 'EMERGENCY_OVERRIDE_REQUESTED',
          details: {
            granted: false,
            reason: 'bad_pin',
            justification_code: input.justification_code,
            hospital_number: patient.hospital_number
          },
          session_id: auth.sessionId,
          terminal_id: terminalId,
          source_ip: sourceIp,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      throw new AppError({ code: 'INVALID_PIN', httpStatus: 401, message: 'Incorrect PIN' });
    }
    this.pinThrottle.reset(auth.user.staff_id);

    const overrideId = uuidv7();
    const expiresAt = this.stamp(new Date(now.getTime() + this.ttlMinutes * 60000));
    const cmo = this.cmoRecipient();
    const chargeNurse = `charge_nurse:${patient.ward}`;
    // Frequency spike (RULE-ABUSE-04): care first — the grant succeeds and
    // the alert plus escalated dispatch ride along.
    const windowStart = new Date(now.getTime() - FREQUENCY_WINDOW_MINUTES * 60000).toISOString();
    const recentRow = this.db
      .prepare('SELECT COUNT(*) AS n FROM emergency_overrides WHERE staff_id = ? AND granted_at > ?')
      .get(auth.user.staff_id, windowStart) as { n: number };
    const frequencySpike = recentRow.n >= 1;

    const run = this.db.transaction(() => {
      appendLedgerEntry(
        this.db,
        {
          staff_id: auth.user.staff_id,
          staff_role: auth.user.role,
          ward: patient.ward,
          patient_id: patient.id,
          action: 'EMERGENCY_OVERRIDE_REQUESTED',
          details: {
            granted: true,
            justification_code: input.justification_code,
            hospital_number: patient.hospital_number
          },
          session_id: auth.sessionId,
          terminal_id: terminalId,
          source_ip: sourceIp,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      const granted = appendLedgerEntry(
        this.db,
        {
          staff_id: auth.user.staff_id,
          staff_role: auth.user.role,
          ward: patient.ward,
          patient_id: patient.id,
          action: 'EMERGENCY_OVERRIDE_GRANTED',
          details: {
            override_id: overrideId,
            justification_code: input.justification_code,
            hospital_number: patient.hospital_number,
            expires_at: expiresAt,
            scope: GRANT_WRITABLE
          },
          session_id: auth.sessionId,
          terminal_id: terminalId,
          source_ip: sourceIp,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      emergencyOverridesRepository(this.db).insert({
        id: overrideId,
        audit_log_index: granted.log_index,
        staff_id: auth.user.staff_id,
        patient_id: patient.id,
        ward: patient.ward,
        justification_code: input.justification_code,
        justification_notes: input.justification_notes ?? null,
        state: 'ACTIVE',
        granted_at: at,
        expires_at: expiresAt,
        closed_at: null,
        revoked_by: null,
        revoked_reason: null,
        review_state: 'PENDING_REVIEW',
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null,
        created_offline: 0,
        created_at: at
      });
      queueOutbox(
        this.db,
        {
          channel: 'local',
          recipient: cmo,
          subject: 'Emergency override granted',
          body:
            `Override ${overrideId} by ${auth.user.staff_id} on ${patient.hospital_number} ` +
            `(${input.justification_code}). Review required.${frequencySpike ? ' FREQUENCY SPIKE: second grant within 60 minutes.' : ''}`,
          priority: 'HIGH',
          related_type: 'override',
          related_id: overrideId
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      queueOutbox(
        this.db,
        {
          channel: 'local',
          recipient: chargeNurse,
          subject: 'Emergency override granted',
          body:
            `Override ${overrideId} by ${auth.user.staff_id} on ${patient.hospital_number} ` +
            `(${input.justification_code}).`,
          priority: 'HIGH',
          related_type: 'override',
          related_id: overrideId
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
      if (frequencySpike) {
        raiseAbuseAlert(
          this.db,
          {
            staff_id: auth.user.staff_id,
            patient_id: patient.id,
            rule_triggered: 'RULE-ABUSE-04',
            severity: 'CRITICAL',
            facts: { override_id: overrideId, window_minutes: FREQUENCY_WINDOW_MINUTES },
            decision_id: null,
            session_id: auth.sessionId,
            terminal_id: terminalId,
            source_ip: sourceIp,
            staff_role: auth.user.role,
            ward: patient.ward
          },
          { clock: this.clock, timeZone: this.timeZone }
        );
      }
      return granted.log_index;
    });
    const auditIndex = run();

    return {
      override_id: overrideId,
      audit_index: auditIndex,
      expires_at: expiresAt,
      scope: { patient_id: patient.id, readable: GRANT_READABLE, writable: GRANT_WRITABLE },
      dispatch: { cmo, charge_nurse: chargeNurse }
    };
  }

  /** Clinician ends their own access early. */
  close(auth: AuthenticatedSubject, overrideId: string, meta: RequestMeta): void {
    const row = emergencyOverridesRepository(this.db).findById(overrideId);
    if (row === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Override not found' });
    }
    if (row.staff_id !== auth.user.staff_id) {
      throw new AppError({
        code: 'ACCESS_DENIED',
        httpStatus: 403,
        message: 'Only the granting clinician can end this access'
      });
    }
    if (row.state !== 'ACTIVE') {
      throw new AppError({
        code: 'INVALID_STATE',
        httpStatus: 409,
        message: `The override is already ${row.state}`
      });
    }
    const at = this.stamp();
    const run = this.db.transaction(() => {
      this.db
        .prepare("UPDATE emergency_overrides SET state = 'CLOSED', closed_at = ? WHERE id = ?")
        .run(at, overrideId);
      appendLedgerEntry(
        this.db,
        {
          staff_id: auth.user.staff_id,
          staff_role: auth.user.role,
          ward: row.ward,
          patient_id: row.patient_id,
          action: 'EMERGENCY_OVERRIDE_CLOSED',
          details: { override_id: overrideId, reason: 'clinician_closed' },
          session_id: auth.sessionId,
          terminal_id: meta.terminal_id ?? null,
          source_ip: meta.source_ip ?? null,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    run();
  }

  /** CMO/admin revoke: effective on the clinician's very next request. */
  revoke(
    auth: AuthenticatedSubject,
    overrideId: string,
    reason: string | undefined,
    meta: RequestMeta
  ): void {
    if (auth.user.role !== 'cmo' && auth.user.role !== 'admin') {
      throw new AppError({
        code: 'ACCESS_DENIED',
        httpStatus: 403,
        message: 'Only the CMO or an administrator can revoke a grant'
      });
    }
    const row = emergencyOverridesRepository(this.db).findById(overrideId);
    if (row === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Override not found' });
    }
    if (row.state !== 'ACTIVE') {
      throw new AppError({
        code: 'INVALID_STATE',
        httpStatus: 409,
        message: `The override is already ${row.state}`
      });
    }
    const at = this.stamp();
    const run = this.db.transaction(() => {
      this.db
        .prepare('UPDATE emergency_overrides SET state = ?, revoked_by = ?, revoked_reason = ? WHERE id = ?')
        .run('REVOKED', auth.user.staff_id, reason ?? 'revoked by review', overrideId);
      appendLedgerEntry(
        this.db,
        {
          staff_id: auth.user.staff_id,
          staff_role: auth.user.role,
          ward: row.ward,
          patient_id: row.patient_id,
          action: 'EMERGENCY_OVERRIDE_REVOKED',
          details: { override_id: overrideId, subject: row.staff_id },
          session_id: auth.sessionId,
          terminal_id: meta.terminal_id ?? null,
          source_ip: meta.source_ip ?? null,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    run();
  }

  /** CMO/admin post-hoc review acknowledgement. */
  review(
    auth: AuthenticatedSubject,
    overrideId: string,
    decision: 'acknowledged' | 'escalated',
    notes: string | undefined,
    meta: RequestMeta
  ): void {
    if (auth.user.role !== 'cmo' && auth.user.role !== 'admin') {
      throw new AppError({
        code: 'ACCESS_DENIED',
        httpStatus: 403,
        message: 'Only the CMO or an administrator can review a grant'
      });
    }
    const row = emergencyOverridesRepository(this.db).findById(overrideId);
    if (row === undefined) {
      throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Override not found' });
    }
    const at = this.stamp();
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE emergency_overrides SET review_state = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ? WHERE id = ?'
        )
        .run(decision === 'acknowledged' ? 'ACKNOWLEDGED' : 'ESCALATED', auth.user.staff_id, at, notes ?? null, overrideId);
      appendLedgerEntry(
        this.db,
        {
          staff_id: auth.user.staff_id,
          staff_role: auth.user.role,
          ward: row.ward,
          patient_id: row.patient_id,
          action: 'OVERRIDE_REVIEWED',
          details: { override_id: overrideId, decision, subject: row.staff_id },
          session_id: auth.sessionId,
          terminal_id: meta.terminal_id ?? null,
          source_ip: meta.source_ip ?? null,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    run();
  }

  /** Review queue for CMO/admin. */
  listQueue(auth: AuthenticatedSubject, state?: string): EmergencyOverrideRow[] {
    if (auth.user.role !== 'cmo' && auth.user.role !== 'admin') {
      throw new AppError({
        code: 'ACCESS_DENIED',
        httpStatus: 403,
        message: 'Only the CMO or an administrator can read the review queue'
      });
    }
    if (state !== undefined && !['ACTIVE', 'EXPIRED', 'CLOSED', 'REVOKED'].includes(state)) {
      throw new AppError({ code: 'INVALID_BODY', httpStatus: 400, message: 'Unknown override state' });
    }
    const rows = (
      state === undefined
        ? this.db.prepare('SELECT * FROM emergency_overrides ORDER BY granted_at DESC').all()
        : this.db
            .prepare('SELECT * FROM emergency_overrides WHERE state = ? ORDER BY granted_at DESC')
            .all(state)
    ) as EmergencyOverrideRow[];
    return rows;
  }

  /** The caller's currently live grants. */
  activeFor(auth: AuthenticatedSubject): EmergencyOverrideRow[] {
    const nowMs = this.clock.now().getTime();
    return emergencyOverridesRepository(this.db)
      .listActiveForStaff(auth.user.staff_id)
      .filter((row) => Date.parse(row.expires_at) > nowMs);
  }

  /**
   * Lazy expiry for the records deny path: an ACTIVE row past expires_at
   * becomes EXPIRED (with a CLOSED/reason-expired entry — the §8.1
   * vocabulary has no EXPIRED action) and reports 410 on next access.
   */
  consumeExpiredGrant(
    staffId: string,
    patientId: string,
    meta: { session_id: string; terminal_id: string | null; source_ip: string | null }
  ): EmergencyOverrideRow | null {
    const nowMs = this.clock.now().getTime();
    const rows = emergencyOverridesRepository(this.db).listActiveForStaff(staffId);
    const expired = rows.find(
      (row) => row.patient_id === patientId && Date.parse(row.expires_at) <= nowMs
    );
    if (expired === undefined) {
      return null;
    }
    const at = this.stamp();
    const run = this.db.transaction(() => {
      this.db
        .prepare("UPDATE emergency_overrides SET state = 'EXPIRED', closed_at = ? WHERE id = ?")
        .run(at, expired.id);
      appendLedgerEntry(
        this.db,
        {
          staff_id: staffId,
          staff_role: 'unknown',
          ward: expired.ward,
          patient_id: expired.patient_id,
          action: 'EMERGENCY_OVERRIDE_CLOSED',
          details: { override_id: expired.id, reason: 'expired' },
          session_id: meta.session_id,
          terminal_id: meta.terminal_id,
          source_ip: meta.source_ip,
          timestamp: at
        },
        { clock: this.clock, timeZone: this.timeZone }
      );
    });
    run();
    return { ...expired, state: 'EXPIRED' };
  }
}
