// GridVault abuse-alert writer.
//
// The P6 rule engine evaluates predicates; this module owns the alert row +
// ledger entry pair, so every raiser (login lockout, refresh reuse, policy
// obligations) produces the same shape. One alert always pairs with exactly
// one ABUSE_ALERT_RAISED ledger entry, joined to the caller's ambient
// transaction when one exists. Details carry identifiers, rule ids, counts
// and decision codes — never PHI values.

import { v7 as uuidv7 } from 'uuid';
import type { GridVaultDatabase } from '../db/connection.js';
import type { Clock } from '../clock.js';
import { formatIsoWithOffset, systemClock } from '../clock.js';
import { appendLedgerEntry } from '../ledger/append.js';
import {
  abuseAlertsRepository,
  type AlertSeverity,
  type AlertStatus,
  type AbuseAlertRow
} from '../db/repositories/security.js';
import { canonicalJson } from '../crypto/canonical-json.js';
import { recordAlert } from '../observability/metrics.js';
import { usersRepository } from '../db/repositories/users.js';
import { AppError } from '../http/errors.js';

export interface RaiseAlertInput {
  staff_id: string;
  patient_id: string;
  rule_triggered: string;
  severity: AlertSeverity;
  /** Identifiers and codes only. Never PHI values. */
  facts: Record<string, string | number | boolean | null>;
  decision_id?: string | null;
  session_id?: string | null;
  terminal_id?: string | null;
  source_ip?: string | null;
  staff_role?: string;
  ward?: string;
}

export interface RaiseAlertResult {
  alert_id: string;
  audit_log_index: number;
}

export function raiseAbuseAlert(
  db: GridVaultDatabase,
  input: RaiseAlertInput,
  options: { clock?: Clock; timeZone?: string } = {}
): RaiseAlertResult {
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const at = formatIsoWithOffset(clock.now(), timeZone);
  // Full UUIDv7 hex: a sliced prefix would collide for alerts raised in the
  // same millisecond (two denials in one burst must not 500 on the PK).
  const alertId = `al_${uuidv7().replace(/-/g, '')}`;

  const write = db.transaction(() => {
    const ledger = appendLedgerEntry(
      db,
      {
        staff_id: input.staff_id,
        staff_role: input.staff_role ?? 'unknown',
        ward: input.ward ?? 'unknown',
        patient_id: input.patient_id,
        action: 'ABUSE_ALERT_RAISED',
        details: {
          alert_id: alertId,
          rule: input.rule_triggered,
          severity: input.severity,
          decision_id: input.decision_id ?? null,
          facts: input.facts
        },
        session_id: input.session_id ?? null,
        terminal_id: input.terminal_id ?? null,
        source_ip: input.source_ip ?? null,
        timestamp: at
      },
      { clock, timeZone }
    );
    abuseAlertsRepository(db).insert({
      id: alertId,
      timestamp: at,
      staff_id: input.staff_id,
      patient_id: input.patient_id,
      rule_triggered: input.rule_triggered,
      severity: input.severity,
      details: canonicalJson({ severity: input.severity, ...input.facts }),
      decision_id: input.decision_id ?? null,
      audit_log_index: ledger.log_index,
      terminal_id: input.terminal_id ?? null,
      source_ip: input.source_ip ?? null,
      status: 'FLAGGED',
      resolution: null,
      resolved_by: null,
      resolved_at: null,
      resolution_notes: null
    });
    return ledger.log_index;
  });
  const auditLogIndex = write();
  recordAlert(input.rule_triggered);
  return { alert_id: alertId, audit_log_index: auditLogIndex };
}

export interface ResolveAlertInput {
  alert_id: string;  /** Staff id of the resolver, from the server-side session — never the client. */
  actor_staff_id: string;
  actor_role: string;
  actor_ward: string;
  status: AlertStatus;
  resolution?: AbuseAlertRow['resolution'];
  notes?: string;
}

const FORWARD_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  FLAGGED: ['INVESTIGATING', 'RESOLVED'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED: []
};

/**
 * Triage an alert (PRD 9.3). A staff member can never resolve an alert
 * raised against themselves — enforced server-side (AT-408). Resolution
 * requires a note and writes an ABUSE_ALERT_RESOLVED ledger entry.
 */
