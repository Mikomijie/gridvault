// GridVault abuse obligation engine (PRD 9.1, 9.2).
//
// Rules evaluate synchronously, inside the request, before the response is
// serialized, and can block. The policy engine emits obligations
// (RAISE_ABUSE with a rule id); this module executes them: one alert row +
// one ABUSE_ALERT_RAISED ledger entry, carrying the policy decision_id so
// the alert is provably the product of a real decision (AT-401), never a
// fabricated row.
//
// Stateful rules live here too, behind pure predicates in rules/:
// - RULE-ABUSE-02 escalates WARNING → CRITICAL on the Nth off-ward attempt
//   inside the window (AT-403).
// - RULE-ABUSE-03 queues a charge-nurse notification alongside the alert
//   (AT-404).
// - RULE-ABUSE-05 routes CMO + DPO dispatches, never to the acting admin
//   (AT-406).
// - RULE-ABUSE-06 counts distinct patient reads from the ledger and throttles
//   subsequent reads to 1 rps once the threshold is crossed (AT-407).
// - RULE-ABUSE-07 counts distinct SENSITIVE reads without a care assignment
//   and blocks further sensitive reads for the block window (AT-407-style).

import type { GridVaultDatabase } from '../db/connection.js';
import type { Clock } from '../clock.js';
import { formatIsoWithOffset, systemClock } from '../clock.js';
import { raiseAbuseAlert } from './alerts.js';
import { loadAbuseRules, type AbuseRuleThresholds } from './config.js';
import { escalationSeverity } from './rules/rule02-off-ward.js';
import { chargeNurseRecipient } from './rules/rule03-off-shift.js';
import { alertRecipients } from './rules/rule05-admin-reach.js';
import { bulkVerdict } from './rules/rule06-bulk-enumeration.js';
import { isSensitiveSweep } from './rules/rule07-sensitive-sweep.js';
import { queueOutbox } from '../notify/outbox.js';
import { abuseAlertsRepository, type AlertSeverity } from '../db/repositories/security.js';
import { AppError } from '../http/errors.js';
import type { Decision } from '../policy/decide.js';

export interface ObligationContext {
  staff_id: string;
  staff_role: string;
  ward: string;
  patient_id: string;
  decision_id: string;
  session_id?: string | null;
  terminal_id?: string | null;
  source_ip?: string | null;
}

export interface EngineOptions {
  clock?: Clock;
  timeZone?: string;
  thresholds?: AbuseRuleThresholds;
}

let cachedThresholds: AbuseRuleThresholds | null = null;

export function defaultThresholds(): AbuseRuleThresholds {
  if (cachedThresholds === null) {
    cachedThresholds = loadAbuseRules();
  }
  return cachedThresholds;
}

/** Test hook: drop the cached thresholds and the in-memory throttle state. */
export function resetAbuseEngineState(): void {
  cachedThresholds = null;
  lastReadMsByStaff.clear();
}

function thresholdsOf(options: EngineOptions): AbuseRuleThresholds {
  return options.thresholds ?? defaultThresholds();
}

function windowStartIso(clock: Clock, minutes: number): string {
  return new Date(clock.now().getTime() - minutes * 60000).toISOString();
}

