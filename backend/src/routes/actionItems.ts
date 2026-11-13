// Meeting to-do lists ("action items"): what was agreed in a meeting, who does it and by when.
//
// Who may do what:
//  - see a meeting's list: its participants and the project's managers
//  - add items: the same people, except project observers (they only read)
//  - edit or delete an item: its creator, the meeting organizer or a project manager
//  - tick an item done / not done: additionally the person it is assigned to
import express from 'express';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { authenticate, getMembership } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { notifyActionItemAssigned } from '../lib/notifications';

const router = express.Router();

const MAX_TITLE = 300;
const person = { select: { id: true, firstName: true, lastName: true } } as const;
const itemInclude = { assignee: person, createdBy: person } as const;

/** "2026-11-20" → midnight UTC of that day; null for empty; undefined for invalid input. */
function parseDay(value: unknown): Date | null | undefined {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? undefined : d;
}

/** The meeting plus what the current user may do with its list. */
async function accessFor(meetingId: string, userId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { participants: { select: { userId: true } } },
  });
  if (!meeting) return null;
  const membership = await getMembership(userId, meeting.projectId);
  const isParticipant = meeting.participants.some(p => p.userId === userId);
  const isManager = membership?.role === 'MANAGER';
  return {
    meeting,
    canView: isParticipant || isManager,
    canAdd: (isParticipant || isManager) && membership?.role !== 'OBSERVER' && !!membership,
    canManageAll: meeting.organizerId === userId || isManager, // edit/delete any item
  };
}

