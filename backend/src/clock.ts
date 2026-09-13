// GridVault clock abstraction.
//
// All timestamps flow from an injected Clock so duty-state, expiry and
// ledger logic is testable without sleeping. Production code uses
// `systemClock`; tests inject a fixed clock.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now(): Date {
    return new Date();
  }
};

export function fixedClock(isoInstant: string): Clock {
  const at = new Date(isoInstant);
  return {
    now(): Date {
      return new Date(at.getTime());
    }
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Format a Date as ISO-8601 with the explicit numeric offset of `timeZone`
 * at that instant (e.g. `2026-09-13T14:22:07.318+01:00` for Africa/Lagos).
 * The offset is derived from the Intl time-zone database at runtime; no
 * offset literal is hard-coded, so DST-bearing zones stay correct too.
 */
export function formatIsoWithOffset(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) {
      throw new Error(`Missing date part: ${type}`);
    }
    return Number(part.value);
  };

  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = get('hour');
  const minute = get('minute');
  const second = get('second');
  // en-CA with hour12:false can render midnight as 24:00:00.
  if (hour === 24) {
    hour = 0;
  }

  const wallAsUtcMs =
    Date.UTC(year, month - 1, day, hour, minute, second) + date.getMilliseconds();
  const offsetMinutes = Math.round((wallAsUtcMs - date.getTime()) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;

  return (
    `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` +
    `T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(date.getMilliseconds(), 3)}${offset}`
  );
}