/** Execute the RAISE_ABUSE obligations of a decision, synchronously. */
export function executeDecisionObligations(
  db: GridVaultDatabase,
  decision: Decision,
  context: ObligationContext,
  options: EngineOptions = {}
): string[] {
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const thresholds = thresholdsOf(options);
  const alertIds: string[] = [];
  for (const obligation of decision.obligations) {
    if (obligation.kind !== 'RAISE_ABUSE' || obligation.rule === undefined) {
      continue;
    }
    let severity = (obligation.severity ?? 'WARNING') as AlertSeverity;
    let facts: Record<string, string | number | boolean | null> = {
      decision_id: decision.decision_id,
      reason: decision.reason_code
    };
    if (obligation.rule === 'RULE-ABUSE-02') {
      const prior = abuseAlertsRepository(db).countByRuleSince(
        context.staff_id,
        'RULE-ABUSE-02',
        windowStartIso(clock, thresholds.off_ward_escalation_window_minutes)
      );
      severity = escalationSeverity(prior, thresholds.off_ward_escalation_count);
      facts = {
        ...facts,
        attempt_in_window: prior + 1,
        escalation_count: thresholds.off_ward_escalation_count
      };
    }
    const raised = raiseAbuseAlert(
      db,
      {
        staff_id: context.staff_id,
        patient_id: context.patient_id,
        rule_triggered: obligation.rule,
        severity,
        facts,
        decision_id: decision.decision_id,
        session_id: context.session_id ?? null,
        terminal_id: context.terminal_id ?? null,
        source_ip: context.source_ip ?? null,
        staff_role: context.staff_role,
        ward: context.ward
      },
      { clock, timeZone }
    );
    alertIds.push(raised.alert_id);
    if (obligation.rule === 'RULE-ABUSE-03') {
      queueOutbox(
        db,
        {
          channel: 'local',
          recipient: chargeNurseRecipient(context.ward),
          subject: 'Off-shift access attempt',
          body:
            `Off-shift access attempt by ${context.staff_id} denied (${decision.reason_code}). ` +
            `Alert ${raised.alert_id}.`,
          priority: 'NORMAL',
          related_type: 'alert',
          related_id: raised.alert_id
        },
        { clock, timeZone }
      );
    }
    if (obligation.rule === 'RULE-ABUSE-05') {
      const cmoRow = db
        .prepare("SELECT staff_id FROM users WHERE role = 'cmo' LIMIT 1")
        .get() as { staff_id: string } | undefined;
      const cmo = cmoRow?.staff_id ?? 'role:cmo';
      for (const recipient of alertRecipients(context.staff_id, cmo)) {
        queueOutbox(
          db,
          {
            channel: 'local',
            recipient,
            subject: 'Administrator clinical reach blocked',
            body:
              `Clinical access attempt by ${context.staff_id} blocked (${decision.reason_code}). ` +
              `Alert ${raised.alert_id}.`,
            priority: 'HIGH',
            related_type: 'alert',
            related_id: raised.alert_id
          },
          { clock, timeZone }
        );
      }
    }
  }
  return alertIds;
}

// ─── Bulk enumeration (RULE-ABUSE-06) ─────────────────────────────────────────

/** In-memory 1 rps throttle markers, per staff. Gated by ledger counts, so a fresh test DB never throttles. */
const lastReadMsByStaff = new Map<string, number>();

function distinctPatientsReadSince(db: GridVaultDatabase, staffId: string, sinceIso: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(DISTINCT patient_id) AS n FROM audit_logs WHERE staff_id = ? AND action = 'VIEW_RECORD' AND timestamp >= ?"
    )
    .get(staffId, sinceIso) as { n: number };
  return row.n;
}

/**
 * Pre-read guard: once the bulk threshold is crossed, reads faster than 1 rps
 * are rejected with 429 (AT-407). Called before serialization so it blocks.
 */
export function enforceBulkThrottle(
  db: GridVaultDatabase,
  staffId: string,
  options: EngineOptions = {}
): void {
  const clock = options.clock ?? systemClock;
  const thresholds = thresholdsOf(options);
  const nowMs = clock.now().getTime();
  const distinct5 = distinctPatientsReadSince(db, staffId, windowStartIso(clock, 5));
  const distinct60 = distinctPatientsReadSince(db, staffId, windowStartIso(clock, 60));
  const verdict = bulkVerdict(distinct5, distinct60, {
    shortWindow: thresholds.bulk_read_distinct_5min,
    longWindow: thresholds.bulk_read_distinct_60min,
    criticalMultiplier: thresholds.bulk_read_critical_multiplier
  });
  if (verdict === 'NONE') {
    lastReadMsByStaff.set(staffId, nowMs);
    return;
  }
  const last = lastReadMsByStaff.get(staffId);
  if (last !== undefined && nowMs - last < 1000 / thresholds.bulk_throttle_per_second) {
    throw new AppError({
      code: 'THROTTLED',
      httpStatus: 429,
      message: 'Reading too fast. Slow down and continue clinical work.'
    });
  }
  lastReadMsByStaff.set(staffId, nowMs);
}

/**
 * Post-read detector: after a successful dossier read, raise RULE-ABUSE-06
 * when the subject crosses into bulk territory. Fires once per window — a
 * repeat crossing while an alert is already open does not spam the queue.
 */
export function detectBulkEnumeration(
  db: GridVaultDatabase,
  input: {
    staff_id: string;
    staff_role: string;
    ward: string;
    patient_id: string;
    session_id?: string | null;
    terminal_id?: string | null;
    source_ip?: string | null;
  },
  options: EngineOptions = {}
): void {
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const thresholds = thresholdsOf(options);
  const distinct5 = distinctPatientsReadSince(db, input.staff_id, windowStartIso(clock, 5));
  const distinct60 = distinctPatientsReadSince(db, input.staff_id, windowStartIso(clock, 60));
  const verdict = bulkVerdict(distinct5, distinct60, {
    shortWindow: thresholds.bulk_read_distinct_5min,
    longWindow: thresholds.bulk_read_distinct_60min,
    criticalMultiplier: thresholds.bulk_read_critical_multiplier
  });
  if (verdict === 'NONE') {
    return;
  }
  const recent = abuseAlertsRepository(db).latestByRule(input.staff_id, 'RULE-ABUSE-06');
  if (recent !== undefined && recent.timestamp >= windowStartIso(clock, 60)) {
    return;
  }
  raiseAbuseAlert(
    db,
    {
      staff_id: input.staff_id,
      patient_id: input.patient_id,
      rule_triggered: 'RULE-ABUSE-06',
      severity: verdict,
      facts: { distinct_5min: distinct5, distinct_60min: distinct60 },
      decision_id: null,
      session_id: input.session_id ?? null,
      terminal_id: input.terminal_id ?? null,
      source_ip: input.source_ip ?? null,
      staff_role: input.staff_role,
      ward: input.ward
    },
    { clock, timeZone }
  );
}

