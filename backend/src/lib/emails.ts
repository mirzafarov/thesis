// Email templates. Every value that comes from users (names, titles) goes through esc() so it cannot inject HTML.
import { APP_TIMEZONE, FRONTEND_URL } from './config';
import type { Email } from './mailer';

export const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(date);

export const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(date);

interface Layout {
  to: string;
  subject: string;
  greetingName: string;
  // Trusted HTML built by the templates below (user values already escaped)
  bodyHtml: string;
  bodyText: string;
  button?: { label: string; url: string };
  footnote?: string;
}

function layout({ to, subject, greetingName, bodyHtml, bodyText, button, footnote }: Layout): Email {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#F1F5F9;font-family:Segoe UI,Arial,sans-serif;color:#0F172A">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">
        <tr><td style="background:#0F172A;padding:18px 24px;color:#FFFFFF;font-size:20px;font-weight:700">
          Safe <span style="color:#3B82F6">Zone</span>
        </td></tr>
        <tr><td style="padding:28px 24px 8px;font-size:15px;line-height:1.6">
          <p style="margin:0 0 16px">Hello ${esc(greetingName)},</p>
          ${bodyHtml}
          ${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#2563EB;color:#FFFFFF;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${esc(button.label)}</a></p>
          <p style="margin:0 0 16px;font-size:12px;color:#64748B">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${esc(button.url)}</span></p>` : ''}
        </td></tr>
        <tr><td style="padding:16px 24px 24px;font-size:12px;color:#64748B;border-top:1px solid #E2E8F0">
          ${footnote ? `${esc(footnote)}<br><br>` : ''}This is an automatic message from the Safe Zone meeting platform.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Hello ${greetingName},`,
    '',
    bodyText,
    button ? `\n${button.label}: ${button.url}` : '',
    footnote ? `\n${footnote}` : '',
    '\n-- Safe Zone meeting platform',
  ].join('\n');

  return { to, subject, html, text };
}

interface Person { email: string; firstName: string }
interface MeetingInfo { id: string; title: string; projectName: string; startDate?: Date | null; durationMin: number; organizerName?: string }

