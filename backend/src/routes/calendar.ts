import express from 'express';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma';
import { encrypt } from '../lib/crypto';
import { JWT_SECRET, FRONTEND_URL } from '../lib/config';
import { createOAuthClient, getGoogleClientForUser } from '../lib/google';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

async function getBusyIntervals(participantIds: string[], startDate: string, endDate: string) {
  const busy: { start: Date; end: Date }[] = [];
  for (const userId of participantIds) {
    const account = await getGoogleClientForUser(userId);
    if (!account) continue;
    const calendar = google.calendar({ version: 'v3', auth: account.client });
    try {
      const fbRes = await calendar.freebusy.query({
        requestBody: { timeMin: startDate, timeMax: endDate, items: [{ id: 'primary' }] },
      });
      for (const b of fbRes.data.calendars?.['primary']?.busy || []) {
        if (b.start && b.end) busy.push({ start: new Date(b.start), end: new Date(b.end) });
      }
    } catch (e: any) {
      console.error(`Failed to fetch calendar for user ${userId}:`, e.message);
    }
  }
  return busy;
}

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

// 5. Check free/busy times (only busy intervals are returned, never event contents)
router.post('/freebusy', authenticate, async (req: AuthRequest, res) => {
  try {
    const { participantIds = [], startDate, endDate } = req.body;
    res.json({ busy: await getBusyIntervals(participantIds, startDate, endDate) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch free/busy' });
  }
});

// 6. Suggest free slots (09:00–17:00, every 30 minutes, up to 3 slots)
router.post('/suggest', authenticate, async (req: AuthRequest, res) => {
  try {
    const { participantIds = [], durationMin, startDate, endDate } = req.body;
    const busyIntervals = await getBusyIntervals(participantIds, startDate, endDate);

    const suggestedSlots: string[] = [];
    const searchEnd = new Date(endDate);
    let current = new Date(startDate);

    while (current < searchEnd && suggestedSlots.length < 3) {
      const hour = current.getHours();
      if (hour >= 9 && hour <= 16) {
        const slotStart = new Date(current);
        const slotEnd = new Date(current.getTime() + durationMin * 60000);
        const overlaps = busyIntervals.some(b => slotStart < b.end && slotEnd > b.start);

        if (!overlaps && slotEnd.getHours() <= 17) {
          suggestedSlots.push(slotStart.toISOString());
          current = new Date(current.getTime() + Math.max(durationMin * 60000, 60 * 60000));
          continue;
        }
      }
      current = new Date(current.getTime() + 30 * 60000);
    }

    res.json({ slots: suggestedSlots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to suggest slots' });
  }
});

export default router;
