// Administrator panel API: security overview, searchable audit log, user management, system settings.
// Administrators manage the system and its users; they do not get access to project content.
import express from 'express';
import type { Response, NextFunction } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { audit } from '../lib/audit';
import { revokeAllSessions } from '../lib/sessions';
import { getSettings, updateSettings, InvalidSettingError, SETTING_LIMITS, DEFAULT_SETTINGS } from '../lib/settings';
import { createUserToken } from '../lib/tokens';
import { sendEmail, mailMode } from '../lib/mailer';
import { emails } from '../lib/emails';
import { FRONTEND_URL } from '../lib/config';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Access forbidden: Admins only' });
  next();
};
router.use(authenticate, requireAdmin);

const DAY = 24 * 3600e3;

/** Groups of audit actions, used by the log filter and the incident list. */
export const ACTION_GROUPS: Record<string, string[]> = {
  security: [
    'LOGIN_FAILED', 'LOGIN_2FA_FAILED', 'ACCOUNT_LOCKED', 'LOGIN_WHILE_LOCKED', 'LOGIN_BLOCKED',
    'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET', '2FA_ENABLED', '2FA_DISABLED', '2FA_RECOVERY_CODES_RENEWED',
    'SESSION_REVOKED', 'DELETE_ACCOUNT',
  ],
  logins: ['LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'LOGIN_2FA_FAILED', 'ACCOUNT_LOCKED', 'LOGIN_WHILE_LOCKED', 'LOGIN_BLOCKED'],
  accounts: ['REGISTER', 'EMAIL_VERIFIED', 'DATA_EXPORTED', 'DELETE_ACCOUNT', 'PASSWORD_RESET', 'PASSWORD_RESET_REQUESTED'],
  projects: [
    'PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_DELETED', 'PHASE_CREATED', 'PHASE_UPDATED', 'PHASE_DELETED',
    'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'ACTIVITY_DELETED', 'ACTIVITY_DEPENDENCIES_CHANGED',
    'MEMBER_ADDED', 'MEMBER_REMOVED', 'MEMBER_ROLE_CHANGED',
  ],
  meetings: [
    'MEETING_POLL_CREATED', 'MEETING_CONFIRMED', 'MEETING_AUTO_CONFIRMED', 'MEETING_RESCHEDULED', 'MEETING_VIDEO_CHANGED',
    'ACTION_ITEM_CREATED', 'ACTION_ITEM_UPDATED', 'ACTION_ITEM_DELETED',
  ],
  reports: ['REPORT_EXPORTED', 'DATA_EXPORTED'],
  admin: [
    'ADMIN_USER_BLOCKED', 'ADMIN_USER_UNBLOCKED', 'ADMIN_USER_UNLOCKED', 'ADMIN_ROLE_CHANGED', 'ADMIN_SESSIONS_REVOKED',
    'ADMIN_2FA_RESET', 'ADMIN_VERIFICATION_RESENT', 'ADMIN_SETTINGS_CHANGED', 'ADMIN_LOGS_EXPORTED',
  ],
};
const INCIDENTS = ['LOGIN_FAILED', 'LOGIN_2FA_FAILED', 'ACCOUNT_LOCKED', 'LOGIN_WHILE_LOCKED', 'LOGIN_BLOCKED', 'PASSWORD_RESET', '2FA_DISABLED', 'DELETE_ACCOUNT'];

// ---------- Overview ----------

router.get('/overview', async (_req, res) => {
  try {
    const now = new Date();
    const since = new Date(Date.now() - DAY);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const settings = await getSettings();
    const count = (where: Prisma.AuditLogWhereInput) => prisma.auditLog.count({ where });

    const [users, admins, verified, with2fa, blocked, locked, activeSessions, loginsToday, failed24h, failed2fa24h, locks24h, resets24h] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { systemRole: 'ADMIN' } }),
      prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
      prisma.user.count({ where: { totpEnabledAt: { not: null } } }),
      prisma.user.count({ where: { blockedAt: { not: null } } }),
      prisma.user.count({ where: { lockedUntil: { gt: now } } }),
      prisma.session.count({
        where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(Date.now() - settings.sessionIdleMinutes * 60e3) } },
      }),
      count({ action: 'LOGIN', createdAt: { gte: startOfToday } }),
      count({ action: 'LOGIN_FAILED', createdAt: { gte: since } }),
      count({ action: 'LOGIN_2FA_FAILED', createdAt: { gte: since } }),
      count({ action: 'ACCOUNT_LOCKED', createdAt: { gte: since } }),
      count({ action: 'PASSWORD_RESET', createdAt: { gte: since } }),
    ]);

    // Managers and admins who should, but do not, use two-factor login
    const missing2fa = await prisma.user.count({
      where: {
        totpEnabledAt: null,
        OR: [{ systemRole: 'ADMIN' }, { projectMemberships: { some: { role: 'MANAGER' } } }],
      },
    });

    // IP addresses with several failed logins in the last 24 hours (possible brute-force attempts)
    const suspicious = await prisma.auditLog.groupBy({
      by: ['ipAddress'],
      where: { action: { in: ['LOGIN_FAILED', 'LOGIN_2FA_FAILED', 'ACCOUNT_LOCKED'] }, createdAt: { gte: since } },
      _count: { _all: true },
      having: { ipAddress: { _count: { gte: 3 } } },
      orderBy: { _count: { ipAddress: 'desc' } },
      take: 10,
    });

    const incidents = await prisma.auditLog.findMany({
      where: { action: { in: INCIDENTS } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });

    res.json({
      users: { total: users, admins, verified, with2fa, blocked, locked, missing2fa },
      activity: { activeSessions, loginsToday, failed24h, failed2fa24h, locks24h, resets24h },
      suspiciousIps: suspicious.map(s => ({ ipAddress: s.ipAddress, attempts: s._count._all })),
      incidents,
      integrations: {
        email: mailMode.startsWith('SMTP') ? 'configured' : 'local outbox (no SMTP)',
        googleCalendar: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? 'configured' : 'not configured',
        ai: process.env.GEMINI_API_KEY ? 'configured' : 'not configured',
      },
      settings,
    });
  } catch (err) {
    console.error('Admin overview failed', err);
    res.status(500).json({ error: 'Failed to load the overview' });
  }
});

