import express from 'express';
import { prisma } from '../lib/prisma';
import { authenticate, getMembership, isProjectManager } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { audit } from '../lib/audit';

const router = express.Router();

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : 'none');

const PROJECT_ROLES = ['MANAGER', 'EMPLOYEE', 'OBSERVER'] as const;
const ACTIVITY_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const memberInclude = {
  members: {
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, timeZone: true } },
    },
  },
} as const;

class BadRequest extends Error {}

/**
 * Read an optional date field from a request body.
 * undefined = field not sent (leave unchanged), null/'' = clear it, otherwise a valid date.
 */
function parseDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) throw new BadRequest(`${field} is not a valid date`);
  return date;
}

function checkRange(start: Date | null | undefined, end: Date | null | undefined) {
  if (start && end && end < start) throw new BadRequest('End date cannot be before the start date');
}

function handleError(res: express.Response, error: unknown, message: string) {
  if (error instanceof BadRequest) return res.status(400).json({ error: error.message });
  console.error(message, error);
  res.status(500).json({ error: message });
}

// The phase (if any) must belong to the same project.
async function assertPhaseInProject(phaseId: unknown, projectId: string) {
  if (!phaseId) return;
  const phase = await prisma.phase.findFirst({ where: { id: phaseId as string, projectId } });
  if (!phase) throw new BadRequest('Phase does not belong to this project');
}

// The responsible person (if any) must be a project member.
async function assertMember(userId: unknown, projectId: string) {
  if (!userId) return;
  if (!(await getMembership(userId as string, projectId))) {
    throw new BadRequest('The responsible person must be a member of this project');
  }
}

// Get all projects for the logged in user
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const projects = await prisma.project.findMany({
      where: { members: { some: { userId: req.user.userId } } },
      include: {
        ...memberInclude,
        activities: { select: { id: true, title: true } },
        _count: { select: { activities: true, meetings: true } },
      },
    });
    res.json(projects);
  } catch (error) {
    handleError(res, error, 'Failed to fetch projects');
  }
});

// Create a new project (the creator becomes its manager)
router.post('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string') throw new BadRequest('Project name is required');
    const startDate = parseDate(req.body.startDate, 'startDate');
    const endDate = parseDate(req.body.endDate, 'endDate');
    checkRange(startDate, endDate);

    const project = await prisma.project.create({
      data: {
        name,
        description,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        members: { create: { userId: req.user.userId, role: 'MANAGER' } },
      },
    });
    await audit(req, { userId: req.user.userId, projectId: project.id, action: 'PROJECT_CREATED', details: `Created project "${project.name}".` });
    res.status(201).json(project);
  } catch (error) {
    handleError(res, error, 'Failed to create project');
  }
});

// Get a specific project with its phases, activities and linked meetings (everything the Gantt chart needs)
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.id!;
    if (!(await getMembership(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        ...memberInclude,
        phases: { orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] },
        activities: {
          orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
          include: {
            responsible: { select: { id: true, firstName: true, lastName: true } },
            meetings: { select: { id: true, title: true, startDate: true, endDate: true, status: true } },
          },
        },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    res.json(project);
  } catch (error) {
    handleError(res, error, 'Failed to fetch project');
  }
});

// Edit project (managers only)
router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.id!;
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can edit project details' });
    }
    const { name, description } = req.body;
    const startDate = parseDate(req.body.startDate, 'startDate');
    const endDate = parseDate(req.body.endDate, 'endDate');
    checkRange(startDate, endDate);

    const project = await prisma.project.update({
      where: { id: projectId },
      data: { name, description, startDate, endDate },
    });
    await audit(req, { userId: req.user.userId, projectId, action: 'PROJECT_UPDATED', details: `Updated project details (${day(project.startDate)} – ${day(project.endDate)}).` });
    res.json(project);
  } catch (error) {
    handleError(res, error, 'Failed to update project');
  }
});

// Delete project (managers only)
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.id!;
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can delete a project' });
    }
    const deleted = await prisma.project.delete({ where: { id: projectId } });
    await audit(req, { userId: req.user.userId, projectId, action: 'PROJECT_DELETED', details: `Deleted project "${deleted.name}".` });
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'Failed to delete project');
  }
});

