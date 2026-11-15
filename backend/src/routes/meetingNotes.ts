// Meeting agenda (with confirmations) and shared notes for the minutes. Agenda and notes are encrypted at rest.
//
// Who may do what:
//  - see: the meeting's participants and the project's managers
//  - write / change the agenda, open or close notes for participants: the organizer and project managers
//  - confirm the agenda: participants (not observers)
//  - add notes: participants (not observers) while notes are open; the organizer and managers always
//  - edit / delete a note: its author (while they may still add notes), the organizer and managers
import express from 'express';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { open, seal } from '../lib/secureText';
import { authenticate, getMembership } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();
const MAX_AGENDA = 10000;
const MAX_NOTE = 5000;
const person = { select: { id: true, firstName: true, lastName: true } } as const;

async function accessFor(meetingId: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { participants: { select: { userId: true } } } });
  if (!meeting) return null;
  const membership = await getMembership(userId, meeting.projectId);
  const isParticipant = meeting.participants.some(p => p.userId === userId);
  const isManager = membership?.role === 'MANAGER' && !meeting.isPrivate; // private meetings: invited people only
  const isObserver = membership?.role === 'OBSERVER';
  const canView = !!membership && (isParticipant || isManager);
  const canManage = !!membership && (meeting.organizerId === userId || isManager);
  return {
    meeting,
    canView,
    canManage,
    canConfirm: canView && isParticipant && !isObserver,
    canAddNotes: canManage || (canView && isParticipant && !isObserver && meeting.notesOpen),
  };
}

// Everything for the "Agenda & notes" dialog
router.get('/meetings/:meetingId/notes', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const access = await accessFor(req.params.meetingId!, userId);
    if (!access) return res.status(404).json({ error: 'Meeting not found' });
    if (!access.canView) return res.status(403).json({ error: 'You are not part of this meeting' });
    const { meeting } = access;
    const [confirmations, notes] = await Promise.all([
      prisma.agendaConfirmation.findMany({ where: { meetingId: meeting.id }, include: { user: person }, orderBy: { confirmedAt: 'asc' } }),
      prisma.meetingNote.findMany({ where: { meetingId: meeting.id }, include: { author: person }, orderBy: { createdAt: 'asc' } }),
    ]);
    res.json({
      agenda: open(meeting.agenda),
      agendaUpdatedAt: meeting.agendaUpdatedAt,
      notesOpen: meeting.notesOpen,
      participants: meeting.participants.length,
      confirmations: confirmations.map(c => ({ user: c.user, confirmedAt: c.confirmedAt })),
      confirmedByMe: confirmations.some(c => c.userId === userId),
      notes: notes.map(n => ({ id: n.id, author: n.author, content: open(n.content), createdAt: n.createdAt, updatedAt: n.updatedAt })),
      canManage: access.canManage,
      canConfirm: access.canConfirm,
      canAddNotes: access.canAddNotes,
    });
  } catch (error) {
    console.error('Error loading meeting notes:', error);
    res.status(500).json({ error: 'Failed to load the agenda and notes' });
  }
});

// Write or change the agenda (organizer / managers). Earlier confirmations no longer apply and are removed.
router.put('/meetings/:meetingId/agenda', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const access = await accessFor(req.params.meetingId!, userId);
    if (!access) return res.status(404).json({ error: 'Meeting not found' });
    if (!access.canManage) return res.status(403).json({ error: 'Only the organizer or a project manager can change the agenda' });
    const agenda = typeof req.body.agenda === 'string' ? req.body.agenda.trim() : '';
    if (agenda.length > MAX_AGENDA) return res.status(400).json({ error: `The agenda can be up to ${MAX_AGENDA} characters` });

    await prisma.$transaction([
      prisma.meeting.update({ where: { id: access.meeting.id }, data: { agenda: agenda ? seal(agenda) : null, agendaUpdatedAt: agenda ? new Date() : null } }),
      prisma.agendaConfirmation.deleteMany({ where: { meetingId: access.meeting.id } }),
    ]);
    await audit(req, {
      userId, projectId: access.meeting.projectId, action: 'MEETING_AGENDA_UPDATED',
      details: agenda ? `Agenda of "${access.meeting.title}" updated; participants are asked to confirm it again.` : `Agenda of "${access.meeting.title}" removed.`,
    });
    res.json({ agenda: agenda || null });
  } catch (error) {
    console.error('Error saving the agenda:', error);
    res.status(500).json({ error: 'Failed to save the agenda' });
  }
});