// ---------- Audit log ----------

/** Search / type / person / IP / date filter for audit logs (also used by the project log for managers). */
export function logFilter(q: Record<string, unknown>): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  const text = typeof q.q === 'string' ? q.q.trim().slice(0, 100) : '';
  if (text) {
    and.push({
      OR: [
        { action: { contains: text, mode: 'insensitive' } },
        { details: { contains: text, mode: 'insensitive' } },
        { ipAddress: { contains: text } },
        { user: { email: { contains: text, mode: 'insensitive' } } },
      ],
    });
  }
  if (typeof q.group === 'string' && ACTION_GROUPS[q.group]) and.push({ action: { in: ACTION_GROUPS[q.group] } });
  if (typeof q.action === 'string' && q.action) and.push({ action: q.action });
  if (typeof q.userId === 'string' && q.userId) and.push({ userId: q.userId });
  if (typeof q.ip === 'string' && q.ip) and.push({ ipAddress: { contains: q.ip } });
  const from = typeof q.from === 'string' && q.from ? new Date(q.from) : null;
  const to = typeof q.to === 'string' && q.to ? new Date(new Date(q.to).getTime() + DAY) : null; // inclusive end date
  if (from && !Number.isNaN(from.getTime())) and.push({ createdAt: { gte: from } });
  if (to && !Number.isNaN(to.getTime())) and.push({ createdAt: { lt: to } });
  return and.length ? { AND: and } : {};
}

