import express from 'express';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma';
import { encrypt } from '../lib/crypto';
import { JWT_SECRET, FRONTEND_URL } from '../lib/config';
import { createOAuthClient } from '../lib/google';
import { busyIntervals, findSlots } from '../lib/slots';
import { dayRange, zoneOf } from '../lib/timezones';
import { authenticate, isProjectMember } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

// 1. Generate Auth URL
router.get('/google/auth', authenticate, (req: AuthRequest, res) => {
  // Signed, short-lived state: the callback can trust which user started the connection.
  const state = jwt.sign({ userId: req.user.userId, purpose: 'google-oauth' }, JWT_SECRET, { expiresIn: '10m' });

  const url = createOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
  });

  res.json({ url });
});

// 2. Callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string;
  const state = req.query.state as string;
  if (!code || !state) return res.status(400).send('Missing code or state');

  let userId: string;
  try {
    const payload = jwt.verify(state, JWT_SECRET) as { userId: string; purpose: string };
    if (payload.purpose !== 'google-oauth') throw new Error('Wrong token purpose');
    userId = payload.userId;
  } catch {
    return res.status(400).send('Invalid or expired sign-in link. Please try connecting again.');
  }

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const userInfo = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();

    // Replace any earlier connection instead of piling up duplicates.
    await prisma.calendarAccount.deleteMany({ where: { userId, provider: 'google' } });
    await prisma.calendarAccount.create({
      data: {
        userId,
        provider: 'google',
        email: userInfo.data.email || 'unknown',
        accessToken: encrypt(tokens.access_token || ''),
        refreshToken: encrypt(tokens.refresh_token || ''),
        expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
      },
    });

    res.redirect(`${FRONTEND_URL}/oauth-success`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

// 3. Get connection status
router.get('/status', authenticate, async (req: AuthRequest, res) => {
  try {
    const account = await prisma.calendarAccount.findFirst({
      where: { userId: req.user.userId, provider: 'google' },
    });
    res.json({ connected: !!account, email: account?.email });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// 4. Disconnect Google Calendar
router.delete('/disconnect', authenticate, async (req: AuthRequest, res) => {
  try {
    await prisma.calendarAccount.deleteMany({ where: { userId: req.user.userId, provider: 'google' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect calendar' });
  }
});

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;

/**
 * 5. Find the best meeting times for project members.
 * body: { projectId, participantIds?, durationMin, mode: 'day' | 'range', date? | startDate?+endDate?,
 *         fromHour?, toHour?, count? }  — dates are YYYY-MM-DD in the organizer's time zone.
 * Every participant must be free (Google Calendar + Safe Zone meetings) and within their own working hours.
 */
router.post('/suggest', authenticate, async (req: AuthRequest, res) => {
  try {
    const { projectId, participantIds, durationMin, mode = 'range', date, startDate, endDate, fromHour, toHour } = req.body;
    if (!projectId || !(await isProjectMember(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!Number.isInteger(durationMin) || durationMin < 15 || durationMin > 8 * 60) {
      return res.status(400).json({ error: 'Duration must be between 15 minutes and 8 hours' });
    }
    const hourOk = (h: unknown) => h === undefined || h === null || (Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 24);
    if (!hourOk(fromHour) || !hourOk(toHour) || (fromHour != null && toHour != null && fromHour >= toHour)) {
      return res.status(400).json({ error: 'The time window must be whole hours, with the start before the end' });
    }

    const organizer = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { timeZone: true } });
    const organizerTz = zoneOf(organizer?.timeZone);

    let from: Date, to: Date;
    if (mode === 'day') {
      if (!DATE_KEY.test(date || '')) return res.status(400).json({ error: 'Choose a day' });
      [from, to] = dayRange(date, organizerTz);
    } else {
      if (!DATE_KEY.test(startDate || '') || !DATE_KEY.test(endDate || '') || endDate < startDate) {
        return res.status(400).json({ error: 'Choose a valid date range' });
      }
      from = dayRange(startDate, organizerTz)[0];
      to = dayRange(endDate, organizerTz)[1];
      if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86400e3) {
        return res.status(400).json({ error: `Search at most ${MAX_RANGE_DAYS} days at once` });
      }
    }

    // Only members of this project can be included (privacy: no looking at strangers' calendars).
    const members = await prisma.projectMembership.findMany({
      where: { projectId, ...(Array.isArray(participantIds) && participantIds.length ? { userId: { in: participantIds } } : {}) },
      include: { user: { select: { id: true, firstName: true, lastName: true, timeZone: true, workdayStart: true, workdayEnd: true } } },
    });
    const participants = members.map(m => m.user);
    if (!participants.some(p => p.id === req.user.userId)) {
      const me = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { id: true, firstName: true, lastName: true, timeZone: true, workdayStart: true, workdayEnd: true },
      });
      if (me) participants.push(me);
    }

    const { busy, connected } = await busyIntervals(participants.map(p => p.id), from, to);
    const count = Math.min(Math.max(Number(req.body.count) || 5, 3), 5);
    const result = findSlots({
      participants, busy, durationMin, from, to,
      organizerTimeZone: organizerTz,
      fromHour: fromHour ?? undefined,
      toHour: toHour ?? undefined,
      count,
      perDayLimit: mode === 'day' ? count : 2,
    });

    res.json({
      ...result,
      organizerTimeZone: organizerTz,
      participants: participants.map(p => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        timeZone: zoneOf(p.timeZone),
        timeZoneSet: !!p.timeZone,
        workdayStart: p.workdayStart,
        workdayEnd: p.workdayEnd,
        calendarConnected: connected.has(p.id),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to suggest slots' });
  }
});

export default router;
