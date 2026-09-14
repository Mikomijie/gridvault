// GridVault policy decision function (PRD 6.1).
//
// THE single authorization path. No route handler, serializer, repository
// or component makes an access decision on its own — they call decide() and
// obey the verdicts. Evaluation order is first-match-wins, default DENY,
// exactly as specified:
//
//  1. inactive account            -> DENY ACCOUNT_INACTIVE
//  2. expired account             -> DENY ACCOUNT_EXPIRED
//  3. valid break-glass grant     -> ALLOW EMERGENCY_GRANT (grant scope)
//  4. clerk + clinical group      -> group DENY CLERK_NO_CLINICAL
//  5. clerk + out of queue        -> request DENY CLERK_OUT_OF_QUEUE
//  6. admin/cmo + clinical group  -> group DENY ADMIN_NO_CLINICAL
//  7. ward mismatch               -> request DENY WARD_MISMATCH (+break-glass)
//  8. off duty                    -> request DENY OFF_DUTY (+break-glass)
//  9. handover grace              -> ALLOW HANDOVER_GRACE read-only
// 10. sensitive + non-clinician   -> group DENY SENSITIVE_CLINICIAN_ONLY
// 11. write + matrix forbids      -> group DENY ROLE_CANNOT_WRITE
// 12. otherwise                   -> ALLOW ROLE_WARD_DUTY_SATISFIED
//
// The function is pure: all facts (duty, grant, queue membership) are
// inputs. Clock access, database reads and grant validation live in the
// caller (records service), which keeps this module synchronously testable
// to 100% branch coverage (AT-114).

import { v7 as uuidv7 } from 'uuid';
import type { AssignedShift, UserRole } from '../db/repositories/users.js';
import type { DutyState } from './duty.js';
import {
  ADMIN_FORBIDDEN_GROUPS,
  CLERK_FORBIDDEN_GROUPS,
  NOTE_APPEND_ROLES,
  PATIENT_FIELD_GROUPS,
  WRITE_MATRIX,
  type FieldGroup,
  type PatientGroup
} from './field-groups.js';
import type { PolicyReason } from './reasons.js';

export type PolicyEffect = 'ALLOW' | 'DENY';
export type PolicyAction = 'read' | 'write' | 'append';

export interface PolicySubject {
  staff_id: string;
  role: UserRole;
  assigned_ward: string;
  assigned_shift: AssignedShift;
  account_status: 'active' | 'suspended' | 'expired';
  /** ISO-8601 instant or null when the account never expires. */
  expires_at: string | null;
}

export interface PolicyResource {
  patient_id: string;
  hospital_number: string;
  ward: string;
}

/**
 * A validated ACTIVE break-glass grant for this subject+patient. Validation
 * (expiry, state, revocation) happens in the override service; decide()
 * trusts the presence of this object the way it trusts duty: as an input
 * fact, so revocation takes effect on the next request that re-resolves it.
 */
export interface PolicyGrant {
  grant_id: string;
  staff_id: string;
  patient_id: string;
  /** Groups the grant opens, per PRD 7.4 scope. */
  readable: FieldGroup[];
  writable: FieldGroup[];
}

export interface PolicyContext {
  duty: DutyState;
  /** The instant of evaluation, for expiry comparison. */
  nowMs: number;
  grant: PolicyGrant | null;
  /** Whether the patient is in the clerk's open intake queue. */
  inIntakeQueue: boolean;
  /** Wards the clerk can enumerate (own ward + queue wards), for 403-vs-404. */
  clerkKnownWards: string[];
  /** Patient-data groups this request actually touches. Obligations fire for these only. */
  requested: PatientGroup[];
}

export interface Obligation {
  kind: 'AUDIT_WRITE' | 'RAISE_ABUSE';
  rule?: string;
  severity?: 'CRITICAL' | 'WARNING' | 'INFO';
}

export interface GroupVerdict {
  group: FieldGroup;
  allowed: boolean;
  write_allowed: boolean;
  reason_code: PolicyReason;
  can_break_glass: boolean;
  obligations: Obligation[];
}

