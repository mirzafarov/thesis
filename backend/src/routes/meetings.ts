import express from 'express';
import { google } from 'googleapis';
import { prisma } from '../lib/prisma';
import { generateText, isAiConfigured } from '../lib/ai';
import { getGoogleClientForUser } from '../lib/google';
import { notifyMeetingConfirmed, notifyMeetingInvitation, notifyMeetingRescheduled } from '../lib/notifications';
import { authenticate, isProjectMember } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { audit } from '../lib/audit';
import { VIDEO_MODES, createGoogleMeetEvent, providerLabel, videoFor } from '../lib/video';
import type { VideoMode } from '../lib/video';
import { icsAttachment } from '../lib/ics';
import { isAiLanguage, meetingContext, writingRules } from '../lib/aiContext';

const router = express.Router();

const VOTE_TYPES = ['YES', 'NO', 'IF_NECESSARY'] as const;
const MEETING_CATEGORIES = ['STRATEGIC', 'PLANNING', 'REVIEW', 'STATUS', 'OTHER'] as const;

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
          include: { user: { select: { id: true, firstName: true, lastName: true, timeZone: true } } },
        },
        polls: { orderBy: { startTime: 'asc' }, include: { votes: { select: { userId: true, vote: true } } } },
        actionItems: { select: { doneAt: true } },
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });

    res.json(
      meetings.map(({ polls, actionItems, ...m }) => ({
        ...m,
        todos: { total: actionItems.length, done: actionItems.filter(a => a.doneAt).length },
        poll: {
          options: polls.map(p => p.startTime.toISOString()),
          // Vote counts per proposed time, so everyone can see how the poll is going
          tallies: polls.map(p => ({
            start: p.startTime.toISOString(),
            yes: p.votes.filter(v => v.vote === 'YES').length,
            ifNecessary: p.votes.filter(v => v.vote === 'IF_NECESSARY').length,
            no: p.votes.filter(v => v.vote === 'NO').length,
          })),
          voted: new Set(polls.flatMap(p => p.votes.map(v => v.userId))).size,
          majority: Math.floor(m.participants.length / 2) + 1,
        },
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
    const { projectId, activityId, title, description, durationMin, proposedSlots = [], participantIds = [], category = 'OTHER', video = 'auto', videoUrl } = req.body;

    if (!(await isProjectMember(userId, projectId))) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!MEETING_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid meeting type' });
    }
    if (!VIDEO_MODES.includes(video)) {
      return res.status(400).json({ error: 'Invalid video call option' });
    }
    const videoData = videoFor(video as VideoMode, String(title || ''), videoUrl);
    if (!videoData) return res.status(400).json({ error: 'The meeting link must be a valid https:// address' });
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
        category,
        ...videoData,
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

    await audit(req, { userId, projectId, action: 'MEETING_POLL_CREATED', details: `Created poll "${title}" with ${proposedSlots.length} time(s); invitations sent to ${invited.size - 1} participant(s).` });
    notifyMeetingInvitation(meeting.id);
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
        polls: { orderBy: { startTime: 'asc' }, include: { votes: true } },
        // Time zones of the participants, to show each proposed time on their clocks too
        participants: { select: { user: { select: { id: true, timeZone: true } } } },
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

    // Doodle-style: once a majority says YES to a time, the meeting is confirmed automatically.
    let autoConfirmed: { startDate: string } | null = null;
    const winner = await majoritySlot(meeting.id);
    if (winner) {
      const confirmed = await confirmMeeting(meeting.id, winner.start);
      if (confirmed) {
        autoConfirmed = { startDate: winner.start.toISOString() };
        await audit(req, {
          userId, projectId: meeting.projectId, action: 'MEETING_AUTO_CONFIRMED',
          details: `"${meeting.title}" confirmed automatically for ${winner.start.toISOString()}: ${winner.yes} of ${winner.total} participants voted YES.`,
        });
      }
    }

    res.status(201).json({ votes: voteRecords, autoConfirmed });
  } catch (error) {
    console.error('Error submitting vote:', error);
    res.status(500).json({ error: 'Failed to submit vote' });
  }
});

/**
 * Confirm a meeting at a time: add it to every connected participant's Google Calendar and email everyone.
 * Returns null if it was already confirmed (e.g. two people triggered it at once).
 */
