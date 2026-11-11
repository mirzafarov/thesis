import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../lib/config';
import { prisma } from '../lib/prisma';

export interface TokenUser {
  userId: string;
  email: string;
  role: 'ADMIN' | 'USER';
}

export interface AuthRequest extends Request<Record<string, string>> {
  user?: any;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET) as TokenUser;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
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
