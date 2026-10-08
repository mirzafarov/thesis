import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// Get all meetings for user
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    
    const meetings = await prisma.meeting.findMany({
      where: {
        OR: [
          { organizerId: userId },
          {
            participants: {
              some: { userId: userId }
            }
          }
        ]
      },
      include: {
        project: { select: { id: true, name: true } },
        organizer: { select: { id: true, firstName: true, lastName: true } },
        participants: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } }
          }
        },
        polls: true
      }
    });

    const formatted = meetings.map(m => ({
      ...m,
      poll: {
        options: m.polls.map(p => p.startTime.toISOString())
      }
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

// Create a meeting with a poll
router.post('/poll', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const { projectId, activityId, title, description, durationMin, proposedSlots, participantIds } = req.body;

    const membership = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId } }
    });

    if (!membership && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Access denied' });

    const meeting = await prisma.meeting.create({
      data: {
        projectId, 
        activityId: activityId || null,
        title, 
        description, 
        durationMin,
        organizerId: userId,
        status: 'DRAFT',
        participants: {
          create: participantIds.map((id: string) => ({ userId: id }))
        },
        polls: {
          create: proposedSlots.map((slot: string) => ({
            startTime: new Date(slot),
            endTime: new Date(new Date(slot).getTime() + durationMin * 60000)
          }))
        }
      },
      include: { polls: true }
    });

    res.status(201).json(meeting);
  } catch (error) {
    console.error('Error creating meeting poll:', error);
    res.status(500).json({ error: 'Failed to create meeting poll' });
  }
});

// Get pending polls for user
router.get('/polls/pending', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    
    // Find meetings in DRAFT status where user is participant
    const pendingMeetings = await prisma.meeting.findMany({
      where: {
        participants: { some: { userId } },
        status: 'DRAFT',
        polls: {
          some: {
            NOT: { votes: { some: { userId } } }
          }
        }
      },
      include: {
        project: { select: { name: true } },
        polls: { include: { votes: true } }
      }
    });

    // Map to the frontend shape: treating each meeting as a "poll" with "options"
    const formatted = pendingMeetings.map(m => ({
      id: m.id,
      meeting: m,
      options: m.polls.map(p => p.startTime.toISOString()),
      polls: m.polls
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching pending polls:', error);
    res.status(500).json({ error: 'Failed to fetch pending polls' });
  }
});

// Submit a vote
router.post('/poll/:meetingId/vote', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const meetingId = req.params.meetingId;
    const { votes } = req.body; // Array of { selectedSlot: string, availability: string }

    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        participants: true,
        polls: true
      }
    });

    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const isParticipant = meeting.participants.some(p => p.userId === userId);
    if (!isParticipant) {
      return res.status(403).json({ error: 'You are not invited to this meeting' });
    }

    // Save multiple votes
    const voteRecords = await Promise.all(
      votes.map(async (v: any) => {
        // Find the actual poll ID for this start time
        const slotPoll = meeting.polls.find(p => new Date(p.startTime).toISOString() === new Date(v.selectedSlot).toISOString());
        if (!slotPoll) return null;
        
        return prisma.pollVote.create({
          data: {
            pollId: slotPoll.id,
            userId,
            vote: v.availability
          }
        });
      })
    );

    res.status(201).json(voteRecords);
  } catch (error) {
    console.error('Error submitting vote:', error);
    res.status(500).json({ error: 'Failed to submit vote' });
  }
});

import { google } from 'googleapis';

// Finalize meeting
router.post('/:meetingId/finalize', authenticate, async (req: AuthRequest, res) => {
  try {
    const { meetingId } = req.params;
    const { finalStartDate } = req.body;

    const meeting = await prisma.meeting.update({
      where: { id: meetingId, organizerId: req.user.userId },
      data: {
        status: 'CONFIRMED',
        startDate: new Date(finalStartDate)
      },
      include: {
        participants: true
      }
    });

    // Auto-Sync to Google Calendar for all connected participants
    for (const participant of meeting.participants) {
      const account = await prisma.calendarAccount.findFirst({
        where: { userId: participant.userId, provider: 'google' }
      });
      if (account) {
        const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        client.setCredentials({ access_token: account.accessToken, refresh_token: account.refreshToken });
        const calendar = google.calendar({ version: 'v3', auth: client });
        
        const endDate = new Date(new Date(finalStartDate).getTime() + meeting.durationMin * 60000);
        
        await calendar.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: meeting.title,
            description: meeting.description || 'ProjexSync Automated Meeting',
            start: { dateTime: new Date(finalStartDate).toISOString() },
            end: { dateTime: endDate.toISOString() },
          }
        }).catch(err => console.error('Failed to sync to calendar for user', participant.userId, err));
      }
    }

    res.json(meeting);
  } catch (error) {
    console.error('Error finalizing meeting:', error);
    res.status(500).json({ error: 'Failed to finalize meeting' });
  }
});

export default router;

// Generate AI Email Draft for a Meeting
router.post('/:id/email-draft', authenticate, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { responseType } = req.body; // 'ACCEPT' or 'DECLINE'
    
    const meeting = await prisma.meeting.findUnique({
      where: { id },
      include: { organizer: true }
    });
    
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    
    const prompt = `Write a professional, polite email to ${meeting.organizer.firstName} ${meeting.organizer.lastName} regarding the meeting "${meeting.title}". I want to ${responseType} this invitation. Keep it concise.`;
    
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash-lite' });
    const result = await model.generateContent(prompt);
    const draft = result.response.text();
    
    res.json({ draft });
  } catch (error) {
    console.error('Failed to generate AI email draft:', error);
    res.status(500).json({ error: 'Failed to generate draft' });
  }
});