router.get('/logs', async (req, res) => {
  try {
    const where = logFilter(req.query as Record<string, unknown>);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 10), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
    ]);
    res.json({ total, page, pageSize, items, groups: Object.keys(ACTION_GROUPS) });
  } catch (err) {
    console.error('Failed to fetch audit logs', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

/** CSV export of the filtered log (max 10,000 rows), e.g. as evidence for an audit. */
router.get('/logs/export', async (req: AuthRequest, res) => {
  try {
    const where = logFilter(req.query as Record<string, unknown>);
    const rows = await prisma.auditLog.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 10000,
      include: { user: { select: { email: true } } },
    });
    // Quote every field; prefix formula characters so a spreadsheet does not execute them (CSV injection).
    const cell = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [['Time (UTC)', 'User', 'Action', 'Project ID', 'IP address', 'Details'].map(cell).join(',')];
    for (const r of rows) lines.push([r.createdAt.toISOString(), r.user?.email ?? 'system', r.action, r.projectId, r.ipAddress, r.details].map(cell).join(','));
    await audit(req, { userId: req.user.userId, action: 'ADMIN_LOGS_EXPORTED', details: `Exported ${rows.length} audit log entries as CSV.` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="safezone-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + lines.join('\r\n'));
  } catch (err) {
    console.error('Failed to export audit logs', err);
    res.status(500).json({ error: 'Failed to export logs' });
  }
});

// ---------- Users ----------

router.get('/users', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const now = new Date();
    const where: Prisma.UserWhereInput = {
      ...(q ? { OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ] } : {}),
      ...(status === 'blocked' ? { blockedAt: { not: null } } : {}),
      ...(status === 'locked' ? { lockedUntil: { gt: now } } : {}),
      ...(status === 'unverified' ? { emailVerifiedAt: null } : {}),
      ...(status === 'no2fa' ? { totpEnabledAt: null } : {}),
      ...(status === 'admins' ? { systemRole: 'ADMIN' } : {}),
    };
    const settings = await getSettings();
    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true, systemRole: true, createdAt: true,
        emailVerifiedAt: true, totpEnabledAt: true, blockedAt: true, blockedReason: true, lockedUntil: true, failedLoginCount: true,
        timeZone: true,
        _count: { select: { projectMemberships: true } },
        projectMemberships: { where: { role: 'MANAGER' }, select: { id: true } },
        sessions: {
          where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(Date.now() - settings.sessionIdleMinutes * 60e3) } },
          select: { id: true },
        },
        auditLogs: { where: { action: 'LOGIN' }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, ipAddress: true } },
      },
    });
    res.json(users.map(({ projectMemberships, sessions, auditLogs, _count, ...u }) => ({
      ...u,
      projects: _count.projectMemberships,
      managesProjects: projectMemberships.length > 0,
      activeSessions: sessions.length,
      lastLogin: auditLogs[0] ?? null,
      locked: !!u.lockedUntil && u.lockedUntil > now,
    })));
  } catch (err) {
    console.error('Failed to fetch users', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

async function targetUser(req: AuthRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.params.id! } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  return user;
}

router.post('/users/:id/block', async (req: AuthRequest, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  if (user.id === req.user.userId) return res.status(400).json({ error: 'You cannot block your own account.' });
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
  await prisma.user.update({ where: { id: user.id }, data: { blockedAt: new Date(), blockedReason: reason || null } });
  // Blocking takes effect immediately: every session of the user ends.
  await revokeAllSessions(user.id);
  await audit(req, { userId: req.user.userId, action: 'ADMIN_USER_BLOCKED', details: `Blocked ${user.email}${reason ? `: ${reason}` : ''}; all sessions ended.` });
  res.json({ success: true });
});

router.post('/users/:id/unblock', async (req: AuthRequest, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  await prisma.user.update({ where: { id: user.id }, data: { blockedAt: null, blockedReason: null } });
  await audit(req, { userId: req.user.userId, action: 'ADMIN_USER_UNBLOCKED', details: `Unblocked ${user.email}.` });
  res.json({ success: true });
});

router.post('/users/:id/unlock', async (req: AuthRequest, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: null, failedLoginCount: 0 } });
  await audit(req, { userId: req.user.userId, action: 'ADMIN_USER_UNLOCKED', details: `Lifted the login lock of ${user.email}.` });
  res.json({ success: true });
});