async function confirmMeeting(meetingId: string, finalStart: Date) {
  const existing = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!existing) return null;
  const finalEnd = new Date(finalStart.getTime() + existing.durationMin * 60000);

  // Only a meeting still in the voting stage can be confirmed (prevents double confirmation).
  const claimed = await prisma.meeting.updateMany({
    where: { id: meetingId, status: 'DRAFT' },
    data: { status: 'CONFIRMED', startDate: finalStart, endDate: finalEnd },
  });
  if (claimed.count === 0) return null;

  let meeting = (await prisma.meeting.findUnique({ where: { id: meetingId }, include: { participants: true } }))!;
  let synced = 0;

  // "auto" video: try a Google Meet link through the organizer's Google Calendar (this also adds the event there);
  // otherwise the Jitsi room created with the poll stays.
  let organizerSynced = false;
  if (meeting.videoProvider === 'auto') {
    const meetLink = await createGoogleMeetEvent(meeting.organizerId, {
      title: meeting.title, description: meeting.description || 'Safe Zone meeting', start: finalStart, end: finalEnd, requestId: meeting.id,
    });
    organizerSynced = !!meetLink;
    if (meetLink) synced++;
    meeting = await prisma.meeting.update({
      where: { id: meetingId },
      data: meetLink ? { videoProvider: 'google_meet', videoUrl: meetLink } : { videoProvider: 'jitsi' },
      include: { participants: true },
    });
  }
  const label = providerLabel(meeting.videoProvider);
  const videoLine = meeting.videoUrl ? `

${label}: ${meeting.videoUrl}` : '';

  for (const participant of meeting.participants) {
    if (organizerSynced && participant.userId === meeting.organizerId) continue; // already has the event with the Meet link
    const account = await getGoogleClientForUser(participant.userId);
    if (!account) continue;
    try {
      await google.calendar({ version: 'v3', auth: account.client }).events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: meeting.title,
          description: (meeting.description || 'Safe Zone meeting') + videoLine,
          ...(meeting.videoUrl ? { location: meeting.videoUrl } : {}),
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

  notifyMeetingConfirmed(meetingId);
  return { meeting: { ...meeting, status: synced > 0 ? 'CALENDAR_SYNCHRONIZED' : 'CONFIRMED' }, synced };
}

/**
 * The time slot that more than half of all participants voted YES for (most YES votes, then earliest),
 * or null if no slot has a majority yet.
 */
async function majoritySlot(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: true, polls: { include: { votes: true } } },
  });
  if (!meeting || meeting.status !== 'DRAFT') return null;
  const needed = Math.floor(meeting.participants.length / 2) + 1;
  const ranked = meeting.polls
    .map(p => ({ start: p.startTime, yes: p.votes.filter(v => v.vote === 'YES').length }))
    .filter(p => p.yes >= needed)
    .sort((a, b) => b.yes - a.yes || a.start.getTime() - b.start.getTime());
  return ranked[0] ? { ...ranked[0], needed, total: meeting.participants.length } : null;
}

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

    const confirmed = await confirmMeeting(meetingId, finalStart);
    if (!confirmed) return res.status(400).json({ error: 'This meeting is already confirmed' });

    await audit(req, { userId: req.user.userId, projectId: confirmed.meeting.projectId, action: 'MEETING_CONFIRMED', details: `Confirmed "${confirmed.meeting.title}" for ${finalStart.toISOString()}.` });
    res.json({ ...confirmed.meeting, calendarSynced: confirmed.synced });
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
    await audit(req, { userId, projectId: meeting.projectId, action: 'MEETING_RESCHEDULED', details: `Moved "${meeting.title}" from ${meeting.startDate?.toISOString() ?? 'no time'} to ${newStart.toISOString()}.` });
    notifyMeetingRescheduled(meetingId, meeting.startDate);
    res.json(updated);
  } catch (error) {
    console.error('Error rescheduling meeting:', error);
    res.status(500).json({ error: 'Failed to reschedule meeting' });
  }
});