export function resolveAbuseAlert(
  db: GridVaultDatabase,
  input: ResolveAlertInput,
  options: { clock?: Clock; timeZone?: string; session_id?: string | null } = {}
): AbuseAlertRow {
  const clock = options.clock ?? systemClock;
  const timeZone = options.timeZone ?? 'Africa/Lagos';
  const alert = abuseAlertsRepository(db).findById(input.alert_id);
  if (alert === undefined) {
    throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Alert not found' });
  }
  if (alert.staff_id === input.actor_staff_id) {
    throw new AppError({
      code: 'CANNOT_RESOLVE_OWN_ALERT',
      httpStatus: 403,
      message: 'A staff member cannot triage an alert raised against themselves'
    });
  }
  if (input.actor_role !== 'admin' && input.actor_role !== 'cmo') {
    throw new AppError({
      code: 'ACCESS_DENIED',
      httpStatus: 403,
      message: 'Only an administrator or the CMO can triage alerts'
    });
  }
  if (!FORWARD_TRANSITIONS[alert.status].includes(input.status)) {
    throw new AppError({
      code: 'INVALID_TRANSITION',
      httpStatus: 409,
      message: `An alert in ${alert.status} cannot move to ${input.status}`
    });
  }
  if (input.status === 'RESOLVED') {
    if (input.resolution === undefined || input.resolution === null) {
      throw new AppError({
        code: 'INVALID_BODY',
        httpStatus: 400,
        message: 'Resolving an alert requires a resolution outcome'
      });
    }
    if ((input.notes ?? '').trim().length === 0) {
      throw new AppError({
        code: 'INVALID_BODY',
        httpStatus: 400,
        message: 'Resolving an alert requires a triage note'
      });
    }
  }
  const at = formatIsoWithOffset(clock.now(), timeZone);
  const write = db.transaction(() => {
    abuseAlertsRepository(db).updateResolution(input.alert_id, {
      status: input.status,
      resolution: input.status === 'RESOLVED' ? (input.resolution ?? null) : null,
      resolved_by: input.actor_staff_id,
      resolved_at: at,
      resolution_notes: input.notes ?? null
    });
    appendLedgerEntry(
      db,
      {
        staff_id: input.actor_staff_id,
        staff_role: input.actor_role,
        ward: input.actor_ward,
        patient_id: alert.patient_id,
        action: 'ABUSE_ALERT_RESOLVED',
        details: {
          alert_id: alert.id,
          rule: alert.rule_triggered,
          from: alert.status,
          to: input.status,
          resolution: input.resolution ?? null,
          subject: alert.staff_id
        },
        session_id: options.session_id ?? null,
        timestamp: at
      },
      { clock, timeZone }
    );
  });
  write();
  const updated = abuseAlertsRepository(db).findById(input.alert_id);
  if (updated === undefined) {
    throw new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Alert not found' });
  }
  return updated;
}

/** Route-service helpers: routes must call these, never repositories directly. */
export function listAlerts(
  db: GridVaultDatabase,
  filters: { status?: AlertStatus; severity?: AlertSeverity; limit: number }
): AbuseAlertRow[] {
  return abuseAlertsRepository(db).listFiltered(filters);
}

export function latestAlertByRule(db: GridVaultDatabase, rule: string): AbuseAlertRow | undefined {
  const rows = db
    .prepare('SELECT * FROM abuse_alerts WHERE rule_triggered = ? ORDER BY timestamp DESC LIMIT 1')
    .all(rule) as AbuseAlertRow[];
  return rows[0];
}

export function findUserByStaffId(db: GridVaultDatabase, staffId: string) {
  return usersRepository(db).findByStaffId(staffId);
}

export function listRecentAlerts(db: GridVaultDatabase, limit: number): AbuseAlertRow[] {
  return abuseAlertsRepository(db).listFiltered({ limit });
}

export function listAlertsSince(db: GridVaultDatabase, sinceIso: string, limit: number): AbuseAlertRow[] {
  return db
    .prepare('SELECT * FROM abuse_alerts WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?')
    .all(sinceIso, limit) as AbuseAlertRow[];
}