router.post('/users/:id/logout', async (req: AuthRequest, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  const keep = user.id === req.user.userId ? req.user.sid : undefined; // never log the admin out of this very session
  await revokeAllSessions(user.id, keep);
  await audit(req, { userId: req.user.userId, action: 'ADMIN_SESSIONS_REVOKED', details: `Ended all sessions of ${user.email}.` });
  res.json({ success: true });
});

router.post('/users/:id/reset-2fa', async (req: AuthRequest, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  if (user.id === req.user.userId) return res.status(400).json({ error: 'Use your own Settings page to change your two-factor login.' });
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null } }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);
  // Anyone holding a session that relied on the old 2FA is logged out; the user sets it up again at the next login.
  await revokeAllSessions(user.id);
  await audit(req, { userId: req.user.userId, action: 'ADMIN_2FA_RESET', details: `Reset two-factor login of ${user.email} (e.g. lost phone).` });
  res.json({ success: true });
});

router.post('/users/:id/resend-verification', async (req: AuthRequest, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  if (user.emailVerifiedAt) return res.status(400).json({ error: 'This email address is already confirmed.' });
  const token = await createUserToken(user.id, 'EMAIL_VERIFICATION', 24 * 60);
  await sendEmail(emails.verifyEmail(user, `${FRONTEND_URL}/verify-email?token=${token}`));
  await audit(req, { userId: req.user.userId, action: 'ADMIN_VERIFICATION_RESENT', details: `Sent a new confirmation email to ${user.email}.` });
  res.json({ success: true });
});

router.put('/users/:id/role', async (req: AuthRequest, res) => {
  const user = await targetUser(req, res);
  if (!user) return;
  const role = req.body.role;
  if (role !== 'ADMIN' && role !== 'USER') return res.status(400).json({ error: 'Role must be ADMIN or USER' });
  if (user.id === req.user.userId) return res.status(400).json({ error: 'You cannot change your own role.' });
  if (user.systemRole === role) return res.json({ success: true });
  if (user.systemRole === 'ADMIN' && (await prisma.user.count({ where: { systemRole: 'ADMIN' } })) <= 1) {
    return res.status(400).json({ error: 'The system needs at least one administrator.' });
  }
  await prisma.user.update({ where: { id: user.id }, data: { systemRole: role } });
  // The role is part of the login token: end the user's sessions so the change applies at once.
  await revokeAllSessions(user.id);
  await audit(req, { userId: req.user.userId, action: 'ADMIN_ROLE_CHANGED', details: `${user.email}: ${user.systemRole} → ${role}.` });
  res.json({ success: true });
});

// ---------- Settings ----------

router.get('/settings', async (_req, res) => {
  const rows = await prisma.systemSetting.findMany({ orderBy: { updatedAt: 'desc' } });
  res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS, limits: SETTING_LIMITS, lastChanged: rows[0]?.updatedAt ?? null });
});

router.put('/settings', async (req: AuthRequest, res) => {
  try {
    const before = await getSettings();
    const { settings, changed } = await updateSettings(req.body ?? {}, req.user.userId);
    if (changed.length) {
      const detail = changed.map(k => `${k}: ${String(before[k as keyof typeof before])} → ${String(settings[k as keyof typeof settings])}`).join('; ');
      await audit(req, { userId: req.user.userId, action: 'ADMIN_SETTINGS_CHANGED', details: detail });
    }
    res.json({ settings, changed });
  } catch (err) {
    if (err instanceof InvalidSettingError) return res.status(400).json({ error: err.message });
    console.error('Failed to save settings', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;