// Change the video call of a meeting (organizer or project manager): body.video = jitsi | custom | none (+ videoUrl)
router.put('/:meetingId/video', authenticate, async (req: AuthRequest, res) => {
  try {
    const meeting = await prisma.meeting.findUnique({ where: { id: req.params.meetingId! } });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const userId = req.user.userId;
    const membership = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId, projectId: meeting.projectId } },
    });
    if (meeting.organizerId !== userId && membership?.role !== 'MANAGER') {
      return res.status(403).json({ error: 'Only the organizer or a project manager can change the video call' });
    }
    if (['COMPLETED', 'CANCELLED'].includes(meeting.status)) {
      return res.status(400).json({ error: 'This meeting is over' });
    }
    const { video, videoUrl } = req.body;
    // "auto" only makes sense before confirmation (that is when the Google Meet link is created)
    if (!VIDEO_MODES.includes(video) || (video === 'auto' && meeting.status !== 'DRAFT')) {
      return res.status(400).json({ error: 'Invalid video call option' });
    }
    // Keep an existing room when nothing really changes, so links already sent keep working
    const keep = video === 'jitsi' && meeting.videoProvider === 'jitsi' && meeting.videoUrl;
    const data = keep ? { videoProvider: 'jitsi', videoUrl: meeting.videoUrl } : videoFor(video as VideoMode, meeting.title, videoUrl);
    if (!data) return res.status(400).json({ error: 'The meeting link must be a valid https:// address' });

    const updated = await prisma.meeting.update({ where: { id: meeting.id }, data });
    await audit(req, {
      userId, projectId: meeting.projectId, action: 'MEETING_VIDEO_CHANGED',
      details: `Video call of "${meeting.title}": ${providerLabel(data.videoProvider) ?? 'in person'}.`,
    });
    res.json({ videoProvider: updated.videoProvider, videoUrl: updated.videoUrl });
  } catch (error) {
    console.error('Error changing the video call:', error);
    res.status(500).json({ error: 'Failed to change the video call' });
  }
});

// Download a scheduled meeting as an .ics calendar file (participants only)
router.get('/:meetingId/ics', authenticate, async (req: AuthRequest, res) => {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: req.params.meetingId! },
      include: { participants: { select: { userId: true } }, project: { select: { name: true } }, organizer: { select: { firstName: true, lastName: true } } },
    });
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.participants.some(p => p.userId === req.user.userId)) {
      return res.status(403).json({ error: 'You are not invited to this meeting' });
    }
    if (!meeting.startDate || !meeting.endDate || meeting.status === 'CANCELLED') {
      return res.status(400).json({ error: 'The meeting time is not decided yet' });
    }
    const file = icsAttachment({
      id: meeting.id, title: meeting.title, description: meeting.description, startDate: meeting.startDate, endDate: meeting.endDate,
      updatedAt: meeting.updatedAt, videoUrl: meeting.videoUrl, projectName: meeting.project.name,
      organizerName: `${meeting.organizer.firstName} ${meeting.organizer.lastName}`,
    });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.attachment(file.filename);
    res.send(file.content);
  } catch (error) {
    console.error('Error creating the calendar file:', error);
    res.status(500).json({ error: 'Failed to create the calendar file' });
  }
});

// AI reply to a meeting invitation (accept / decline), written to the organizer.
// body: { responseType: 'ACCEPT' | 'DECLINE', language?: 'en' | 'lt', note?: e.g. "I can only join for 30 minutes" }
router.post('/:id/email-draft', authenticate, async (req: AuthRequest, res) => {
  try {
    const { responseType } = req.body;
    const language = req.body.language ?? 'en';
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
    if (!['ACCEPT', 'DECLINE'].includes(responseType)) {
      return res.status(400).json({ error: 'responseType must be ACCEPT or DECLINE' });
    }
    if (!isAiLanguage(language)) return res.status(400).json({ error: 'Language must be English or Lithuanian' });
    if (!isAiConfigured()) {
      return res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
    }

    const context = await meetingContext(req.params.id!, req.user.userId);
    if (!context) return res.status(404).json({ error: 'Meeting not found' });
    if (!context.meeting.participants.some(p => p.userId === req.user.userId)) {
      return res.status(403).json({ error: 'You are not invited to this meeting' });
    }

    const me = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { firstName: true, lastName: true } });
    const prompt = `You help ${me?.firstName} ${me?.lastName} reply to a meeting invitation from ${context.meeting.organizer.firstName} ${context.meeting.organizer.lastName}. ` +
      `Write a short, professional, polite email that ${responseType === 'ACCEPT' ? 'accepts' : 'declines'} the invitation.\n\n` +
      `Meeting details:\n${context.text}\n\n${writingRules(language)}` +
      (note ? `\n\nThe reply should also mention: ${note}` : '');
    res.json({ draft: await generateText(prompt) });
  } catch (error) {
    console.error('Failed to generate AI email draft:', error);
    res.status(500).json({ error: 'Failed to generate draft' });
  }
});

export default router;
