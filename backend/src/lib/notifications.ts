import { prisma } from './prisma';
import { sendEmail } from './mailer';
import { emails } from './emails';

const SCHEDULED = ['CONFIRMED', 'CALENDAR_SYNCHRONIZED', 'RESCHEDULED'] as const;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const person = { select: { id: true, email: true, firstName: true, lastName: true, timeZone: true } } as const;
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

/** Record that a notification was sent. Returns false if it had already been sent (so it is skipped). */
async function claim(userId: string, type: string, refId: string) {
  try {
    await prisma.notificationLog.create({ data: { userId, type, refId } });
    return true;
  } catch (err: any) {
    if (err.code === 'P2002') return false; // already sent
    throw err;
  }
}

async function loadMeeting(meetingId: string) {
  return prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      project: { select: { name: true } },
      organizer: person,
      participants: { include: { user: person } },
      polls: { orderBy: { startTime: 'asc' } },
    },
  });
}

type LoadedMeeting = NonNullable<Awaited<ReturnType<typeof loadMeeting>>>;
const info = (m: LoadedMeeting) => ({
  id: m.id,
  title: m.title,
  projectName: m.project.name,
  startDate: m.startDate,
  durationMin: m.durationMin,
  organizerName: fullName(m.organizer),
});

// Run in the background: the API response does not wait for emails.
const background = (task: () => Promise<unknown>) => {
  task().catch(err => console.error('[notifications] failed:', err));
};

/** Poll created: ask every participant except the organizer to vote. */
export function notifyMeetingInvitation(meetingId: string) {
  background(async () => {
    const m = await loadMeeting(meetingId);
    if (!m) return;
    const slots = m.polls.map(p => p.startTime);
    for (const p of m.participants) {
      if (p.userId === m.organizerId) continue;
      if (await claim(p.userId, 'MEETING_INVITATION', m.id)) {
        await sendEmail(emails.meetingInvitation(p.user, info(m), slots));
      }
    }
  });
}

/** Time confirmed: tell every participant. */
export function notifyMeetingConfirmed(meetingId: string) {
  background(async () => {
    const m = await loadMeeting(meetingId);
    if (!m) return;
    for (const p of m.participants) {
      if (await claim(p.userId, 'MEETING_CONFIRMED', m.id)) {
        await sendEmail(emails.meetingConfirmed(p.user, info(m)));
      }
    }
  });
}

/** Meeting moved: tell every participant, and allow the reminders to be sent again for the new time. */
export function notifyMeetingRescheduled(meetingId: string, previousStart: Date | null) {
  background(async () => {
    await prisma.notificationLog.deleteMany({
      where: { refId: meetingId, type: { in: ['MEETING_REMINDER_24H', 'MEETING_REMINDER_1H'] } },
    });
    const m = await loadMeeting(meetingId);
    if (!m) return;
    for (const p of m.participants) {
      await sendEmail(emails.meetingRescheduled(p.user, info(m), previousStart));
    }
  });
}

/** Reminders 24 hours and 1 hour before scheduled meetings. */
async function sendMeetingReminders(now: Date) {
  const upcoming = await prisma.meeting.findMany({
    where: { status: { in: [...SCHEDULED] }, startDate: { gt: now, lte: new Date(now.getTime() + DAY) } },
    select: { id: true, startDate: true },
  });

  let sent = 0;
  for (const { id, startDate } of upcoming) {
    const msLeft = startDate!.getTime() - now.getTime();
    // 1-hour reminder in the last hour; 24-hour reminder when 23–24 hours remain.
    // (A meeting confirmed less than 23 hours ahead skips the 24-hour reminder: its confirmation email just went out.)
    let type: string, label: '1 hour' | '24 hours';
    if (msLeft <= HOUR) [type, label] = ['MEETING_REMINDER_1H', '1 hour'];
    else if (msLeft > DAY - HOUR) [type, label] = ['MEETING_REMINDER_24H', '24 hours'];
    else continue;
    const m = await loadMeeting(id);
    if (!m) continue;
    for (const p of m.participants) {
      if (await claim(p.userId, type, m.id)) {
        await sendEmail(emails.meetingReminder(p.user, info(m), label));
        sent++;
      }
    }
  }
  return sent;
}

/**
 * Critical activities whose end date has passed without being completed:
 * mark them DELAYED and notify the responsible person and the project managers (once per end date).
 */
async function checkDelayedActivities(now: Date) {
  const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const late = await prisma.activity.findMany({
    where: { isCritical: true, status: { not: 'COMPLETED' }, endDate: { lt: startOfTodayUtc } },
    include: {
      responsible: person,
      project: { select: { id: true, name: true, members: { where: { role: 'MANAGER' }, include: { user: person } } } },
    },
  });

  let sent = 0;
  for (const a of late) {
    if (a.status !== 'DELAYED') {
      await prisma.activity.update({ where: { id: a.id }, data: { status: 'DELAYED' } });
    }
    const recipients = new Map<string, { email: string; firstName: string; isResponsible: boolean }>();
    for (const m of a.project.members) recipients.set(m.user.id, { ...m.user, isResponsible: false });
    if (a.responsible) recipients.set(a.responsible.id, { ...a.responsible, isResponsible: true });

    // One alert per activity and end date: if the date is moved and missed again, a new alert is sent.
    const refId = `${a.id}:${a.endDate!.toISOString().slice(0, 10)}`;
    for (const [userId, r] of recipients) {
      if (await claim(userId, 'ACTIVITY_DELAYED', refId)) {
        await sendEmail(emails.activityDelayed(r, {
          title: a.title,
          projectName: a.project.name,
          projectId: a.project.id,
          endDate: a.endDate!,
          responsibleName: a.responsible ? fullName(a.responsible) : null,
        }, r.isResponsible));
        sent++;
      }
    }
  }
  return sent;
}

let running = false;
export async function runScheduledNotifications(now = new Date()) {
  if (running) return { reminders: 0, delays: 0 };
  running = true;
  try {
    const reminders = await sendMeetingReminders(now);
    const delays = await checkDelayedActivities(now);
    if (reminders || delays) console.log(`[notifications] sent ${reminders} reminder(s), ${delays} delay alert(s)`);
    return { reminders, delays };
  } catch (err) {
    console.error('[notifications] scheduled run failed:', err);
    return { reminders: 0, delays: 0 };
  } finally {
    running = false;
  }
}

/** Check for reminders and delays every few minutes while the server runs. */
export function startNotificationScheduler(intervalMinutes = Number(process.env.NOTIFY_INTERVAL_MINUTES || 5)) {
  runScheduledNotifications();
  const timer = setInterval(runScheduledNotifications, intervalMinutes * 60 * 1000);
  timer.unref();
  console.log(`[notifications] checking for reminders and delays every ${intervalMinutes} minute(s)`);
}
