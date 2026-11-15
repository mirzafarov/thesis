// Facts about a meeting for the AI assistant, so drafts contain the real date, people and links instead of
// placeholders. Times are written in the requesting user's own time zone.
import { prisma } from './prisma';
import { formatDateTime } from './emails';
import { providerLabel } from './video';
import { open } from './secureText';

export const AI_LANGUAGES = { en: 'English', lt: 'Lithuanian' } as const;
export type AiLanguage = keyof typeof AI_LANGUAGES;
export const isAiLanguage = (v: unknown): v is AiLanguage => typeof v === 'string' && v in AI_LANGUAGES;

/** Instruction appended to every prompt: answer language and "do not invent facts". */
export const writingRules = (language: AiLanguage) =>
  `Write the whole text in ${AI_LANGUAGES[language]}. Use only the facts given above; do not invent dates, names, ` +
  `places or numbers. If something the text needs is missing, leave a short placeholder in square brackets, e.g. [room].`;

/** A plain-text block describing the meeting, or null if it does not exist. */
export async function meetingContext(meetingId: string, viewerId: string) {
  const [meeting, viewer] = await Promise.all([
    prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        project: { select: { name: true } },
        organizer: { select: { firstName: true, lastName: true } },
        participants: { include: { user: { select: { firstName: true, lastName: true } } } },
        activity: { select: { title: true } },
        polls: { orderBy: { startTime: 'asc' }, select: { startTime: true } },
        notes: { orderBy: { createdAt: 'asc' }, select: { content: true, author: { select: { firstName: true, lastName: true } } } },
        actionItems: {
          orderBy: { createdAt: 'asc' },
          select: { title: true, dueDate: true, doneAt: true, assignee: { select: { firstName: true, lastName: true } } },
        },
      },
    }),
    prisma.user.findUnique({ where: { id: viewerId }, select: { timeZone: true } }),
  ]);
  if (!meeting) return null;
  const tz = viewer?.timeZone;
  const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;

  const lines = [
    `Project: ${meeting.project.name}`,
    `Meeting title: ${meeting.title}`,
    `Meeting type: ${meeting.category.toLowerCase()}`,
    meeting.description ? `Description: ${meeting.description}` : '',
    meeting.startDate
      ? `Time: ${formatDateTime(meeting.startDate, tz)} (${meeting.durationMin} minutes)`
      : `Time: not decided yet; proposed times: ${meeting.polls.map(p => formatDateTime(p.startTime, tz)).join('; ')} (${meeting.durationMin} minutes)`,
    `Organizer: ${name(meeting.organizer)}`,
    `Participants: ${meeting.participants.map(p => name(p.user)).join(', ')}`,
    meeting.videoUrl && meeting.videoProvider !== 'auto'
      ? `Online meeting (${providerLabel(meeting.videoProvider)}): ${meeting.videoUrl}`
      : meeting.videoProvider ? 'Online meeting (the video link is sent when the time is confirmed)' : 'In person',
    meeting.activity ? `Related project activity: ${meeting.activity.title}` : '',
    meeting.agenda ? `Agenda:\n${open(meeting.agenda)}` : '',
    meeting.notes.length
      ? `Notes written by participants:\n${meeting.notes.map(n => `- ${n.author ? name(n.author) : 'Someone'}: ${open(n.content)}`).join('\n')}`
      : '',
    meeting.actionItems.length
      ? `To-dos agreed so far:\n${meeting.actionItems.map(a =>
          `- ${a.title}${a.assignee ? ` (responsible: ${name(a.assignee)})` : ''}${a.dueDate ? `, due ${a.dueDate.toISOString().slice(0, 10)}` : ''}${a.doneAt ? ', done' : ''}`,
        ).join('\n')}`
      : '',
  ];
  return { meeting, text: lines.filter(Boolean).join('\n') };
}