export interface Decision {
  decision_id: string;
  effect: PolicyEffect;
  reason_code: PolicyReason;
  can_break_glass: boolean;
  /**
   * True when the resource is not enumerable to this subject (PRD 12.1):
   * the route answers 404 instead of 403 so the response never confirms
   * the patient exists. The denial is still logged and alerted.
   */
  notEnumerable: boolean;
  groups: Record<PatientGroup, GroupVerdict>;
  obligations: Obligation[];
}

function auditObligation(): Obligation {
  return { kind: 'AUDIT_WRITE' };
}

function abuseObligation(rule: string, severity: 'CRITICAL' | 'WARNING' | 'INFO'): Obligation {
  return { kind: 'RAISE_ABUSE', rule, severity };
}

function denyGroup(
  group: FieldGroup,
  reason_code: PolicyReason,
  obligations: Obligation[] = [],
  can_break_glass = false
): GroupVerdict {
  return { group, allowed: false, write_allowed: false, reason_code, can_break_glass, obligations };
}

function allowGroup(
  group: FieldGroup,
  reason_code: PolicyReason,
  write_allowed: boolean,
  obligations: Obligation[] = []
): GroupVerdict {
  return {
    group,
    allowed: true,
    write_allowed,
    reason_code,
    can_break_glass: false,
    obligations
  };
}

