import type { Request } from 'express';
import { prisma } from './prisma';

export const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

/**
 * Record a critical action (who, what, when, from which IP). Never throws:
 * a failed log entry must not break the action itself.
 */
export async function audit(
  req: Request,
  entry: { userId?: string | null; projectId?: string | null; action: string; details?: string }
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        projectId: entry.projectId ?? null,
        action: entry.action,
        details: entry.details ?? null,
        ipAddress: clientIp(req),
      },
    });
  } catch (err) {
    console.error('Audit log failed:', entry.action, err);
  }
}
