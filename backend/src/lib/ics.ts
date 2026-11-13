// iCalendar (.ics, RFC 5545) files for meetings, so any calendar app (Outlook, Apple Calendar, Google, Thunderbird)
// can add a confirmed meeting with one click. Attached to confirmation / reschedule emails and downloadable in the app.
import { FRONTEND_URL } from './config';

interface IcsMeeting {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  updatedAt: Date;
  videoUrl?: string | null;
  projectName?: string;
  organizerName?: string;
}

/** Times in UTC ("20261120T140000Z"): every calendar converts them to the reader's own time zone. */
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Text values must escape backslash, semicolon, comma and line breaks (RFC 5545, 3.3.11). */
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 bytes are folded: continued on the next line, which starts with a space (RFC 5545, 3.1). */
function fold(line: string) {
  const out: string[] = [];
  let current = '';
  for (const ch of line) {
    if (Buffer.byteLength(current + ch, 'utf8') > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
    }
    current += ch;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function meetingIcs(m: IcsMeeting) {
  const description = [
    m.description,
    m.projectName ? `Project: ${m.projectName}` : '',
    m.organizerName ? `Organizer: ${m.organizerName}` : '',
    m.videoUrl ? `Join the video call: ${m.videoUrl}` : '',
    `Safe Zone: ${FRONTEND_URL}/meetings`,
  ].filter(Boolean).join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Safe Zone//Meeting scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Same UID for the same meeting: importing the file again after a reschedule updates the event instead of copying it
    `UID:${m.id}@safezone`,
    // Higher SEQUENCE = newer version of the event
    `SEQUENCE:${Math.floor(m.updatedAt.getTime() / 1000)}`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(m.startDate)}`,
    `DTEND:${utc(m.endDate)}`,
    `SUMMARY:${text(m.title)}`,
    `DESCRIPTION:${text(description)}`,
    ...(m.videoUrl ? [`LOCATION:${text(m.videoUrl)}`, `URL:${m.videoUrl}`] : []),
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(m.title)}`,
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** A safe file name from the meeting title, e.g. "Sprint-review.ics". */
export const icsFileName = (title: string) => `${title.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'meeting'}.ics`;

/** Email attachment for nodemailer. */
export const icsAttachment = (m: IcsMeeting) => ({
  filename: icsFileName(m.title),
  content: meetingIcs(m),
  contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
});
