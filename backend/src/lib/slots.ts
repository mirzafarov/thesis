// Free slot finding: the times when every participant is free and within their own working hours.
import { google } from 'googleapis';
import { prisma } from './prisma';
import { getGoogleClientForUser } from './google';
import { localParts, zoneOf, formatInZone } from './timezones';

export interface Participant {
  id: string;
  firstName: string;
  lastName: string;
  timeZone: string | null;
  workdayStart: number;
  workdayEnd: number;
}

interface Interval { start: Date; end: Date }

const SCHEDULED = ['CONFIRMED', 'CALENDAR_SYNCHRONIZED', 'RESCHEDULED'] as const;
const STEP_MIN = 30;

/**
 * Busy times per participant: Google Calendar free/busy (only busy intervals, never event details)
 * plus their scheduled Safe Zone meetings (so people without Google Calendar are covered too).
 */
export async function busyIntervals(userIds: string[], from: Date, to: Date, excludeMeetingId?: string) {
  const busy = new Map<string, Interval[]>(userIds.map(id => [id, []]));
  const connected = new Set<string>();

  await Promise.all(userIds.map(async userId => {
    const account = await getGoogleClientForUser(userId);
    if (!account) return;
    try {
      const fb = await google.calendar({ version: 'v3', auth: account.client }).freebusy.query({
        requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] },
      });
      connected.add(userId);
      for (const b of fb.data.calendars?.['primary']?.busy || []) {
        if (b.start && b.end) busy.get(userId)!.push({ start: new Date(b.start), end: new Date(b.end) });
      }
    } catch (err: any) {
      console.error(`Free/busy failed for user ${userId}:`, err.message);
    }
  }));

  const meetings = await prisma.meeting.findMany({
    where: {
      status: { in: [...SCHEDULED] },
      startDate: { lt: to, not: null },
      participants: { some: { userId: { in: userIds } } },
      ...(excludeMeetingId ? { id: { not: excludeMeetingId } } : {}),
    },
    select: { startDate: true, endDate: true, durationMin: true, participants: { select: { userId: true } } },
  });
  for (const m of meetings) {
    const start = m.startDate!;
    const end = m.endDate ?? new Date(start.getTime() + m.durationMin * 60000);
    if (end <= from) continue;
    for (const p of m.participants) busy.get(p.userId)?.push({ start, end });
  }

  return { busy, connected };
}

export interface SlotSearch {
  participants: Participant[];
  busy: Map<string, Interval[]>;
  durationMin: number;
  from: Date;
  to: Date;
  organizerTimeZone: string;
  /** Optional window in the organizer's local time, e.g. only 13:00–17:00. */
  fromHour?: number;
  toHour?: number;
  count: number;
  /** In single-day mode several options may come from the same day. */
  perDayLimit: number;
  now?: Date;
}

const minutesOfDay = (p: { hour: number; minute: number }) => p.hour * 60 + p.minute;

/** Fits within the person's working hours on a weekday, in their own time zone? Returns minutes of slack or null. */
function workSlack(start: Date, end: Date, person: Participant) {
  const tz = zoneOf(person.timeZone);
  const s = localParts(start, tz);
  const e = localParts(new Date(end.getTime() - 60000), tz); // last minute of the meeting
  if (s.weekday > 4 || s.dateKey !== e.dateKey) return null; // weekend, or crosses midnight
  const startMin = minutesOfDay(s);
  const endMin = minutesOfDay(e) + 1;
  const dayStart = person.workdayStart * 60;
  const dayEnd = person.workdayEnd * 60;
  if (startMin < dayStart || endMin > dayEnd) return null;
  return Math.min(startMin - dayStart, dayEnd - endMin);
}

export function findSlots(search: SlotSearch) {
  const { participants, busy, durationMin, from, to, organizerTimeZone, fromHour, toHour, count, perDayLimit } = search;
  const now = search.now ?? new Date();
  const durMs = durationMin * 60000;
  const stats = { checked: 0, outsideHours: 0, busy: 0 };
  const candidates: { start: Date; end: Date; score: number; day: string }[] = [];

  // Start on the first :00 or :30 after both `from` and "15 minutes from now".
  const earliest = Math.max(from.getTime(), now.getTime() + 15 * 60000);
  let t = Math.ceil(earliest / (STEP_MIN * 60000)) * STEP_MIN * 60000;

  for (; t + durMs <= to.getTime(); t += STEP_MIN * 60000) {
    const start = new Date(t);
    const end = new Date(t + durMs);
    stats.checked++;

    const org = localParts(start, organizerTimeZone);
    if (fromHour !== undefined && minutesOfDay(org) < fromHour * 60) continue;
    if (toHour !== undefined && minutesOfDay(localParts(new Date(end.getTime() - 60000), organizerTimeZone)) + 1 > toHour * 60) continue;

    let minSlack = Infinity;
    let ok = true;
    for (const p of participants) {
      const slack = workSlack(start, end, p);
      if (slack === null) { ok = false; break; }
      minSlack = Math.min(minSlack, slack);
    }
    if (!ok) { stats.outsideHours++; continue; }

    if (participants.some(p => (busy.get(p.id) || []).some(b => start < b.end && end > b.start))) {
      stats.busy++;
      continue;
    }

    // Prefer comfortable times (not right at the start or end of anyone's day), capped at 2 hours.
    candidates.push({ start, end, score: Math.min(minSlack, 120), day: org.dateKey });
  }

  // Best options: earliest days first; within a day the most comfortable times, at least 2 hours apart.
  const byDay = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (!byDay.has(c.day)) byDay.set(c.day, []);
    byDay.get(c.day)!.push(c);
  }
  const chosen: typeof candidates = [];
  for (const [, list] of [...byDay].sort(([a], [b]) => a.localeCompare(b))) {
    const picked: typeof candidates = [];
    for (const c of [...list].sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime())) {
      if (picked.length >= perDayLimit) break;
      if (picked.every(p => Math.abs(p.start.getTime() - c.start.getTime()) >= Math.max(durMs, 2 * 3600e3))) picked.push(c);
    }
    chosen.push(...picked.sort((a, b) => a.start.getTime() - b.start.getTime()));
    if (chosen.length >= count) break;
  }

  const final = chosen.slice(0, count);
  // The recommended option: the most comfortable one (earliest if several are equally good).
  const best = final.reduce<(typeof final)[number] | null>((b, c) => (!b || c.score > b.score ? c : b), null);

  return {
    stats,
    slots: final.map(c => ({
      start: c.start.toISOString(),
      end: c.end.toISOString(),
      best: c === best,
      // The same moment on each participant's own clock
      localTimes: participants.map(p => ({
        userId: p.id,
        name: `${p.firstName} ${p.lastName}`,
        timeZone: zoneOf(p.timeZone),
        label: formatInZone(c.start, zoneOf(p.timeZone)),
      })),
    })),
  };
}
