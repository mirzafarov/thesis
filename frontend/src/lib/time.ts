// Showing times in different time zones.

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** "Europe/Vilnius" -> "Vilnius", "America/New_York" -> "New York" */
export const zoneCity = (tz: string) => (tz.split('/').pop() || tz).replace(/_/g, ' ');

export function formatInZone(iso: string | Date, tz: string, opts: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...opts,
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export const timeInZone = (iso: string | Date, tz: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(typeof iso === 'string' ? new Date(iso) : iso);

/** Hour of the day (0–23) at that moment in that zone. */
export const hourInZone = (iso: string | Date, tz: string) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(typeof iso === 'string' ? new Date(iso) : iso));

/**
 * "08:00 New York · 22:00 Tokyo" for the other time zones among the people involved
 * (the viewer's own zone is left out because the main time is already in it).
 */
export function otherZonesLine(iso: string, zones: (string | null | undefined)[], ownZone = browserTimeZone()) {
  const unique = [...new Set(zones.filter((z): z is string => !!z && z !== ownZone))];
  return unique.map(z => {
    const h = hourInZone(iso, z);
    const night = h < 7 || h >= 21;
    return { zone: z, text: `${timeInZone(iso, z)} ${zoneCity(z)}`, night };
  });
}

export const allTimeZones = (): string[] => {
  try {
    return (Intl as any).supportedValuesOf('timeZone') as string[];
  } catch {
    return ['UTC', 'Europe/Vilnius', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Baku', 'Asia/Tokyo'];
  }
};
