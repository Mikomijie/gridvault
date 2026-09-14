import { describe, expect, it } from 'vitest';
import {
  decide,
  decideLedgerAccess,
  type PolicyContext,
  type PolicyGrant,
  type PolicyResource,
  type PolicySubject
} from '../../src/policy/decide.js';
import { PATIENT_FIELD_GROUPS, type PatientGroup } from '../../src/policy/field-groups.js';
import { POLICY_REASONS } from '../../src/policy/reasons.js';

const ALL: PatientGroup[] = [...PATIENT_FIELD_GROUPS];
const NOW = Date.parse('2026-09-13T10:00:00Z');

function subject(over: Partial<PolicySubject> = {}): PolicySubject {
  return {
    staff_id: 'GV-9042',
    role: 'doctor',
    assigned_ward: 'icu',
    assigned_shift: 'morning',
    account_status: 'active',
    expires_at: null,
    ...over
  };
}

function resource(over: Partial<PolicyResource> = {}): PolicyResource {
  return { patient_id: 'p-084', hospital_number: 'HOSP-LOS-2025-084', ward: 'icu', ...over };
}

function context(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    duty: 'on_duty',
    nowMs: NOW,
    grant: null,
    inIntakeQueue: false,
    clerkKnownWards: [],
    requested: ALL,
    ...over
  };
}

function grant(over: Partial<PolicyGrant> = {}): PolicyGrant {
  return {
    grant_id: 'gr_1',
    staff_id: 'SN-7742',
    patient_id: 'p-084',
    readable: ALL,
    writable: ['VITALS', 'CLINICAL'],
    ...over
  };
}