// Confirm (or withdraw confirmation of) the current agenda: body.confirmed = true / false
router.post('/meetings/:meetingId/agenda/confirm', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const access = await accessFor(req.params.meetingId!, userId);
    if (!access) return res.status(404).json({ error: 'Meeting not found' });
    if (!access.canConfirm) return res.status(403).json({ error: 'Only participants can confirm the agenda' });
    if (!access.meeting.agenda) return res.status(400).json({ error: 'There is no agenda to confirm yet' });

    if (req.body.confirmed === false) {
      await prisma.agendaConfirmation.deleteMany({ where: { meetingId: access.meeting.id, userId } });
    } else {
      await prisma.agendaConfirmation.upsert({
        where: { meetingId_userId: { meetingId: access.meeting.id, userId } },
        create: { meetingId: access.meeting.id, userId },
        update: {},
      });
      await audit(req, { userId, projectId: access.meeting.projectId, action: 'MEETING_AGENDA_CONFIRMED', details: `Confirmed the agenda of "${access.meeting.title}".` });
    }
    res.json({ confirmed: req.body.confirmed !== false });
  } catch (error) {
    console.error('Error confirming the agenda:', error);
    res.status(500).json({ error: 'Failed to confirm the agenda' });
  }
});

// Allow or stop participants adding notes (organizer / managers): body.notesOpen = true / false
router.put('/meetings/:meetingId/notes-settings', authenticate, async (req: AuthRequest, res) => {
  try {
    const access = await accessFor(req.params.meetingId!, req.user.userId);
    if (!access) return res.status(404).json({ error: 'Meeting not found' });
    if (!access.canManage) return res.status(403).json({ error: 'Only the organizer or a project manager can change this' });
    if (typeof req.body.notesOpen !== 'boolean') return res.status(400).json({ error: 'notesOpen must be true or false' });
    await prisma.meeting.update({ where: { id: access.meeting.id }, data: { notesOpen: req.body.notesOpen } });
    await audit(req, {
      userId: req.user.userId, projectId: access.meeting.projectId, action: 'MEETING_NOTES_SETTINGS',
      details: `Participants ${req.body.notesOpen ? 'may' : 'may no longer'} add notes to "${access.meeting.title}".`,
    });
    res.json({ notesOpen: req.body.notesOpen });
  } catch (error) {
    console.error('Error changing note settings:', error);
    res.status(500).json({ error: 'Failed to change the setting' });
  }
});

const noteText = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

router.post('/meetings/:meetingId/notes', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const access = await accessFor(req.params.meetingId!, userId);
    if (!access) return res.status(404).json({ error: 'Meeting not found' });
    if (!access.canAddNotes) return res.status(403).json({ error: 'You cannot add notes to this meeting' });
    const content = noteText(req.body.content);
    if (!content || content.length > MAX_NOTE) return res.status(400).json({ error: `Write a note (up to ${MAX_NOTE} characters)` });

    const note = await prisma.meetingNote.create({ data: { meetingId: access.meeting.id, authorId: userId, content: seal(content) }, include: { author: person } });
    // The note text is not written to the log (it is confidential and encrypted)
    await audit(req, { userId, projectId: access.meeting.projectId, action: 'MEETING_NOTE_ADDED', details: `Added a note to "${access.meeting.title}".` });
    res.status(201).json({ id: note.id, author: note.author, content, createdAt: note.createdAt, updatedAt: note.updatedAt });
  } catch (error) {
    console.error('Error adding a note:', error);
    res.status(500).json({ error: 'Failed to add the note' });
  }
});

async function noteAccess(noteId: string, userId: string) {
  const note = await prisma.meetingNote.findUnique({ where: { id: noteId } });
  if (!note) return null;
  const access = await accessFor(note.meetingId, userId);
  const allowed = !!access && (access.canManage || (note.authorId === userId && access.canAddNotes));
  return { note, access, allowed };
}

router.patch('/meeting-notes/:noteId', authenticate, async (req: AuthRequest, res) => {
  try {
    const found = await noteAccess(req.params.noteId!, req.user.userId);
    if (!found) return res.status(404).json({ error: 'Note not found' });
    if (!found.allowed) return res.status(403).json({ error: 'You cannot change this note' });
    const content = noteText(req.body.content);
    if (!content || content.length > MAX_NOTE) return res.status(400).json({ error: `Write a note (up to ${MAX_NOTE} characters)` });
    const note = await prisma.meetingNote.update({ where: { id: found.note.id }, data: { content: seal(content) }, include: { author: person } });
    res.json({ id: note.id, author: note.author, content, createdAt: note.createdAt, updatedAt: note.updatedAt });
  } catch (error) {
    console.error('Error changing a note:', error);
    res.status(500).json({ error: 'Failed to change the note' });
  }
});

router.delete('/meeting-notes/:noteId', authenticate, async (req: AuthRequest, res) => {
  try {
    const found = await noteAccess(req.params.noteId!, req.user.userId);
    if (!found) return res.status(404).json({ error: 'Note not found' });
    if (!found.allowed) return res.status(403).json({ error: 'You cannot delete this note' });
    await prisma.meetingNote.delete({ where: { id: found.note.id } });
    await audit(req, {
      userId: req.user.userId, projectId: found.access!.meeting.projectId, action: 'MEETING_NOTE_DELETED',
      details: `Deleted a note from "${found.access!.meeting.title}".`,
    });
    res.json({ message: 'Note deleted' });
  } catch (error) {
    console.error('Error deleting a note:', error);
    res.status(500).json({ error: 'Failed to delete the note' });
  }
});

export default router;
