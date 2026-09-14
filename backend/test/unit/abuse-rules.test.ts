// Unit tests for the nine abuse-rule predicate modules (PRD 9.2, P6 DoD).
//
// Each rule file owns one pure predicate so the boundary is testable in
// isolation; the engine owns counting and the services own enforcement.
// These tests pin every branch of every predicate, including the exact
// escalation boundaries the integration tests (AT-403..AT-407) exercise.

import { describe, expect, it } from 'vitest';
import { isClerkProbe, RULE_ID as RULE01 } from '../../src/abuse/rules/rule01-clerk-probe.js';
import { escalationSeverity, RULE_ID as RULE02 } from '../../src/abuse/rules/rule02-off-ward.js';
import { chargeNurseRecipient, RULE_ID as RULE03 } from '../../src/abuse/rules/rule03-off-shift.js';
import { isFrequencySpike, RULE_ID as RULE04 } from '../../src/abuse/rules/rule04-breakglass-spike.js';
import { alertRecipients, RULE_ID as RULE05 } from '../../src/abuse/rules/rule05-admin-reach.js';
import { bulkVerdict, RULE_ID as RULE06 } from '../../src/abuse/rules/rule06-bulk-enumeration.js';
import { isSensitiveSweep, RULE_ID as RULE07 } from '../../src/abuse/rules/rule07-sensitive-sweep.js';
import { shouldLockout, RULE_ID as RULE08 } from '../../src/abuse/rules/rule08-credential-stuffing.js';
import { isReuseOfRotatedToken, RULE_ID as RULE09 } from '../../src/abuse/rules/rule09-refresh-reuse.js';

describe('abuse rule predicates', () => {
  it('RULE-ABUSE-01 fires for any out-of-queue clerk request, and in-queue only for clinical groups', () => {
    expect(RULE01).toBe('RULE-ABUSE-01');
    expect(isClerkProbe({ role: 'doctor', inIntakeQueue: false, requested: ['CLINICAL'] })).toBe(false);
    expect(isClerkProbe({ role: 'clerk', inIntakeQueue: false, requested: ['DEMOGRAPHICS'] })).toBe(true);
    expect(isClerkProbe({ role: 'clerk', inIntakeQueue: true, requested: ['DEMOGRAPHICS', 'LOGISTICS'] })).toBe(false);
    expect(isClerkProbe({ role: 'clerk', inIntakeQueue: true, requested: ['DEMOGRAPHICS', 'CLINICAL'] })).toBe(true);
    expect(isClerkProbe({ role: 'clerk', inIntakeQueue: true, requested: ['SENSITIVE'] })).toBe(true);
    expect(isClerkProbe({ role: 'clerk', inIntakeQueue: true, requested: [] })).toBe(false);
  });

  it('RULE-ABUSE-02 escalates to CRITICAL exactly on the Nth attempt in the window', () => {
    expect(RULE02).toBe('RULE-ABUSE-02');
    expect(escalationSeverity(0, 3)).toBe('WARNING');
    expect(escalationSeverity(1, 3)).toBe('WARNING');
    expect(escalationSeverity(2, 3)).toBe('CRITICAL');
    expect(escalationSeverity(9, 3)).toBe('CRITICAL');
  });

  it('RULE-ABUSE-03 routes the off-shift alert to the ward charge nurse', () => {
    expect(RULE03).toBe('RULE-ABUSE-03');
    expect(chargeNurseRecipient('ward_a')).toContain('ward_a');
  });

  it('RULE-ABUSE-04 spikes on the second grant inside the window', () => {
    expect(RULE04).toBe('RULE-ABUSE-04');
    expect(isFrequencySpike(0, 2)).toBe(false);
    expect(isFrequencySpike(1, 2)).toBe(true);
    expect(isFrequencySpike(2, 2)).toBe(true);
    expect(isFrequencySpike(1, 3)).toBe(false);
    expect(isFrequencySpike(2, 3)).toBe(true);
  });

  it('RULE-ABUSE-05 notifies CMO and DPO but never the acting admin', () => {
    expect(RULE05).toBe('RULE-ABUSE-05');
    expect(alertRecipients('AD-0012', 'GV-9101')).toEqual(['GV-9101', 'role:dpo']);
    // The CMO probing clinically still notifies the DPO, not themselves twice.
    expect(alertRecipients('GV-9101', 'GV-9101')).toEqual(['role:dpo']);
  });

  it('RULE-ABUSE-06 warns past the window and goes CRITICAL at twice the window', () => {
    expect(RULE06).toBe('RULE-ABUSE-06');
    const thresholds = { shortWindow: 20, longWindow: 60, criticalMultiplier: 2 };
    expect(bulkVerdict(20, 20, thresholds)).toBe('NONE');
    expect(bulkVerdict(21, 21, thresholds)).toBe('WARNING');
    expect(bulkVerdict(5, 61, thresholds)).toBe('WARNING');
    expect(bulkVerdict(40, 10, thresholds)).toBe('CRITICAL');
    expect(bulkVerdict(10, 120, thresholds)).toBe('CRITICAL');
  });

  it('RULE-ABUSE-07 sweeps at the distinct-patient threshold', () => {
    expect(RULE07).toBe('RULE-ABUSE-07');
    expect(isSensitiveSweep(4, 5)).toBe(false);
    expect(isSensitiveSweep(5, 5)).toBe(true);
    expect(isSensitiveSweep(6, 5)).toBe(true);
  });

  it('RULE-ABUSE-08 locks out exactly at the failure threshold', () => {
    expect(RULE08).toBe('RULE-ABUSE-08');
    expect(shouldLockout(4, 5)).toBe(false);
    expect(shouldLockout(5, 5)).toBe(true);
    expect(shouldLockout(6, 5)).toBe(true);
  });

  it('RULE-ABUSE-09 matches only the rotated-token reuse reason', () => {
    expect(RULE09).toBe('RULE-ABUSE-09');
    expect(isReuseOfRotatedToken('rotated')).toBe(true);
    expect(isReuseOfRotatedToken('logout')).toBe(false);
    expect(isReuseOfRotatedToken(null)).toBe(false);
    expect(isReuseOfRotatedToken('reuse_detected')).toBe(false);
  });
});