describe('decide() branch coverage (AT-114)', () => {
  const seen = new Set<string>();
  const note = (code: string): void => {
    seen.add(code);
  };

  it('AT-114: every reason code is exercised at least once', () => {

    // ACCOUNT_INACTIVE / ACCOUNT_EXPIRED fail closed on every group.
    note(decide(subject({ account_status: 'suspended' }), 'read', resource(), context()).reason_code);
    note(
      decide(subject({ expires_at: '2020-01-01T00:00:00+01:00' }), 'read', resource(), context())
        .reason_code
    );
    // A future expiry proceeds.
    expect(
      decide(subject({ expires_at: '2030-01-01T00:00:00+01:00' }), 'read', resource(), context()).effect
    ).toBe('ALLOW');

    // EMERGENCY_GRANT bypasses ward and duty; sensitive stays read-only.
    const offDutyGrant = decide(
      subject({ staff_id: 'SN-7742', role: 'nurse', assigned_ward: 'ward_a' }),
      'read',
      resource(),
      context({ duty: 'off_duty', grant: grant() })
    );
    note(offDutyGrant.reason_code);
    expect(offDutyGrant.effect).toBe('ALLOW');
    const grantVitalsWrite = decide(
      subject({ staff_id: 'SN-7742', role: 'nurse', assigned_ward: 'ward_a' }),
      'write',
      resource(),
      context({ duty: 'off_duty', grant: grant(), requested: ['VITALS'] })
    );
    expect(grantVitalsWrite.effect).toBe('ALLOW');
    const grantSensitiveWrite = decide(
      subject({ staff_id: 'SN-7742', role: 'nurse', assigned_ward: 'ward_a' }),
      'write',
      resource(),
      context({ duty: 'off_duty', grant: grant(), requested: ['SENSITIVE'] })
    );
    expect(grantSensitiveWrite.effect).toBe('DENY');
    note(grantSensitiveWrite.reason_code);
    // A grant scoped away from a group falls through to the normal rules.
    const narrow = decide(
      subject(),
      'read',
      resource(),
      context({ grant: grant({ readable: ['VITALS'], writable: ['VITALS'] }), requested: ['CLINICAL'] })
    );
    expect(narrow.groups['CLINICAL']?.reason_code).toBe('ROLE_WARD_DUTY_SATISFIED');

    // CLERK_NO_CLINICAL redacts but does not fail an in-queue read.
    const clerkInQueue = decide(
      subject({ staff_id: 'RC-1029', role: 'clerk', assigned_ward: 'admissions' }),
      'read',
      resource({ ward: 'ward_a', hospital_number: 'HOSP-LOS-2025-081' }),
      context({ duty: 'on_duty', inIntakeQueue: true, clerkKnownWards: ['admissions', 'ward_a'] })
    );
    expect(clerkInQueue.effect).toBe('ALLOW');
    note(clerkInQueue.groups['CLINICAL']?.reason_code ?? 'missing');
    expect(clerkInQueue.groups['LOGISTICS']?.allowed).toBe(true);

    // CLERK_OUT_OF_QUEUE: enumerable ward -> 403-shape, elsewhere -> 404-shape.
    const outEnumerable = decide(
      subject({ staff_id: 'RC-1029', role: 'clerk', assigned_ward: 'admissions' }),
      'read',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty', inIntakeQueue: false, clerkKnownWards: ['admissions', 'ward_a'] })
    );
    expect(outEnumerable.effect).toBe('DENY');
    expect(outEnumerable.notEnumerable).toBe(false);
    note(outEnumerable.reason_code);
    const outHidden = decide(
      subject({ staff_id: 'RC-1029', role: 'clerk', assigned_ward: 'admissions' }),
      'read',
      resource(),
      context({ duty: 'on_duty', inIntakeQueue: false, clerkKnownWards: ['admissions', 'ward_a'] })
    );
    expect(outHidden.notEnumerable).toBe(true);

    // ADMIN_NO_CLINICAL with a RULE-ABUSE-05 obligation on explicit requests.
    const adminDossier = decide(
      subject({ staff_id: 'AD-0012', role: 'admin', assigned_ward: 'administration' }),
      'read',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty' })
    );
    expect(adminDossier.effect).toBe('ALLOW');
    note(adminDossier.groups['CLINICAL']?.reason_code ?? 'missing');
    expect(
      adminDossier.obligations.some((obligation) => obligation.rule === 'RULE-ABUSE-05')
    ).toBe(true);
    expect(adminDossier.groups['DEMOGRAPHICS']?.allowed).toBe(true);
    // An admin vitals-only request redacts silently: no RULE-ABUSE-05.
    const adminVitals = decide(
      subject({ staff_id: 'AD-0012', role: 'admin', assigned_ward: 'administration' }),
      'read',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty', requested: ['VITALS'] })
    );
    expect(adminVitals.groups['VITALS']?.allowed).toBe(false);
    expect(
      adminVitals.obligations.some((obligation) => obligation.rule === 'RULE-ABUSE-05')
    ).toBe(false);

    // WARD_MISMATCH denies with a break-glass affordance and one alert obligation.
    const offWard = decide(
      subject({ staff_id: 'SN-7742', role: 'nurse', assigned_ward: 'ward_a' }),
      'read',
      resource(),
      context({ duty: 'on_duty' })
    );
    expect(offWard.effect).toBe('DENY');
    expect(offWard.can_break_glass).toBe(true);
    note(offWard.reason_code);
    expect(offWard.obligations.filter((o) => o.kind === 'RAISE_ABUSE').length).toBe(1);

    // OFF_DUTY denies with a break-glass affordance.
    const offDuty = decide(subject(), 'read', resource(), context({ duty: 'off_duty' }));
    expect(offDuty.effect).toBe('DENY');
    note(offDuty.reason_code);
    expect(offDuty.can_break_glass).toBe(true);

    // HANDOVER_GRACE reads; OFF_DUTY_WRITE stops writes.
    const graceRead = decide(subject(), 'read', resource(), context({ duty: 'handover_grace' }));
    expect(graceRead.effect).toBe('ALLOW');
    note(graceRead.reason_code);
    const graceWrite = decide(
      subject(),
      'write',
      resource(),
      context({ duty: 'handover_grace', requested: ['VITALS'] })
    );
    expect(graceWrite.effect).toBe('DENY');
    note(graceWrite.reason_code);

    // ROLE_CANNOT_WRITE across roles; multi-group writes stop at the first denial.
    const nurseClinicalWrite = decide(
      subject({ staff_id: 'SN-7742', role: 'nurse', assigned_ward: 'ward_a' }),
      'write',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty', requested: ['CLINICAL'] })
    );
    expect(nurseClinicalWrite.effect).toBe('DENY');
    note(nurseClinicalWrite.reason_code);
    const nurseMixedWrite = decide(
      subject({ staff_id: 'SN-7742', role: 'nurse', assigned_ward: 'ward_a' }),
      'write',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty', requested: ['VITALS', 'CLINICAL'] })
    );
    expect(nurseMixedWrite.effect).toBe('DENY');
    expect(nurseMixedWrite.reason_code).toBe('ROLE_CANNOT_WRITE');
    // Allowed writes keep effect ALLOW.
    const clerkDemoWrite = decide(
      subject({ staff_id: 'RC-1029', role: 'clerk', assigned_ward: 'admissions' }),
      'write',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty', inIntakeQueue: true, clerkKnownWards: ['ward_a'], requested: ['DEMOGRAPHICS'] })
    );
    expect(clerkDemoWrite.effect).toBe('ALLOW');

    // ROLE_WARD_DUTY_SATISFIED happy path; read exposes matrix write flags.
    const happy = decide(subject(), 'read', resource(), context());
    expect(happy.effect).toBe('ALLOW');
    note(happy.reason_code);
    expect(happy.groups['DEMOGRAPHICS']?.write_allowed).toBe(true);
    const nurseDemoRead = decide(
      subject({ staff_id: 'SN-7742', role: 'nurse', assigned_ward: 'ward_a' }),
      'read',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty', requested: ['DEMOGRAPHICS'] })
    );
    expect(nurseDemoRead.groups['DEMOGRAPHICS']?.write_allowed).toBe(false);

    // Appends: nurses may append clinical notes; nothing else may.
    const nurseAppend = decide(
      subject({ staff_id: 'SN-7742', role: 'nurse', assigned_ward: 'ward_a' }),
      'append',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty', requested: ['CLINICAL'] })
    );
    expect(nurseAppend.effect).toBe('ALLOW');
    const badAppend = decide(subject(), 'append', resource(), context({ requested: ['VITALS'] }));
    expect(badAppend.effect).toBe('DENY');
    const clerkAppend = decide(
      subject({ staff_id: 'RC-1029', role: 'clerk', assigned_ward: 'admissions' }),
      'append',
      resource({ ward: 'ward_a' }),
      context({ duty: 'on_duty', inIntakeQueue: true, clerkKnownWards: ['ward_a'], requested: ['CLINICAL'] })
    );
    expect(clerkAppend.effect).toBe('DENY');
  });

  it('decideLedgerAccess scopes audit reads by role', () => {
    const admin = decideLedgerAccess(subject({ role: 'admin' }));
    note(admin.reason_code);
    expect(admin).toEqual({ effect: 'ALLOW', reason_code: 'LEDGER_ACCESS', wardScope: null });
    const cmo = decideLedgerAccess(subject({ role: 'cmo' }));
    note(cmo.reason_code);
    expect(cmo.effect).toBe('ALLOW');
    const doctor = decideLedgerAccess(subject());
    note(doctor.reason_code);
    expect(doctor).toEqual({ effect: 'ALLOW', reason_code: 'LEDGER_ACCESS', wardScope: 'icu' });
    const nurse = decideLedgerAccess(subject({ role: 'nurse' }));
    note(nurse.reason_code);
    expect(nurse.reason_code).toBe('LEDGER_FORBIDDEN');
    const clerk = decideLedgerAccess(subject({ role: 'clerk' }));
    note(clerk.reason_code);
    expect(clerk.effect).toBe('DENY');
    const suspended = decideLedgerAccess(subject({ account_status: 'suspended' }));
    note(suspended.reason_code);
    expect(suspended.reason_code).toBe('ACCOUNT_INACTIVE');
  });

  it('AT-114: coverage gate over the reason-code table', () => {
    // QUEUE_ACCESS_DENIED is raised by the admissions-queue endpoint (a
    // non-patient resource outside decide()'s signature) and is asserted in
    // the records integration suite; every other code is proven here.
    for (const code of POLICY_REASONS) {
      if (code === 'QUEUE_ACCESS_DENIED') {
        continue;
      }
      expect(seen.has(code), `reason code never exercised: ${code}`).toBe(true);
    }
  });
});