// The current user's open to-dos across all meetings (for the dashboard)
router.get('/action-items/mine', authenticate, async (req: AuthRequest, res) => {
  try {
    const items = await prisma.actionItem.findMany({
      where: { assigneeId: req.user.userId, doneAt: null },
      include: { meeting: { select: { id: true, title: true, project: { select: { name: true } } } } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    res.json(items);
  } catch (error) {
    console.error('Error loading my action items:', error);
    res.status(500).json({ error: 'Failed to load your to-dos' });
  }
});

// A meeting's to-do list
router.get('/meetings/:meetingId/action-items', authenticate, async (req: AuthRequest, res) => {
  try {
    const access = await accessFor(req.params.meetingId!, req.user.userId);
    if (!access) return res.status(404).json({ error: 'Meeting not found' });
    if (!access.canView) return res.status(403).json({ error: 'You are not part of this meeting' });

    const items = await prisma.actionItem.findMany({
      where: { meetingId: access.meeting.id },
      include: itemInclude,
      orderBy: [{ doneAt: { sort: 'asc', nulls: 'first' } }, { dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    res.json({ items, canAdd: access.canAdd, canManageAll: access.canManageAll });
  } catch (error) {
    console.error('Error loading action items:', error);
    res.status(500).json({ error: 'Failed to load the to-do list' });
  }
});

// Add a to-do: body = { title, assigneeId?, dueDate? ("YYYY-MM-DD") }
router.post('/meetings/:meetingId/action-items', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const access = await accessFor(req.params.meetingId!, userId);
    if (!access) return res.status(404).json({ error: 'Meeting not found' });
    if (!access.canAdd) return res.status(403).json({ error: 'You cannot add to-dos to this meeting' });

    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    if (!title || title.length > MAX_TITLE) return res.status(400).json({ error: `Write what needs to be done (up to ${MAX_TITLE} characters)` });
    const dueDate = parseDay(req.body.dueDate);
    if (dueDate === undefined) return res.status(400).json({ error: 'The due date is not valid' });
    const assigneeId = req.body.assigneeId || null;
    if (assigneeId && !access.meeting.participants.some(p => p.userId === assigneeId)) {
      return res.status(400).json({ error: 'A to-do can only be assigned to a participant of the meeting' });
    }

    const item = await prisma.actionItem.create({
      data: { meetingId: access.meeting.id, title, assigneeId, dueDate, createdById: userId },
      include: itemInclude,
    });
    await audit(req, {
      userId, projectId: access.meeting.projectId, action: 'ACTION_ITEM_CREATED',
      details: `To-do "${title}" added to "${access.meeting.title}"${item.assignee ? ` for ${item.assignee.firstName} ${item.assignee.lastName}` : ''}.`,
    });
    if (assigneeId && assigneeId !== userId) notifyActionItemAssigned(item.id);
    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating action item:', error);
    res.status(500).json({ error: 'Failed to add the to-do' });
  }
});

// Change a to-do: body may contain title, assigneeId, dueDate, done (true/false)
router.patch('/action-items/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const item = await prisma.actionItem.findUnique({ where: { id: req.params.id! } });
    if (!item) return res.status(404).json({ error: 'To-do not found' });
    const access = await accessFor(item.meetingId, userId);
    if (!access || !access.canView) return res.status(403).json({ error: 'You are not part of this meeting' });

    const canEdit = access.canAdd && (item.createdById === userId || access.canManageAll);
    const canTick = canEdit || (access.canAdd && item.assigneeId === userId);
    const changesDetails = ['title', 'assigneeId', 'dueDate'].some(k => k in req.body);
    if (changesDetails && !canEdit) return res.status(403).json({ error: 'Only the person who added it, the organizer or a manager can edit this to-do' });
    if ('done' in req.body && !canTick) return res.status(403).json({ error: 'You cannot change this to-do' });

    const data: { title?: string; assigneeId?: string | null; dueDate?: Date | null; doneAt?: Date | null } = {};
    if ('title' in req.body) {
      const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
      if (!title || title.length > MAX_TITLE) return res.status(400).json({ error: `Write what needs to be done (up to ${MAX_TITLE} characters)` });
      data.title = title;
    }
    if ('dueDate' in req.body) {
      const dueDate = parseDay(req.body.dueDate);
      if (dueDate === undefined) return res.status(400).json({ error: 'The due date is not valid' });
      data.dueDate = dueDate;
    }
    if ('assigneeId' in req.body) {
      const assigneeId = req.body.assigneeId || null;
      if (assigneeId && !access.meeting.participants.some(p => p.userId === assigneeId)) {
        return res.status(400).json({ error: 'A to-do can only be assigned to a participant of the meeting' });
      }
      data.assigneeId = assigneeId;
    }
    if ('done' in req.body) data.doneAt = req.body.done ? (item.doneAt ?? new Date()) : null;

    const updated = await prisma.actionItem.update({ where: { id: item.id }, data, include: itemInclude });
    const what = 'done' in req.body && !changesDetails ? (req.body.done ? 'marked done' : 'reopened') : 'edited';
    await audit(req, {
      userId, projectId: access.meeting.projectId, action: 'ACTION_ITEM_UPDATED',
      details: `To-do "${updated.title}" in "${access.meeting.title}" ${what}.`,
    });
    // New person responsible (or a new due date for them): tell them
    const assigneeChanged = 'assigneeId' in data && data.assigneeId && data.assigneeId !== item.assigneeId;
    if (assigneeChanged && data.assigneeId !== userId) notifyActionItemAssigned(updated.id);
    res.json(updated);
  } catch (error) {
    console.error('Error updating action item:', error);
    res.status(500).json({ error: 'Failed to change the to-do' });
  }
});

router.delete('/action-items/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const item = await prisma.actionItem.findUnique({ where: { id: req.params.id! } });
    if (!item) return res.status(404).json({ error: 'To-do not found' });
    const access = await accessFor(item.meetingId, userId);
    if (!access || !access.canAdd || (item.createdById !== userId && !access.canManageAll)) {
      return res.status(403).json({ error: 'Only the person who added it, the organizer or a manager can delete this to-do' });
    }
    await prisma.actionItem.delete({ where: { id: item.id } });
    await audit(req, {
      userId, projectId: access.meeting.projectId, action: 'ACTION_ITEM_DELETED',
      details: `To-do "${item.title}" removed from "${access.meeting.title}".`,
    });
    res.json({ message: 'To-do deleted' });
  } catch (error) {
    console.error('Error deleting action item:', error);
    res.status(500).json({ error: 'Failed to delete the to-do' });
  }
});

export default router;
