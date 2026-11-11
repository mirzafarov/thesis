// Gantt dates are whole days in UTC, so a bar never shifts by a day because of the viewer's time zone.
// A "day number" is the number of days since 1970-01-01 (UTC). End dates are inclusive.

export const DAY_MS = 24 * 60 * 60 * 1000;

export const toDay = (iso: string) => Math.floor(new Date(iso).getTime() / DAY_MS);
export const dayToISO = (day: number) => new Date(day * DAY_MS).toISOString();
// Value for <input type="date">
export const dayToInput = (day: number) => dayToISO(day).slice(0, 10);
export const isoToInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');
export const todayDay = () => {
  const now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
};

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
const shortFmt = fmt({ day: 'numeric', month: 'short' });
const longFmt = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = fmt({ month: 'long', year: 'numeric' });
const weekdayFmt = fmt({ weekday: 'narrow' });

export const formatDay = (day: number) => shortFmt.format(new Date(day * DAY_MS));
export const formatDayLong = (day: number) => longFmt.format(new Date(day * DAY_MS));
export const formatMonth = (day: number) => monthFmt.format(new Date(day * DAY_MS));
export const formatWeekday = (day: number) => weekdayFmt.format(new Date(day * DAY_MS));
export const dayOfMonth = (day: number) => new Date(day * DAY_MS).getUTCDate();
// 0 = Monday ... 6 = Sunday
export const weekdayIndex = (day: number) => (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
