// GridVault duty-state function (PRD 6.5).
//
// SHIFTS = { morning: [06:00, 14:00), afternoon: [14:00, 22:00),
//            night: [22:00, 06:00) } in Africa/Lagos wall-clock time.
// A 30-minute handover grace follows each shift's end. A sanctioned
// scheduled_extension covering instant t keeps the subject on_duty.
//
// Boundary rule (pinned by AT-020/AT-021): the grace window is OPEN on the
// left — exactly at shift end the subject is off_duty, one minute later in
// handover_grace. All computation uses the injected Clock instant and the
// configured time zone; no offset literal appears here.

import type { AssignedShift } from '../db/repositories/users.js';

export type DutyState = 'on_duty' | 'handover_grace' | 'off_duty';

export interface ScheduledExtensionWindow {
  starts_at: string;
  ends_at: string;
}

export interface DutyStateInput {
  shift: AssignedShift;
  /** The instant to evaluate. */
  at: Date;
  /** IANA time zone, e.g. Africa/Lagos. */
  timeZone: string;
  /** Grace window in minutes after shift end. */
  graceMinutes: number;
  /** Sanctioned overtime windows covering the subject. */
  extensions?: ScheduledExtensionWindow[];
}

interface ShiftWindow {
  startMinutes: number;
  endMinutes: number;
}

const SHIFT_WINDOWS: Record<AssignedShift, ShiftWindow> = {
  morning: { startMinutes: 6 * 60, endMinutes: 14 * 60 },
  afternoon: { startMinutes: 14 * 60, endMinutes: 22 * 60 },
  night: { startMinutes: 22 * 60, endMinutes: 6 * 60 }
};

/** Wall-clock minutes since midnight of `at` in `timeZone`. */
export function wallMinutesAt(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(at);
  // No defensive lookup branch: a missing part yields NaN, which fails every
  // shift comparison below and lands fail-closed on off_duty.
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return Number(lookup.get('hour')) * 60 + Number(lookup.get('minute'));
}

function inShift(minutes: number, window: ShiftWindow): boolean {
  if (window.startMinutes <= window.endMinutes) {
    return minutes >= window.startMinutes && minutes < window.endMinutes;
  }
  // Midnight-wrapping night shift: 22:00-24:00 union 00:00-06:00.
  return minutes >= window.startMinutes || minutes < window.endMinutes;
}

/** Minutes after shift end, or null when `minutes` is not inside the grace window. */
function minutesIntoGrace(minutes: number, window: ShiftWindow, graceMinutes: number): number | null {
  if (graceMinutes <= 0) {
    return null;
  }
  const end = window.endMinutes;
  // Distance forward from shift end, modulo the day.
  const after = (minutes - end + 24 * 60) % (24 * 60);
  // Strictly after end (AT-020: exactly at 06:00 a night user is off_duty)
  // and strictly before end+grace.
  if (after > 0 && after < graceMinutes) {
    return after;
  }
  return null;
}

export function dutyState(input: DutyStateInput): DutyState {
  const minutes = wallMinutesAt(input.at, input.timeZone);
  const window = SHIFT_WINDOWS[input.shift];
  if (inShift(minutes, window)) {
    return 'on_duty';
  }
  // Sanctioned extensions outrank grace (PRD 6.5 lists no grace exception):
  // overtime cover is fully on duty, not read-only. This must precede the
  // grace check — E2E caught grace shadowing a valid extension and turning
  // legitimate writes into OFF_DUTY_WRITE.
  const atMs = input.at.getTime();
  for (const ext of input.extensions ?? []) {
    const start = Date.parse(ext.starts_at);
    const end = Date.parse(ext.ends_at);
    if (!Number.isNaN(start) && !Number.isNaN(end) && start <= atMs && atMs < end) {
      return 'on_duty';
    }
  }
  if (minutesIntoGrace(minutes, window, input.graceMinutes) !== null) {
    return 'handover_grace';
  }
  return 'off_duty';
}
