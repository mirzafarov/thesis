import express from 'express';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma';
import { generateText, isAiConfigured } from '../lib/ai';
import { getGoogleClientForUser } from '../lib/google';
import { authenticate, isProjectMember } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

const VOTE_TYPES = ['YES', 'NO', 'IF_NECESSARY'] as const;

// Get all meetings for user
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const meetings = await prisma.meeting.findMany({
      where: {
        OR: [{ organizerId: userId }, { participants: { some: { userId } } }],
      },
      include: {
        project: { select: { id: true, name: true } },
        organizer: { select: { id: true, firstName: true, lastName: true } },
        participants: {
          include: { user: { select: { id: true, firstName: true, lastName: true } } },
        },
        polls: true,
      },
    });

    res.json(
      meetings.map(m => ({
        ...m,
        poll: { options: m.polls.map(p => p.startTime.toISOString()) },
      }))
    );
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
});

// Create a meeting with a poll
router.post('/poll', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const { projectId, activityId, title, description, durationMin, proposedSlots = [], participantIds = [] } = req.body;

    if (!(await isProjectMember(userId, projectId))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!title || !Number.isInteger(durationMin) || durationMin <= 0 || proposedSlots.length === 0) {
      return res.status(400).json({ error: 'Title, a positive duration and at least one time slot are required' });
    }

    // Only project members can be invited; the organizer is always included.
    const members = await prisma.projectMembership.findMany({ where: { projectId }, select: { userId: true } });
    const memberIds = new Set(members.map(m => m.userId));
    const invited = new Set<string>([userId, ...participantIds.filter((id: string) => memberIds.has(id))]);

    const meeting = await prisma.meeting.create({
      data: {
        projectId,
        activityId: activityId || null,
        title,
        description,
        durationMin,
        organizerId: userId,
        status: 'DRAFT',
        participants: { create: [...invited].map(id => ({ userId: id })) },
        polls: {
          create: proposedSlots.map((slot: string) => ({
            startTime: new Date(slot),
            endTime: new Date(new Date(slot).getTime() + durationMin * 60000),
          })),
        },
      },
      include: { polls: true },
    });

    res.status(201).json(meeting);
  } catch (error) {
    console.error('Error creating meeting poll:', error);
    res.status(500).json({ error: 'Failed to create meeting poll' });
  }
});

// Get pending polls for user (draft meetings with at least one slot they haven't voted on)
router.get('/polls/pending', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const pendingMeetings = await prisma.meeting.findMany({
      where: {
        participants: { some: { userId } },
        status: 'DRAFT',
        polls: { some: { NOT: { votes: { some: { userId } } } } },
      },
      include: {
        project: { select: { name: true } },
        polls: { include: { votes: true } },
      },
    });

    res.json(
      pendingMeetings.map(m => ({
        id: m.id,
        meeting: m,
        options: m.polls.map(p => p.startTime.toISOString()),
        polls: m.polls,
      }))
    );
  } catch (error) {
    console.error('Error fetching pending polls:', error);
    res.status(500).json({ error: 'Failed to fetch pending polls' });
  }
});

// Submit (or change) votes: body.votes = [{ selectedSlot, availability }]
router.post('/poll/:meetingId/vote', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const { votes = [] } = req.body;

    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.meetingId! },
      include: { participants: true, polls: true },
    });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.participants.some(p => p.userId === userId)) {
      return res.status(403).json({ error: 'You are not invited to this meeting' });
    }
    if (meeting.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Voting is closed for this meeting' });
    }

    const voteRecords = [];
    for (const v of votes) {
      if (!VOTE_TYPES.includes(v.availability)) continue;
      const slotPoll = meeting.polls.find(p => p.startTime.getTime() === new Date(v.selectedSlot).getTime());
      if (!slotPoll) continue;

      // Upsert so a participant can change their vote instead of hitting a duplicate error.
      voteRecords.push(
        await prisma.pollVote.upsert({
          where: { pollId_userId: { pollId: slotPoll.id, userId } },
          create: { pollId: slotPoll.id, userId, vote: v.availability },
          update: { vote: v.availability },
        })
      );
    }

    res.status(201).json(voteRecords);
  } catch (error) {
    console.error('Error submitting vote:', error);
    res.status(500).json({ error: 'Failed to submit vote' });
  }
});