// ─── Sensitive sweep (RULE-ABUSE-07) ──────────────────────────────────────────

function distinctSensitivePatientsSince(
  db: GridVaultDatabase,
  staffId: string,
  sinceIso: string
): number {
  const row = db
    .prepare(
      "SELECT COUNT(DISTINCT patient_id) AS n FROM audit_logs WHERE staff_id = ? AND action = 'VIEW_SENSITIVE' AND timestamp >= ?"
    )
    .get(staffId, sinceIso) as { n: number };
  return row.n;
}

function hasCareAssignment(db: GridVaultDatabase, userId: string, patientId: string): boolean {
  const row = db
    .prepare(
      'SELECT id FROM care_assignments WHERE user_id = ? AND patient_id = ? AND active_to IS NULL LIMIT 1'
    )
    .get(userId, patientId) as { id: string } | undefined;
  return row !== undefined;
}

/**
 * Pre-read guard: a subject flagged for a sensitive sweep is blocked from
 * further SENSITIVE reads for the block window (AT-407-style, PRD 9.2).
 * Grant-scoped emergency reads are exempt — care first.
 */
export function enforceSensitiveSweepBlock(
  db: GridVaultDatabase,
  input: { staff_id: string; under_grant: boolean },
  options: EngineOptions = {}
): void {
  if (input.under_grant) {
    return;
  }
  const clock = options.clock ?? systemClock;
  const thresholds = thresholdsOf(options);
  const recent = abuseAlertsRepository(db).latestByRule(input.staff_id, 'RULE-ABUSE-07');
  if (recent === undefined) {
    return;
  }
  if (recent.timestamp < windowStartIso(clock, thresholds.sensitive_block_minutes)) {
    return;
  }
  throw new AppError({
    code: 'ACCESS_DENIED',
    httpStatus: 403,
    message: 'Sensitive reads are temporarily blocked after unusual access patterns',
    reasonCode: 'SENSITIVE_SWEEP_BLOCKED'
  });
}

/** Post-read detector for RULE-ABUSE-07. Grant-scoped reads never count. */
export function detectSensitiveSweep(
  db: GridVaultDatabase,
  input: {
    staff_id: string;
    user_id: string;
    staff_role: string;
    ward: string;
    patient_id: string;
    under_grant: boolean;
    session_id?: string | null;
    terminal_id?: string | null;
    source_ip?: string | null;
  },
  options: EngineOptions = {}
): void {
  if (input.under_grant) {
    return;
  }
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const thresholds = thresholdsOf(options);
  if (hasCareAssignment(db, input.user_id, input.patient_id)) {
    return;
  }
  const distinct = distinctSensitivePatientsSince(
    db,
    input.staff_id,
    windowStartIso(clock, thresholds.sensitive_sweep_window_minutes)
  );
  if (!isSensitiveSweep(distinct, thresholds.sensitive_sweep_distinct_patients)) {
    return;
  }
  const recent = abuseAlertsRepository(db).latestByRule(input.staff_id, 'RULE-ABUSE-07');
  if (
    recent !== undefined &&
    recent.timestamp >= windowStartIso(clock, thresholds.sensitive_sweep_window_minutes)
  ) {
    return;
  }
  const at = formatIsoWithOffset(clock.now(), timeZone);
  void at;
  raiseAbuseAlert(
    db,
    {
      staff_id: input.staff_id,
      patient_id: input.patient_id,
      rule_triggered: 'RULE-ABUSE-07',
      severity: 'CRITICAL',
      facts: {
        distinct_sensitive_patients: distinct,
        window_minutes: thresholds.sensitive_sweep_window_minutes
      },
      decision_id: null,
      session_id: input.session_id ?? null,
      terminal_id: input.terminal_id ?? null,
      source_ip: input.source_ip ?? null,
      staff_role: input.staff_role,
      ward: input.ward
    },
    { clock, timeZone }
  );
}
