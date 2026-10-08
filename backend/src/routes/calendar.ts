import express from 'express';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import crypto from 'crypto';

const router = express.Router();
const prisma = new PrismaClient();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'fallback_32_byte_secret_key_12345';
const IV_LENGTH = 16;

function encryptToken(text: string) {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptToken(text: string) {
  if (!text || !text.includes(':')) return text; // Fallback for old plaintext tokens
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return text;
  }
}

// 1. Generate Auth URL
router.get('/google/auth', authenticate, (req: AuthRequest, res) => {
  const userId = req.user.userId;
  
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: userId // pass userId to the callback
  });

  res.json({ url });
});

// 2. Callback
router.get('/google/callback', async (req, res) => {
  const code = req.query.code as string;
  const userId = req.query.state as string;

  if (!code || !userId) {
    return res.status(400).send('Missing code or state');
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user email from google to store it
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    // Save to Database
    await prisma.calendarAccount.create({
      data: {
        userId,
        provider: 'google',
        email: userInfo.data.email || 'unknown',
        accessToken: encryptToken(tokens.access_token || ''),
        refreshToken: encryptToken(tokens.refresh_token || ''),
        expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000)
      }
    });

    res.redirect('http://localhost:5173/oauth-success');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

// 3. Get connection status
router.get('/status', authenticate, async (req: AuthRequest, res) => {
  try {
    const account = await prisma.calendarAccount.findFirst({
      where: { userId: req.user.userId, provider: 'google' }
    });
    
    res.json({ connected: !!account, email: account?.email });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check status' });
  }
});

export default router;
// 4. Disconnect Google Calendar
router.delete('/disconnect', authenticate, async (req: any, res: any) => {
  try {
    await prisma.calendarAccount.deleteMany({
      where: { userId: req.user.userId, provider: 'google' }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect calendar' });
  }
});


// Helper to get OAuth client for a user
export const getGoogleClientForUser = async (userId: string) => {
  const account = await prisma.calendarAccount.findFirst({ where: { userId, provider: 'google' }});
  if (!account) return null;
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ 
    access_token: decryptToken(account.accessToken), 
    refresh_token: decryptToken(account.refreshToken) 
  });
  return { client, email: account.email };
};

// 5. Check free/busy times
router.post('/freebusy', authenticate, async (req: AuthRequest, res) => {
  try {
    const { participantIds, startDate, endDate } = req.body;
    const busyIntervals: any[] = [];
    
    for (const pId of participantIds) {
      const account = await getGoogleClientForUser(pId);
      if (!account) continue;
      const calendar = google.calendar({ version: 'v3', auth: account.client });
      try {
        const fbRes = await calendar.freebusy.query({
          requestBody: {
            timeMin: startDate, timeMax: endDate,
            items: [{ id: 'primary' }]
          }
        });
        const busy = fbRes.data.calendars?.['primary']?.busy || [];
        busyIntervals.push(...busy);
      } catch (e: any) {
        console.error(`Failed to fetch calendar for user ${pId}:`, e.message);
      }
    }
    res.json({ busy: busyIntervals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch free/busy' });
  }
});



// 6. Suggest Free Slots
router.post('/suggest', authenticate, async (req: AuthRequest, res) => {
  try {
    const { participantIds, durationMin, startDate, endDate } = req.body;
    const busyIntervals: {start: Date, end: Date}[] = [];
    
    for (const pId of participantIds) {
      const account = await getGoogleClientForUser(pId);
      if (!account) continue;
      const calendar = google.calendar({ version: 'v3', auth: account.client });
      try {
        const fbRes = await calendar.freebusy.query({
          requestBody: {
            timeMin: startDate, timeMax: endDate,
            items: [{ id: 'primary' }]
          }
        });
        const busy = fbRes.data.calendars?.['primary']?.busy || [];
        busy.forEach(b => {
          if (b.start && b.end) busyIntervals.push({ start: new Date(b.start), end: new Date(b.end) });
        });
      } catch (e: any) {
        console.error(`Failed to fetch calendar for user ${pId}:`, e.message);
        // If the token is totally invalid, we might want to delete it or just skip
      }
    }
    
    // Find free slots
    const suggestedSlots: string[] = [];
    const searchStart = new Date(startDate);
    const searchEnd = new Date(endDate);
    
    // Simple linear scan every 30 mins between 9 AM and 5 PM
    let current = new Date(searchStart);
    while(current < searchEnd && suggestedSlots.length < 3) {
      const hour = current.getHours();
      if (hour >= 9 && hour <= 16) {
        const slotStart = new Date(current);
        const slotEnd = new Date(current.getTime() + durationMin * 60000);
        
        const isOverlap = busyIntervals.some(b => 
          (slotStart < b.end && slotEnd > b.start)
        );
        
        if (!isOverlap && slotEnd.getHours() <= 17) {
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