// Finalize meeting (organizer only) and add it to connected participants' Google Calendars
router.post('/:meetingId/finalize', authenticate, async (req: AuthRequest, res) => {
  try {
    const meetingId = req.params.meetingId!;
    const finalStart = new Date(req.body.finalStartDate);

    const existing = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { polls: true } });
    if (!existing) return res.status(404).json({ error: 'Meeting not found' });
    if (existing.organizerId !== req.user.userId) {
      return res.status(403).json({ error: 'Only the organizer can finalize this meeting' });
    }
    if (!existing.polls.some(p => p.startTime.getTime() === finalStart.getTime())) {
      return res.status(400).json({ error: 'The chosen time must be one of the proposed slots' });
    }

    const finalEnd = new Date(finalStart.getTime() + existing.durationMin * 60000);
    const meeting = await prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'CONFIRMED', startDate: finalStart, endDate: finalEnd },
      include: { participants: true },
    });

    let synced = 0;
    for (const participant of meeting.participants) {
      const account = await getGoogleClientForUser(participant.userId);
      if (!account) continue;
      try {
        await google.calendar({ version: 'v3', auth: account.client }).events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: meeting.title,
            description: meeting.description || 'Safe Zone meeting',
            start: { dateTime: finalStart.toISOString() },
            end: { dateTime: finalEnd.toISOString() },
          },
        });
        synced++;
      } catch (err) {
        console.error('Failed to sync to calendar for user', participant.userId, err);
      }
    }

    if (synced > 0) {
      await prisma.meeting.update({ where: { id: meetingId }, data: { status: 'CALENDAR_SYNCHRONIZED' } });
    }

    res.json({ ...meeting, calendarSynced: synced });
  } catch (error) {
    console.error('Error finalizing meeting:', error);
    res.status(500).json({ error: 'Failed to finalize meeting' });
  }
});

// Move a scheduled meeting to a new start time (organizer or project manager),
// e.g. after its activity was moved on the Gantt chart.
router.put('/:meetingId/reschedule', authenticate, async (req: AuthRequest, res) => {
  try {
    const meetingId = req.params.meetingId!;
    const newStart = new Date(req.body.startDate);
    if (Number.isNaN(newStart.getTime())) return res.status(400).json({ error: 'startDate is not a valid date' });

    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const userId = req.user.userId;
    const membership = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId: meeting.projectId } },
    });
    if (meeting.organizerId !== userId && membership?.role !== 'MANAGER') {
      return res.status(403).json({ error: 'Only the organizer or a project manager can reschedule this meeting' });
    }
    if (!['CONFIRMED', 'CALENDAR_SYNCHRONIZED', 'RESCHEDULED'].includes(meeting.status)) {
      return res.status(400).json({ error: 'Only scheduled meetings can be rescheduled' });
    }

    const updated = await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        startDate: newStart,
        endDate: new Date(newStart.getTime() + meeting.durationMin * 60000),
        status: 'RESCHEDULED',
      },
    });
    res.json(updated);
  } catch (error) {
    console.error('Error rescheduling meeting:', error);
    res.status(500).json({ error: 'Failed to reschedule meeting' });
  }
});

// Generate an AI email reply (accept/decline) to a meeting invitation
router.post('/:id/email-draft', authenticate, async (req: AuthRequest, res) => {
  try {
    const { responseType } = req.body;
    if (!['ACCEPT', 'DECLINE'].includes(responseType)) {
      return res.status(400).json({ error: 'responseType must be ACCEPT or DECLINE' });
    }
    if (!isAiConfigured()) {
      return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }

    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.id! },
      include: { organizer: true, participants: true },
    });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.participants.some(p => p.userId === req.user.userId)) {
      return res.status(403).json({ error: 'You are not invited to this meeting' });
    }

    const prompt = `Write a professional, polite email to ${meeting.organizer.firstName} ${meeting.organizer.lastName} regarding the meeting "${meeting.title}". I want to ${responseType.toLowerCase()} this invitation. Keep it concise.`;
    res.json({ draft: await generateText(prompt) });
  } catch (error) {
    console.error('Failed to generate AI email draft:', error);
    res.status(500).json({ error: 'Failed to generate draft' });
  }
});

export default router;
