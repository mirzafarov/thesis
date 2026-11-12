// Video call links for online meetings.
//  - Jitsi: a room with a long random name, created instantly without any account (works for every participant).
//  - Google Meet: created through the organizer's connected Google Calendar when the meeting is confirmed.
//  - Custom: a link the organizer pastes (Zoom, Teams, ...).
import crypto from 'node:crypto';
import { google } from 'googleapis';
import { getGoogleClientForUser } from './google';

export const VIDEO_MODES = ['auto', 'jitsi', 'custom', 'none'] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

const jitsiBase = () => (process.env.JITSI_BASE_URL || 'https://meet.jit.si').replace(/\/+$/, '');

/** A Jitsi room that nobody can guess: readable title part plus 16 random hex characters. */
export function newJitsiUrl(title: string) {
  const slug = title.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '').slice(0, 30) || 'Meeting';
  return `${jitsiBase()}/SafeZone-${slug}-${crypto.randomBytes(8).toString('hex')}`;
}

/** A pasted meeting link must be a plain https URL. */
export function validCustomUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Provider and link for a new meeting, from the organizer's choice. */
export function videoFor(mode: VideoMode, title: string, customUrl?: unknown) {
  if (mode === 'none') return { videoProvider: null, videoUrl: null };
  if (mode === 'custom') {
    const url = validCustomUrl(customUrl);
    return url ? { videoProvider: 'custom', videoUrl: url } : null;
  }
  return { videoProvider: mode, videoUrl: newJitsiUrl(title) };
}

export const providerLabel = (provider: string | null | undefined) =>
  provider === 'google_meet' ? 'Google Meet' : provider === 'custom' ? 'Online meeting' : provider ? 'Jitsi Meet' : null;

/**
 * Put the meeting into the organizer's Google Calendar with a Google Meet conference.
 * Returns the Meet link, or null when the organizer has no Google connection or Google refused.
 */
export async function createGoogleMeetEvent(organizerId: string, event: { title: string; description: string; start: Date; end: Date; requestId: string }) {
  const account = await getGoogleClientForUser(organizerId);
  if (!account) return null;
  try {
    const res = await google.calendar({ version: 'v3', auth: account.client }).events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: {
        summary: event.title,
        description: event.description,
        start: { dateTime: event.start.toISOString() },
        end: { dateTime: event.end.toISOString() },
        conferenceData: { createRequest: { requestId: event.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      },
    });
    const link = res.data.hangoutLink || res.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;
    return link && validCustomUrl(link) ? link : null;
  } catch (err: any) {
    console.error('Could not create a Google Meet link:', err?.message || err);
    return null;
  }
}