// ---------- Phases (managers only) ----------

router.post('/:id/phases', authenticate, async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.id!;
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can add phases' });
    }
    const { name, isMilestone = false } = req.body;
    if (!name || typeof name !== 'string') throw new BadRequest('Phase name is required');
    const startDate = parseDate(req.body.startDate, 'startDate');
    // A milestone is a single date: its end equals its start.
    const endDate = isMilestone ? startDate : parseDate(req.body.endDate, 'endDate');
    if (!startDate || !endDate) throw new BadRequest('Phase start and end dates are required');
    checkRange(startDate, endDate);

    const phase = await prisma.phase.create({
      data: { projectId, name, startDate, endDate, isMilestone: !!isMilestone },
    });
    await audit(req, { userId: req.user.userId, projectId, action: 'PHASE_CREATED', details: `Added ${phase.isMilestone ? 'milestone' : 'phase'} "${phase.name}" (${day(phase.startDate)} – ${day(phase.endDate)}).` });
    res.status(201).json(phase);
  } catch (error) {
    handleError(res, error, 'Failed to create phase');
  }
});

router.put('/:projectId/phases/:phaseId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { projectId, phaseId } = req.params as { projectId: string; phaseId: string };
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can edit phases' });
    }
    const existing = await prisma.phase.findFirst({ where: { id: phaseId, projectId } });
    if (!existing) return res.status(404).json({ error: 'Phase not found' });

    const isMilestone = req.body.isMilestone ?? existing.isMilestone;
    const startDate = parseDate(req.body.startDate, 'startDate') ?? existing.startDate;
    const endDate = isMilestone ? startDate : parseDate(req.body.endDate, 'endDate') ?? existing.endDate;
    checkRange(startDate, endDate);

    const phase = await prisma.phase.update({
      where: { id: phaseId },
      data: { name: req.body.name ?? existing.name, startDate, endDate, isMilestone: !!isMilestone },
    });
    await audit(req, {
      userId: req.user.userId, projectId, action: 'PHASE_UPDATED',
      details: `Changed "${phase.name}": ${day(existing.startDate)} – ${day(existing.endDate)} → ${day(phase.startDate)} – ${day(phase.endDate)}.`,
    });
    res.json(phase);
  } catch (error) {
    handleError(res, error, 'Failed to update phase');
  }
});

// Deleting a phase keeps its activities (they become "unassigned").
router.delete('/:projectId/phases/:phaseId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { projectId, phaseId } = req.params as { projectId: string; phaseId: string };
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can delete phases' });
    }
    const result = await prisma.phase.deleteMany({ where: { id: phaseId, projectId } });
    if (result.count === 0) return res.status(404).json({ error: 'Phase not found' });
    await audit(req, { userId: req.user.userId, projectId, action: 'PHASE_DELETED', details: `Deleted phase ${phaseId}.` });
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'Failed to delete phase');
  }
});

// ---------- Activities ----------

// Create activity (managers only)
router.post('/:id/activities', authenticate, async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.id!;
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can add activities' });
    }
    const { title, description, phaseId, responsibleId, isCritical = false } = req.body;
    if (!title || typeof title !== 'string') throw new BadRequest('Activity title is required');
    const startDate = parseDate(req.body.startDate, 'startDate');
    const endDate = parseDate(req.body.endDate, 'endDate');
    checkRange(startDate, endDate);
    await assertPhaseInProject(phaseId, projectId);
    await assertMember(responsibleId, projectId);

    const activity = await prisma.activity.create({
      data: {
        projectId,
        title,
        description,
        phaseId: phaseId || null,
        responsibleId: responsibleId || null,
        isCritical: !!isCritical,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      },
    });
    await audit(req, { userId: req.user.userId, projectId, action: 'ACTIVITY_CREATED', details: `Added activity "${activity.title}" (${day(activity.startDate)} – ${day(activity.endDate)}).` });
    res.status(201).json(activity);
  } catch (error) {
    handleError(res, error, 'Failed to create activity');
  }
});

