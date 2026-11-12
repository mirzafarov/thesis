import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../lib/config';
import { getSettings } from '../lib/settings';
import { prisma } from '../lib/prisma';

export interface TokenUser {
  userId: string;
  email: string;
  role: 'ADMIN' | 'USER';
  sid: string;
  mfaSetupRequired: boolean;
}

export interface AuthRequest extends Request<Record<string, string>> {
  user?: any;
}

// While a manager still has to set up two-factor login, only these API paths work.
const ALLOWED_DURING_MFA_SETUP = ['/api/auth/2fa/', '/api/auth/me', '/api/auth/logout', '/api/auth/sessions'];

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let payload: Omit<TokenUser, 'mfaSetupRequired'>;
  try {
    payload = jwt.verify(token, JWT_SECRET) as typeof payload;
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (!payload.sid) {
    return res.status(401).json({ error: 'Your session has ended. Please log in again.', code: 'SESSION_ENDED' });
  }

  try {
    const session = await prisma.session.findUnique({ where: { id: payload.sid } });
    const now = Date.now();
    if (!session || session.userId !== payload.userId || session.revokedAt || session.expiresAt.getTime() < now) {
      return res.status(401).json({ error: 'Your session has ended. Please log in again.', code: 'SESSION_ENDED' });
    }
    const { sessionIdleMinutes } = await getSettings();
    if (now - session.lastSeenAt.getTime() > sessionIdleMinutes * 60e3) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return res.status(401).json({
        error: `You were logged out after ${sessionIdleMinutes} minutes of inactivity. Please log in again.`,
        code: 'SESSION_IDLE',
      });
    }
    // Record activity (at most once a minute, to keep database writes low).
    if (now - session.lastSeenAt.getTime() > 60e3) {
      await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }

    if (session.mfaSetupRequired && !ALLOWED_DURING_MFA_SETUP.some(p => req.originalUrl.startsWith(p))) {
      return res.status(403).json({
        error: 'Your role requires two-factor authentication. Please set it up to continue.',
        code: 'MFA_SETUP_REQUIRED',
      });
    }

    req.user = { ...payload, mfaSetupRequired: session.mfaSetupRequired } satisfies TokenUser;
    next();
  } catch (err) {
    console.error('Authentication check failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Returns the user's membership in a project, or null if they are not a member.
export function getMembership(userId: string, projectId: string) {
  return prisma.projectMembership.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
}

// Project content is visible only to project members (the spec: admins do not get automatic access).
export async function isProjectMember(userId: string, projectId: string) {
  return !!(await getMembership(userId, projectId));
}

// Managers can change the project structure; employees and observers cannot.
export async function isProjectManager(userId: string, projectId: string) {
  const membership = await getMembership(userId, projectId);
  return membership?.role === 'MANAGER';
}
