import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';
import { clientIp } from './audit';
import { JWT_SECRET, SESSION_MAX_HOURS } from './config';
import { getSettings } from './settings';

/** Administrators and project managers must use two-factor login (unless switched off in the admin settings). */
export async function isTwoFactorRequired(userId: string, systemRole: string) {
  if (!(await getSettings()).require2faForManagers) return false;
  if (systemRole === 'ADMIN') return true;
  const managerOf = await prisma.projectMembership.count({ where: { userId, role: 'MANAGER' } });
  return managerOf > 0;
}

/** Start a session for a user who passed all login checks; returns the login token for the browser. */
export async function startSession(
  req: Request,
  user: { id: string; email: string; systemRole: string },
  mfaSetupRequired: boolean,
) {
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      ipAddress: clientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      expiresAt: new Date(Date.now() + SESSION_MAX_HOURS * 3600e3),
      mfaSetupRequired,
    },
  });
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.systemRole, sid: session.id },
    JWT_SECRET,
    { expiresIn: `${SESSION_MAX_HOURS}h` }
  );
  return { token, sessionId: session.id };
}

export const idleCutoff = (idleMinutes: number) => new Date(Date.now() - idleMinutes * 60e3);

/** Sessions that are still usable: not ended, not expired, active recently. */
export const activeSessionFilter = async (userId: string) => ({
  userId,
  revokedAt: null,
  expiresAt: { gt: new Date() },
  lastSeenAt: { gt: idleCutoff((await getSettings()).sessionIdleMinutes) },
});

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