/**
 * Update an activity. Managers can change everything; the responsible person can only change its status
 * (so progress on their task shows up on the Gantt chart).
 *
 * When the dates move, the response lists the linked upcoming meetings with a suggested new time
 * (shifted by the same amount), so the user can choose to move them too.
 */
router.put('/:projectId/activities/:activityId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { projectId, activityId } = req.params as { projectId: string; activityId: string };
    const existing = await prisma.activity.findFirst({ where: { id: activityId, projectId } });
    if (!existing) return res.status(404).json({ error: 'Activity not found' });

    const isManager = await isProjectManager(req.user.userId, projectId);
    const isResponsible = existing.responsibleId === req.user.userId;
    const changesOnlyStatus = Object.keys(req.body).every(k => k === 'status');
    if (!isManager && !(isResponsible && changesOnlyStatus)) {
      return res.status(403).json({ error: 'Only managers can update activities' });
    }

    const { title, description, status, phaseId, responsibleId, isCritical } = req.body;
    if (status !== undefined && !ACTIVITY_STATUSES.includes(status)) throw new BadRequest('Invalid activity status');
    if (title !== undefined && (!title || typeof title !== 'string')) throw new BadRequest('Activity title is required');
    const startDate = parseDate(req.body.startDate, 'startDate');
    const endDate = parseDate(req.body.endDate, 'endDate');
    checkRange(startDate === undefined ? existing.startDate : startDate, endDate === undefined ? existing.endDate : endDate);
    if (phaseId !== undefined) await assertPhaseInProject(phaseId, projectId);
    if (responsibleId !== undefined) await assertMember(responsibleId, projectId);

    const activity = await prisma.activity.update({
      where: { id: activityId },
      data: {
        title,
        description,
        status,
        startDate,
        endDate,
        isCritical: isCritical === undefined ? undefined : !!isCritical,
        phaseId: phaseId === undefined ? undefined : phaseId || null,
        responsibleId: responsibleId === undefined ? undefined : responsibleId || null,
      },
    });

    // Suggest moving linked meetings when the activity's start date shifted.
    let meetingSuggestions: { meetingId: string; title: string; currentStart: Date; suggestedStart: Date }[] = [];
    if (startDate && existing.startDate && startDate.getTime() !== existing.startDate.getTime()) {
      const shift = startDate.getTime() - existing.startDate.getTime();
      const meetings = await prisma.meeting.findMany({
        where: {
          activityId,
          startDate: { gte: new Date() },
          status: { in: ['CONFIRMED', 'CALENDAR_SYNCHRONIZED', 'RESCHEDULED'] },
        },
      });
      meetingSuggestions = meetings.map(m => ({
        meetingId: m.id,
        title: m.title,
        currentStart: m.startDate!,
        suggestedStart: new Date(m.startDate!.getTime() + shift),
      }));
    }

    // Plan changes: describe what changed.
    const changes: string[] = [];
    if (existing.status !== activity.status) changes.push(`status ${existing.status} → ${activity.status}`);
    if (day(existing.startDate) !== day(activity.startDate) || day(existing.endDate) !== day(activity.endDate)) {
      changes.push(`dates ${day(existing.startDate)} – ${day(existing.endDate)} → ${day(activity.startDate)} – ${day(activity.endDate)}`);
    }
    if (existing.responsibleId !== activity.responsibleId) changes.push('responsible person changed');
    if (existing.phaseId !== activity.phaseId) changes.push('moved to another phase');
    if (existing.isCritical !== activity.isCritical) changes.push(activity.isCritical ? 'marked critical' : 'no longer critical');
    if (existing.title !== activity.title) changes.push(`renamed from "${existing.title}"`);
    if (changes.length > 0) {
      await audit(req, { userId: req.user.userId, projectId, action: 'ACTIVITY_UPDATED', details: `"${activity.title}": ${changes.join('; ')}.` });
    }

    res.json({ activity, meetingSuggestions, shiftDays: existing.startDate && startDate ? Math.round((startDate.getTime() - existing.startDate.getTime()) / DAY_MS) : 0 });
  } catch (error) {
    handleError(res, error, 'Failed to update activity');
  }
});

