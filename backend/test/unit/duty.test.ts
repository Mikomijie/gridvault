import { describe, expect, it } from 'vitest';
import { dutyState } from '../../src/policy/duty.js';

const TZ = 'Africa/Lagos';
const GRACE = 30;

function at(wall: string): Date {
  return new Date(`2026-09-13T${wall}+01:00`);
}

describe('duty state (PRD 6.5)', () => {
  it('AT-020: night shift wraps midnight (21:59 off, 22:00-05:59 on, 06:00 off)', () => {
    const cases: Array<[string, string]> = [
      ['21:59:00', 'off_duty'],
      ['22:00:00', 'on_duty'],
      ['23:59:00', 'on_duty'],
      ['00:00:00', 'on_duty'],
      ['05:59:00', 'on_duty'],
      ['06:00:00', 'off_duty']
    ];
    for (const [wall, expected] of cases) {
      expect(
        dutyState({ shift: 'night', at: at(wall), timeZone: TZ, graceMinutes: GRACE }),
        wall
      ).toBe(expected);
    }
  });

  it('AT-021: morning shift grace (14:15 handover_grace, 14:31 off_duty)', () => {
    expect(
      dutyState({ shift: 'morning', at: at('14:15:00'), timeZone: TZ, graceMinutes: GRACE })
    ).toBe('handover_grace');
    expect(
      dutyState({ shift: 'morning', at: at('14:31:00'), timeZone: TZ, graceMinutes: GRACE })
    ).toBe('off_duty');
  });

  it('a zero grace window leaves the subject off_duty immediately after shift end', () => {
    expect(
      dutyState({ shift: 'morning', at: at('14:15:00'), timeZone: TZ, graceMinutes: 0 })
    ).toBe('off_duty');
    expect(
      dutyState({ shift: 'morning', at: at('14:15:00'), timeZone: TZ, graceMinutes: 30 })
    ).toBe('handover_grace');
  });

  it('a scheduled extension outranks handover grace (overtime cover writes)', () => {
    // Regression: grace used to shadow a valid extension, turning
    // legitimate writes into OFF_DUTY_WRITE (caught by AT-503 E2E).
    const instant = at('14:10:00');
    expect(dutyState({ shift: 'morning', at: instant, timeZone: TZ, graceMinutes: GRACE })).toBe(
      'handover_grace'
    );
    expect(
      dutyState({
        shift: 'morning',
        at: instant,
        timeZone: TZ,
        graceMinutes: GRACE,
        extensions: [{ starts_at: '2026-09-13T10:00:00Z', ends_at: '2026-09-13T20:00:00Z' }]
      })
    ).toBe('on_duty');
  });

  it('AT-024 (unit): a scheduled extension keeps the subject on_duty outside shift hours', () => {
    const instant = at('03:00:00');
    expect(
      dutyState({ shift: 'morning', at: instant, timeZone: TZ, graceMinutes: GRACE })
    ).toBe('off_duty');
    expect(
      dutyState({
        shift: 'morning',
        at: instant,
        timeZone: TZ,
        graceMinutes: GRACE,
        extensions: [{ starts_at: '2026-09-13T01:00:00Z', ends_at: '2026-09-13T05:00:00Z' }]
      })
    ).toBe('on_duty');
  });
});
