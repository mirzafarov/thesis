import express from 'express';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { dayRange, localParts, zoneOf } from '../lib/timezones';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ['STRATEGIC', 'PLANNING', 'REVIEW', 'STATUS', 'OTHER'];
// Meetings that actually take place (polls without a final time are counted separately).
const HELD = ['CONFIRMED', 'CALENDAR_SYNCHRONIZED', 'RESCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;

const listParam = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).map(String).filter(Boolean);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Report data for the projects you are in.
 * Query: projectIds (comma list, default all), from + to (YYYY-MM-DD in your time zone), category, userIds,
 * phaseIds (comma list: only meetings linked to activities of these project phases, and only those activities).
 * Managers see everything in their projects; other members only see their own meetings and hours.
 */
router.get('/', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;
    const { from, to, category } = req.query as Record<string, string | undefined>;
    if (!from || !to || !DATE_KEY.test(from) || !DATE_KEY.test(to) || to < from) {
      return res.status(400).json({ error: 'Choose a valid period (from and to dates)' });
    }
    if (category && category !== 'ALL' && !CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Unknown meeting type' });
    }
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
    const tz = zoneOf(me?.timeZone);
    const start = dayRange(from, tz)[0];
    const end = dayRange(to, tz)[1];

    const memberships = await prisma.projectMembership.findMany({
      where: { userId },
      include: { project: { select: { id: true, name: true, startDate: true, endDate: true } } },
    });
    const wanted = listParam(req.query.projectIds);
    const scoped = memberships.filter(m => wanted.length === 0 || wanted.includes(m.projectId));
    const managerOf = new Set(scoped.filter(m => m.role === 'MANAGER').map(m => m.projectId));
    const projectIds = scoped.map(m => m.projectId);
    const peopleFilter = listParam(req.query.userIds);

    // Phases of the selected projects (for the filter list); unknown or foreign phase ids are ignored
    const phases = await prisma.phase.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true, name: true, projectId: true, project: { select: { name: true } } },
      orderBy: [{ projectId: 'asc' }, { startDate: 'asc' }],
    });
    const phaseFilter = listParam(req.query.phaseIds).filter(id => phases.some(ph => ph.id === id));

    const meetings = await prisma.meeting.findMany({
      where: {
        projectId: { in: projectIds },
        status: { in: [...HELD] },
        startDate: { gte: start, lt: end },
        ...(category && category !== 'ALL' ? { category: category as any } : {}),
        ...(phaseFilter.length ? { activity: { phaseId: { in: phaseFilter } } } : {}),
      },
      include: {
        project: { select: { name: true } },
        activity: { select: { title: true, phase: { select: { name: true } } } },
        participants: { include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
        aiDrafts: { where: { draftType: 'SUMMARY' }, orderBy: { createdAt: 'desc' }, take: 1, select: { content: true } },
      },
      orderBy: { startDate: 'asc' },
    });

    // Non-managers only see meetings they took part in.
    const visible = meetings.filter(m =>
      managerOf.has(m.projectId) || m.participants.some(p => p.userId === userId)
    );
    // People filter: keep meetings with at least one of the selected people.
    const filtered = peopleFilter.length
      ? visible.filter(m => m.participants.some(p => peopleFilter.includes(p.userId)))
      : visible;

    const monthOf = (d: Date) => localParts(d, tz).dateKey.slice(0, 7);
    const months = new Set<string>();

    // Hours per person (and per month)
    const people = new Map<string, { id: string; name: string; email: string; meetings: number; hours: number; byMonth: Record<string, number> }>();
    for (const m of filtered) {
      const month = monthOf(m.startDate!);
      months.add(month);
      for (const p of m.participants) {
        const allowed = managerOf.has(m.projectId) || p.userId === userId;
        if (!allowed || (peopleFilter.length && !peopleFilter.includes(p.userId))) continue;
        const row = people.get(p.userId) ?? {
          id: p.userId, name: `${p.user.firstName} ${p.user.lastName}`, email: p.user.email, meetings: 0, hours: 0, byMonth: {},
        };
        row.meetings++;
        row.hours += m.durationMin / 60;
        row.byMonth[month] = (row.byMonth[month] || 0) + m.durationMin / 60;
        people.set(p.userId, row);
      }
    }

    // Activities that overlap the period (or have no dates yet), with their status
    const activities = await prisma.activity.findMany({
      where: {
        projectId: { in: projectIds },
        ...(phaseFilter.length ? { phaseId: { in: phaseFilter } } : {}),
        OR: [
          { startDate: null },
          { AND: [{ startDate: { lt: end } }, { OR: [{ endDate: null }, { endDate: { gte: start } }] }] },
        ],
      },
      include: {
        phase: { select: { name: true } },
        responsible: { select: { firstName: true, lastName: true } },
        project: { select: { name: true } },
      },
      orderBy: [{ projectId: 'asc' }, { startDate: 'asc' }],
    });
    const openPolls = await prisma.meeting.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, status: 'DRAFT' },
      _count: true,
    });

    const projects = scoped.map(s => {
      const pm = filtered.filter(m => m.projectId === s.projectId);
      const pa = activities.filter(a => a.projectId === s.projectId);
      const count = (status: string) => pa.filter(a => a.status === status).length;
      return {
        id: s.projectId,
        name: s.project.name,
        yourRole: s.role,
        fullAccess: managerOf.has(s.projectId),
        meetings: pm.length,
        meetingHours: round1(pm.reduce((h, m) => h + m.durationMin / 60, 0)),
        personHours: round1(pm.reduce((h, m) => h + (m.durationMin / 60) * m.participants.length, 0)),
        withMinutes: pm.filter(m => m.aiDrafts.length > 0).length,
        openPolls: openPolls.find(o => o.projectId === s.projectId)?._count ?? 0,
        activities: { total: pa.length, completed: count('COMPLETED'), inProgress: count('IN_PROGRESS'), pending: count('PENDING'), delayed: count('DELAYED') },
        byCategory: Object.fromEntries(CATEGORIES.map(c => [c, pm.filter(m => m.category === c).length])),
      };
    });

    res.json({
      period: { from, to, timeZone: tz },
      filters: {
        projectIds, category: category || 'ALL', userIds: peopleFilter, phaseIds: phaseFilter,
        phaseNames: phases.filter(ph => phaseFilter.includes(ph.id)).map(ph => ph.name),
      },
      generatedAt: new Date().toISOString(),
      months: [...months].sort(),
      totals: {
        meetings: filtered.length,
        meetingHours: round1(filtered.reduce((h, m) => h + m.durationMin / 60, 0)),
        personHours: round1([...people.values()].reduce((h, p) => h + p.hours, 0)),
        people: people.size,
        projects: projects.length,
      },
      projects,
      people: [...people.values()]
        .map(p => ({ ...p, hours: round1(p.hours), byMonth: Object.fromEntries(Object.entries(p.byMonth).map(([k, v]) => [k, round1(v)])) }))
        .sort((a, b) => b.hours - a.hours),
      meetings: filtered.map(m => ({
        id: m.id,
        title: m.title,
        project: m.project.name,
        category: m.category,
        start: m.startDate,
        durationMin: m.durationMin,
        status: m.status,
        participants: m.participants.map(p => `${p.user.firstName} ${p.user.lastName}`),
        phase: m.activity?.phase?.name ?? null,
        // "Results": the latest AI meeting summary (minutes), if one was written
        minutes: m.aiDrafts[0]?.content ?? null,
      })),
      activities: activities.map(a => ({
        project: a.project.name,
        phase: a.phase?.name ?? null,
        title: a.title,
        responsible: a.responsible ? `${a.responsible.firstName} ${a.responsible.lastName}` : null,
        status: a.status,
        isCritical: a.isCritical,
        startDate: a.startDate,
        endDate: a.endDate,
      })),
      // Phases you can filter by (of the selected projects)
      availablePhases: phases.map(ph => ({ id: ph.id, name: ph.name, projectId: ph.projectId, projectName: ph.project.name })),
      // People you can filter by: everyone in projects you manage, otherwise only you
      availablePeople: await prisma.user.findMany({
        where: {
          OR: [
            { id: userId },
            { projectMemberships: { some: { projectId: { in: [...managerOf] } } } },
          ],
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
      }),
    });
  } catch (error) {
    console.error('Report error:', error);
    res.status(500).json({ error: 'Failed to build the report' });
  }
});

// Record that a report was exported (generated in the browser) — a critical action for the audit log.
router.post('/log', authenticate, async (req: AuthRequest, res) => {
  const format = ['PDF', 'XLSX'].includes(req.body.format) ? req.body.format : 'PDF';
  const projectIds = listParam(req.body.projectIds);
  const mine = await prisma.projectMembership.findMany({
    where: { userId: req.user.userId, ...(projectIds.length ? { projectId: { in: projectIds } } : {}) },
    select: { projectId: true },
  });
  const period = `${String(req.body.from || '')} – ${String(req.body.to || '')}`.slice(0, 40);
  for (const m of mine) {
    await audit(req, { userId: req.user.userId, projectId: m.projectId, action: 'REPORT_EXPORTED', details: `Exported a ${format} report for ${period}.` });
  }
  res.json({ success: true });
});

export default router;