const meetingsUrl = () => `${FRONTEND_URL}/meetings`;
const detailsHtml = (m: MeetingInfo) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;width:100%">
    <tr><td style="padding:14px 16px;font-size:14px;line-height:1.7">
      <strong style="font-size:16px">${esc(m.title)}</strong><br>
      Project: ${esc(m.projectName)}<br>
      ${m.startDate ? `When: <strong>${esc(formatDateTime(m.startDate))}</strong><br>` : ''}
      Duration: ${m.durationMin} minutes
      ${m.organizerName ? `<br>Organizer: ${esc(m.organizerName)}` : ''}
    </td></tr>
  </table>`;
const detailsText = (m: MeetingInfo) =>
  [`Meeting: ${m.title}`, `Project: ${m.projectName}`, m.startDate ? `When: ${formatDateTime(m.startDate)}` : '', `Duration: ${m.durationMin} minutes`, m.organizerName ? `Organizer: ${m.organizerName}` : '']
    .filter(Boolean).join('\n');

export const emails = {
  verifyEmail: (user: Person, link: string) => layout({
    to: user.email,
    subject: 'Confirm your email address',
    greetingName: user.firstName,
    bodyHtml: '<p style="margin:0">Thanks for signing up. Please confirm that this email address belongs to you. The link is valid for 24 hours.</p>',
    bodyText: 'Thanks for signing up. Please confirm that this email address belongs to you. The link is valid for 24 hours.',
    button: { label: 'Confirm email address', url: link },
    footnote: 'If you did not create an account, you can ignore this email.',
  }),

  passwordReset: (user: Person, link: string, minutes: number) => layout({
    to: user.email,
    subject: 'Reset your password',
    greetingName: user.firstName,
    bodyHtml: `<p style="margin:0">Someone asked to reset the password of your account. The link works <strong>once</strong> and expires in <strong>${minutes} minutes</strong>.</p>`,
    bodyText: `Someone asked to reset the password of your account. The link works once and expires in ${minutes} minutes.`,
    button: { label: 'Choose a new password', url: link },
    footnote: 'If you did not ask for this, ignore this email: your password stays the same.',
  }),

  passwordChanged: (user: Person, when: Date, ip: string) => layout({
    to: user.email,
    subject: 'Your password was changed',
    greetingName: user.firstName,
    bodyHtml: `<p style="margin:0 0 12px">The password of your account was changed on <strong>${esc(formatDateTime(when))}</strong> (IP address ${esc(ip)}).</p>
      <p style="margin:0"><strong>If this was not you</strong>, reset your password immediately with the button below and contact your system administrator so they can block the account.</p>`,
    bodyText: `The password of your account was changed on ${formatDateTime(when)} (IP address ${ip}).\nIf this was not you, reset your password immediately and contact your system administrator so they can block the account.`,
    button: { label: 'Reset my password', url: `${FRONTEND_URL}/forgot-password` },
  }),

  meetingInvitation: (user: Person, m: MeetingInfo, slots: Date[]) => layout({
    to: user.email,
    subject: `Vote on a time: ${m.title}`,
    greetingName: user.firstName,
    bodyHtml: `<p style="margin:0">${esc(m.organizerName || 'A colleague')} invited you to a meeting. Please vote on the proposed times.</p>
      ${detailsHtml({ ...m, startDate: null, organizerName: undefined })}
      <p style="margin:0 0 6px"><strong>Proposed times</strong></p>
      <ul style="margin:0;padding-left:20px">${slots.map(s => `<li>${esc(formatDateTime(s))}</li>`).join('')}</ul>`,
    bodyText: `${m.organizerName || 'A colleague'} invited you to a meeting. Please vote on the proposed times.\n\n${detailsText({ ...m, startDate: null, organizerName: undefined })}\n\nProposed times:\n${slots.map(s => `- ${formatDateTime(s)}`).join('\n')}`,
    button: { label: 'Vote now', url: meetingsUrl() },
  }),

  meetingConfirmed: (user: Person, m: MeetingInfo) => layout({
    to: user.email,
    subject: `Confirmed: ${m.title}`,
    greetingName: user.firstName,
    bodyHtml: `<p style="margin:0">The meeting time has been confirmed.</p>${detailsHtml(m)}`,
    bodyText: `The meeting time has been confirmed.\n\n${detailsText(m)}`,
    button: { label: 'Open meetings', url: meetingsUrl() },
  }),

  meetingRescheduled: (user: Person, m: MeetingInfo, previousStart: Date | null) => layout({
    to: user.email,
    subject: `Moved: ${m.title}`,
    greetingName: user.firstName,
    bodyHtml: `<p style="margin:0">A meeting you take part in has been moved${previousStart ? ` (it was on ${esc(formatDateTime(previousStart))})` : ''}.</p>${detailsHtml(m)}`,
    bodyText: `A meeting you take part in has been moved${previousStart ? ` (it was on ${formatDateTime(previousStart)})` : ''}.\n\n${detailsText(m)}`,
    button: { label: 'Open meetings', url: meetingsUrl() },
  }),

  meetingReminder: (user: Person, m: MeetingInfo, when: '24 hours' | '1 hour') => layout({
    to: user.email,
    subject: `Reminder: ${m.title} ${when === '1 hour' ? 'starts in 1 hour' : 'is tomorrow'}`,
    greetingName: user.firstName,
    bodyHtml: `<p style="margin:0">This is a reminder that your meeting starts in about <strong>${when}</strong>.</p>${detailsHtml(m)}`,
    bodyText: `This is a reminder that your meeting starts in about ${when}.\n\n${detailsText(m)}`,
    button: { label: 'Open meetings', url: meetingsUrl() },
  }),

  activityDelayed: (
    user: Person,
    a: { title: string; projectName: string; projectId: string; endDate: Date; responsibleName: string | null },
    isResponsible: boolean,
  ) => layout({
    to: user.email,
    subject: `Delayed: ${a.title} (${a.projectName})`,
    greetingName: user.firstName,
    bodyHtml: `<p style="margin:0 0 12px">The <strong>critical</strong> activity <strong>${esc(a.title)}</strong> in project <strong>${esc(a.projectName)}</strong> was due on <strong>${esc(formatDate(a.endDate))}</strong> and is not completed. Its status has been set to <strong>Delayed</strong>.</p>
      <p style="margin:0">${isResponsible ? 'You are responsible for this activity. Please update its status or agree a new date with your project manager.' : `Responsible: ${esc(a.responsibleName || 'nobody assigned')}. Consider moving the activity on the Gantt chart and the meetings linked to it.`}</p>`,
    bodyText: `The critical activity "${a.title}" in project "${a.projectName}" was due on ${formatDate(a.endDate)} and is not completed. Its status has been set to Delayed.\n${isResponsible ? 'You are responsible for this activity. Please update its status or agree a new date with your project manager.' : `Responsible: ${a.responsibleName || 'nobody assigned'}.`}`,
    button: { label: 'Open the project', url: `${FRONTEND_URL}/projects/${a.projectId}` },
  }),
};