// Delete an activity (managers only; the activity must belong to this project)
router.delete('/:projectId/activities/:activityId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { projectId, activityId } = req.params as { projectId: string; activityId: string };
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can delete activities' });
    }
    const result = await prisma.activity.deleteMany({ where: { id: activityId, projectId } });
    if (result.count === 0) return res.status(404).json({ error: 'Activity not found' });
    await audit(req, { userId: req.user.userId, projectId, action: 'ACTIVITY_DELETED', details: `Deleted activity ${activityId}.` });

    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'Failed to delete activity');
  }
});

// ---------- Members ----------

// Add a member to a project (managers only)
router.post('/:id/members', authenticate, async (req: AuthRequest, res) => {
  try {
    const projectId = req.params.id!;
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only project managers can add members' });
    }
    const { newMemberUserId, role = 'EMPLOYEE' } = req.body;
    if (!PROJECT_ROLES.includes(role)) throw new BadRequest('Invalid project role');

    const newMember = await prisma.projectMembership.create({
      data: { userId: newMemberUserId, projectId, role },
      include: { user: { select: { email: true } } },
    });
    await audit(req, { userId: req.user.userId, projectId, action: 'MEMBER_ADDED', details: `Added ${newMember.user.email} as ${role}.` });
    res.status(201).json(newMember);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'User is already a member of this project' });
    }
    handleError(res, error, 'Failed to add member');
  }
});

// Remove a member from a project (managers only)
router.delete('/:projectId/members/:userIdToRemove', authenticate, async (req: AuthRequest, res) => {
  try {
    const { projectId, userIdToRemove } = req.params as { projectId: string; userIdToRemove: string };
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can remove members' });
    }
    const member = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId: userIdToRemove, projectId } },
      include: { user: { select: { email: true } } },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'MANAGER' && (await managerCount(projectId)) <= 1) {
      throw new BadRequest('A project needs at least one manager. Make someone else a manager first.');
    }
    await prisma.projectMembership.delete({ where: { id: member.id } });
    await audit(req, { userId: req.user.userId, projectId, action: 'MEMBER_REMOVED', details: `Removed ${member.user.email} (${member.role}).` });
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'Failed to remove member');
  }
});

const managerCount = (projectId: string) => prisma.projectMembership.count({ where: { projectId, role: 'MANAGER' } });

// Change a member's role (managers only). Every change is recorded with who made it.
router.put('/:projectId/members/:memberUserId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { projectId, memberUserId } = req.params as { projectId: string; memberUserId: string };
    if (!(await isProjectManager(req.user.userId, projectId))) {
      return res.status(403).json({ error: 'Only managers can change roles' });
    }
    const { role } = req.body;
    if (!PROJECT_ROLES.includes(role)) throw new BadRequest('Invalid project role');

    const member = await prisma.projectMembership.findUnique({
      where: { userId_projectId: { userId: memberUserId, projectId } },
      include: { user: { select: { email: true } } },
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === role) return res.json(member);
    if (member.role === 'MANAGER' && (await managerCount(projectId)) <= 1) {
      throw new BadRequest('A project needs at least one manager. Make someone else a manager first.');
    }

    const updated = await prisma.projectMembership.update({ where: { id: member.id }, data: { role } });
    await audit(req, {
      userId: req.user.userId, projectId, action: 'MEMBER_ROLE_CHANGED',
      details: `${member.user.email}: ${member.role} → ${role}.${role === 'MANAGER' ? ' Two-factor login is required from their next login.' : ''}`,
    });
    res.json(updated);
  } catch (error) {
    handleError(res, error, 'Failed to change role');
  }
});

// Reports are generated in the browser; this records that one was generated (who, when, which project).
router.post('/:id/report-log', authenticate, async (req: AuthRequest, res) => {
  const projectId = req.params.id!;
  if (!(await getMembership(req.user.userId, projectId))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const format = String(req.body.format || 'PDF').slice(0, 10);
  await audit(req, { userId: req.user.userId, projectId, action: 'REPORT_EXPORTED', details: `Generated a ${format} project report.` });
  res.json({ success: true });
});

export default router;
