import { prisma } from './prisma';
import { sendEmail } from './mailer';
import { emails } from './emails';
import { providerLabel } from './video';
import { icsAttachment } from './ics';
import type { Email } from './mailer';

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
  videoUrl: m.videoUrl,
  // Before confirmation an "auto" meeting may still become Google Meet, so it is just called a video call
  videoLabel: m.videoProvider === 'auto' ? 'video call' : providerLabel(m.videoProvider),
});

/** Attach the meeting's .ics calendar file (only once it has a time). */
const withIcs = (email: Email, m: LoadedMeeting): Email =>
  m.startDate && m.endDate
    ? {
        ...email,
        attachments: [icsAttachment({
          id: m.id, title: m.title, description: m.description, startDate: m.startDate, endDate: m.endDate,
          updatedAt: m.updatedAt, videoUrl: m.videoUrl, projectName: m.project.name, organizerName: fullName(m.organizer),
        })],
      }
    : email;

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
        await sendEmail(withIcs(emails.meetingConfirmed(p.user, info(m)), m));
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
      await sendEmail(withIcs(emails.meetingRescheduled(p.user, info(m), previousStart), m));
    }
  });
}

async function loadActionItem(id: string) {
  return prisma.actionItem.findUnique({
    where: { id },
    include: { assignee: person, createdBy: person, meeting: { select: { title: true, project: { select: { name: true } } } } },
  });
}
type LoadedActionItem = NonNullable<Awaited<ReturnType<typeof loadActionItem>>>;
const actionItemInfo = (a: LoadedActionItem) => ({
  title: a.title,
  meetingTitle: a.meeting.title,
  projectName: a.meeting.project.name,
  dueDate: a.dueDate,
  assignedBy: a.createdBy ? fullName(a.createdBy) : undefined,
});

/** A to-do was assigned to someone: tell them. */
export function notifyActionItemAssigned(actionItemId: string) {
  background(async () => {
    const a = await loadActionItem(actionItemId);
    if (!a?.assignee || a.doneAt) return;
    await sendEmail(emails.actionItemAssigned(a.assignee, actionItemInfo(a)));
  });
}

/** Open to-dos due tomorrow: remind the assignee once (again if the due date is moved). */
async function sendActionItemReminders(now: Date) {
  const startOfTomorrowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const due = await prisma.actionItem.findMany({
    where: { doneAt: null, assigneeId: { not: null }, dueDate: { gte: startOfTomorrowUtc, lt: new Date(startOfTomorrowUtc.getTime() + DAY) } },
    select: { id: true, assigneeId: true, dueDate: true },
  });
  let sent = 0;
  for (const item of due) {
    if (!(await claim(item.assigneeId!, 'ACTION_ITEM_DUE', `${item.id}:${item.dueDate!.toISOString().slice(0, 10)}`))) continue;
    const a = await loadActionItem(item.id);
    if (!a?.assignee) continue;
    await sendEmail(emails.actionItemDue(a.assignee, actionItemInfo(a)));
    sent++;
  }
  return sent;
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
  if (running) return { reminders: 0, delays: 0, held: 0, todos: 0 };
  running = true;
  try {
    const reminders = await sendMeetingReminders(now);
    const delays = await checkDelayedActivities(now);
    const todos = await sendActionItemReminders(now);
    // Meetings whose end time has passed are marked as held.
    const held = await prisma.meeting.updateMany({
      where: { status: { in: [...SCHEDULED] }, endDate: { lt: now } },
      data: { status: 'COMPLETED' },
    });
    if (reminders || delays || todos || held.count) {
      console.log(`[notifications] sent ${reminders} reminder(s), ${delays} delay alert(s), ${todos} to-do reminder(s); ${held.count} meeting(s) marked as held`);
    }
    return { reminders, delays, held: held.count, todos };
  } catch (err) {
    console.error('[notifications] scheduled run failed:', err);
    return { reminders: 0, delays: 0, held: 0, todos: 0 };
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
