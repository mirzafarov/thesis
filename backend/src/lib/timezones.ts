// Time zone helpers built on Intl (handles daylight saving time correctly).

export const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Vilnius';

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const zoneOf = (tz: string | null | undefined) => (isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE);

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Wall-clock time of a moment in a time zone. weekday: 0 = Monday ... 6 = Sunday. */
export function localParts(date: Date, tz: string) {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(tz).formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday!),
    dateKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Offset of a time zone from UTC at a moment, in minutes (e.g. +120 for Vilnius in summer). */
function offsetMinutes(date: Date, tz: string) {
  const l = localParts(date, tz);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** The UTC moment when the wall clock in `tz` shows the given local date and time. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetMinutes(new Date(guess), tz) * 60000;
  // Second pass fixes the guess when it fell on the other side of a daylight-saving change.
  result = guess - offsetMinutes(new Date(result), tz) * 60000;
  return new Date(result);
}

/** "YYYY-MM-DD" -> [start of that day, start of the next day] in the given time zone. */
export function dayRange(dateKey: string, tz: string): [Date, Date] {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const start = zonedToUtc(y, m, d, 0, 0, tz);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return [start, end];
}

export function formatInZone(date: Date, tz: string, withZoneName = true) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', ...(withZoneName ? { timeZoneName: 'short' } : {}),
  }).format(date);
}