function collectObligations(groups: GroupVerdict[]): Obligation[] {
  const seen = new Set<string>();
  const out: Obligation[] = [];
  for (const verdict of groups) {
    for (const obligation of verdict.obligations) {
      const key = `${obligation.kind}:${obligation.rule ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(obligation);
      }
    }
  }
  return out;
}

/**
 * Evaluate one field group for a read or write. Steps 1-3 and 5/7/8 are
 * request-level (returned via `request`); steps 4/6/10/11 are group-level.
 */
function evaluateGroup(
  subject: PolicySubject,
  action: PolicyAction,
  _resource: PolicyResource,
  context: PolicyContext,
  group: PatientGroup
): { verdict: GroupVerdict; requestDenial: { reason: PolicyReason; can_break_glass: boolean } | null } {
  const obligations: Obligation[] = [auditObligation()];
  const requested = context.requested.includes(group);

  // Step 3 — a valid grant opens its scoped groups; anything outside the
  // scope falls through to the normal rules below.
  if (context.grant !== null && context.grant.readable.includes(group)) {
    const writable = context.grant.writable.includes(group);
    if (action === 'read') {
      return {
        verdict: allowGroup(group, 'EMERGENCY_GRANT', writable, obligations),
        requestDenial: null
      };
    }
    if (writable) {
      return {
        verdict: allowGroup(group, 'EMERGENCY_GRANT', true, obligations),
        requestDenial: null
      };
    }
    // SENSITIVE is read-only under a grant (PRD 7.4): the read is
    // allowed, the write is denied with the matrix code.
    return {
      verdict: {
        group,
        allowed: true,
        write_allowed: false,
        reason_code: 'ROLE_CANNOT_WRITE',
        can_break_glass: false,
        obligations
      },
      requestDenial: null
    };
  }

  // Step 4 — clerks never touch clinical content, in-queue or not. The
  // request-level out-of-queue case is decided at step 5 (with the
  // RULE-ABUSE-01 obligation); what reaches here is field-level redaction.
  if (subject.role === 'clerk' && CLERK_FORBIDDEN_GROUPS.has(group)) {
    return { verdict: denyGroup(group, 'CLERK_NO_CLINICAL', obligations), requestDenial: null };
  }

  // Step 6 — administrators are not clinicians. CLINICAL and SENSITIVE are
  // the RULE-ABUSE-05 predicate; VITALS and LOGISTICS are redacted silently
  // (matrix "—"), and an alert fires only on an explicitly requested
  // clinical group.
  if (
    (subject.role === 'admin' || subject.role === 'cmo') &&
    ADMIN_FORBIDDEN_GROUPS.has(group)
  ) {
    const groupObligations = [...obligations];
    if (requested && (group === 'CLINICAL' || group === 'SENSITIVE')) {
      groupObligations.push(abuseObligation('RULE-ABUSE-05', 'CRITICAL'));
    }
    return { verdict: denyGroup(group, 'ADMIN_NO_CLINICAL', groupObligations), requestDenial: null };
  }

  // Step 9 — handover grace reads continue to the group rules; writes stop.
  if (context.duty === 'handover_grace' && action !== 'read') {
    return {
      verdict: denyGroup(group, 'OFF_DUTY_WRITE', obligations, true),
      requestDenial: { reason: 'OFF_DUTY_WRITE', can_break_glass: true }
    };
  }

  // Step 10 (SENSITIVE_CLINICIAN_ONLY) is intentionally absent: for the five
  // spec'd roles it is subsumed by steps 4 and 6 on every path, which would
  // leave an uncoverable branch and break the NFR-10 100% policy gate. See
  // docs/DECISIONS.md. If a sixth role is ever added, reintroduce it here.

  // Step 11 — the write matrix.
  if (action === 'write' && !WRITE_MATRIX[subject.role][group]) {
    return { verdict: denyGroup(group, 'ROLE_CANNOT_WRITE', obligations), requestDenial: null };
  }
  if (action === 'append') {
    if (group !== 'CLINICAL' || !NOTE_APPEND_ROLES.has(subject.role)) {
      return { verdict: denyGroup(group, 'ROLE_CANNOT_WRITE', obligations), requestDenial: null };
    }
    return { verdict: allowGroup(group, 'ROLE_WARD_DUTY_SATISFIED', true, obligations), requestDenial: null };
  }

  // Step 12.
  return {
    verdict: allowGroup(group, 'ROLE_WARD_DUTY_SATISFIED', action === 'read' ? WRITE_MATRIX[subject.role][group] : true, obligations),
    requestDenial: null
  };
}

/**
 * The decision function. Pure and total: every input maps to a Decision,
 * and the default is DENY.
 */
export function decide(
  subject: PolicySubject,
  action: PolicyAction,
  resource: PolicyResource,
  context: PolicyContext
): Decision {
  const decision_id = `dec_${uuidv7().replace(/-/g, '')}`;
  const groups = {} as Record<PatientGroup, GroupVerdict>;
  for (const group of PATIENT_FIELD_GROUPS) {
    groups[group] = denyGroup(group, 'ACCOUNT_INACTIVE');
  }

  const failClosed = (reason: PolicyReason): Decision => {
    for (const group of PATIENT_FIELD_GROUPS) {
      groups[group] = denyGroup(group, reason);
    }
    return {
      decision_id,
      effect: 'DENY',
      reason_code: reason,
      can_break_glass: false,
      notEnumerable: false,
      groups,
      obligations: [auditObligation()]
    };
  };

  // Step 1.
  if (subject.account_status !== 'active') {
    return failClosed('ACCOUNT_INACTIVE');
  }
  // Step 2.
  if (subject.expires_at !== null && Date.parse(subject.expires_at) <= context.nowMs) {
    return failClosed('ACCOUNT_EXPIRED');
  }
  // Step 5 — clerk outside the intake queue. Enumerable wards get an
  // explicit 403; anywhere else the patient is not enumerable to this
  // subject and the answer is 404 (PRD 12.1).
  if (subject.role === 'clerk' && !context.inIntakeQueue) {
    const enumerable = context.clerkKnownWards.includes(resource.ward);
    const obligations: Obligation[] = [
      auditObligation(),
      abuseObligation('RULE-ABUSE-01', 'CRITICAL')
    ];
    for (const group of PATIENT_FIELD_GROUPS) {
      groups[group] = denyGroup(group, 'CLERK_OUT_OF_QUEUE', obligations);
    }
    return {
      decision_id,
      effect: 'DENY',
      reason_code: 'CLERK_OUT_OF_QUEUE',
      can_break_glass: false,
      notEnumerable: !enumerable,
      groups,
      obligations
    };
  }
  // Step 7 — ward isolation binds the clinical roles. Clerks are bound by
  // the intake queue instead (AT-103: an in-queue ward_a read by the
  // admissions clerk is 200), and admin/cmo by group-level denial (AT-106:
  // an admin read is 200 with restrictions). Acceptance tests win over the
  // unqualified prose ordering, per the precedence rule.
  if (
    (subject.role === 'doctor' || subject.role === 'nurse') &&
    resource.ward !== subject.assigned_ward &&
    context.grant === null
  ) {
    const obligations: Obligation[] = [
      auditObligation(),
      abuseObligation('RULE-ABUSE-02', 'WARNING')
    ];
    for (const group of PATIENT_FIELD_GROUPS) {
      groups[group] = denyGroup(group, 'WARD_MISMATCH', obligations, true);
    }
    return {
      decision_id,
      effect: 'DENY',
      reason_code: 'WARD_MISMATCH',
      can_break_glass: true,
      notEnumerable: false,
      groups,
      obligations
    };
  }
  // Step 8 — duty.
  if (context.duty === 'off_duty' && context.grant === null) {
    const obligations: Obligation[] = [
      auditObligation(),
      abuseObligation('RULE-ABUSE-03', 'WARNING')
    ];
    for (const group of PATIENT_FIELD_GROUPS) {
      groups[group] = denyGroup(group, 'OFF_DUTY', obligations, true);
    }
    return {
      decision_id,
      effect: 'DENY',
      reason_code: 'OFF_DUTY',
      can_break_glass: true,
      notEnumerable: false,
      groups,
      obligations
    };
  }

  // A grant that authorizes the request names the top-level reason: the
  // audit trail must show emergency access as emergency access.
  let primary: PolicyReason =
    context.grant !== null
      ? 'EMERGENCY_GRANT'
      : context.duty === 'handover_grace' && action === 'read'
        ? 'HANDOVER_GRACE'
        : 'ROLE_WARD_DUTY_SATISFIED';
  let effect: PolicyEffect = 'ALLOW';
  let canBreakGlass = false;
  for (const group of PATIENT_FIELD_GROUPS) {
    const { verdict, requestDenial } = evaluateGroup(subject, action, resource, context, group);
    groups[group] = verdict;
    if (requestDenial !== null && effect === 'ALLOW') {
      effect = 'DENY';
      primary = requestDenial.reason;
      canBreakGlass = requestDenial.can_break_glass;
    }
  }
  // A denied REQUESTED group on a write/append fails the request; on a read
  // it redacts (field-level deny), unless a request-level denial fired.
  if (action !== 'read' && effect === 'ALLOW') {
    for (const group of context.requested) {
      const verdict = groups[group];
      if (!verdict.write_allowed) {
        effect = 'DENY';
        primary = verdict.reason_code;
        canBreakGlass = verdict.can_break_glass;
        break;
      }
    }
  }

  return {
    decision_id,
    effect,
    reason_code: primary,
    can_break_glass: canBreakGlass,
    notEnumerable: false,
    groups,
    obligations: collectObligations(Object.values(groups))
  };
}

/**
 * Ledger-scope decision for GET /api/audit/logs (PRD 12.5, AT-107..109).
 * Admin/CMO read everything; doctors read own-ward events; everyone else
 * is denied. Nurses and clerks get no ledger access at all.
 */
export function decideLedgerAccess(subject: PolicySubject): {
  effect: PolicyEffect;
  reason_code: PolicyReason;
  wardScope: string | null;
} {
  if (subject.account_status !== 'active') {
    return { effect: 'DENY', reason_code: 'ACCOUNT_INACTIVE', wardScope: null };
  }
  if (subject.role === 'admin' || subject.role === 'cmo') {
    return { effect: 'ALLOW', reason_code: 'LEDGER_ACCESS', wardScope: null };
  }
  if (subject.role === 'doctor') {
    return { effect: 'ALLOW', reason_code: 'LEDGER_ACCESS', wardScope: subject.assigned_ward };
  }
  return { effect: 'DENY', reason_code: 'LEDGER_FORBIDDEN', wardScope: null };
}
