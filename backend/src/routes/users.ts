import express from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { isValidTimeZone } from '../lib/timezones';

const router = express.Router();

// Your time zone and working hours (used to find meeting times and to show times in your zone).
router.put('/me/preferences', authenticate, async (req: AuthRequest, res) => {
  try {
    const { timeZone, workdayStart, workdayEnd } = req.body;
    const data: { timeZone?: string; workdayStart?: number; workdayEnd?: number } = {};
    if (timeZone !== undefined) {
      if (!isValidTimeZone(timeZone)) return res.status(400).json({ error: 'Unknown time zone' });
      data.timeZone = timeZone;
    }
    const hour = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 24;
    if (workdayStart !== undefined || workdayEnd !== undefined) {
      if (!hour(workdayStart) || !hour(workdayEnd) || workdayStart >= workdayEnd) {
        return res.status(400).json({ error: 'Working hours must be whole hours between 0 and 24, start before end' });
      }
      data.workdayStart = workdayStart;
      data.workdayEnd = workdayEnd;
    }
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data,
      select: { timeZone: true, workdayStart: true, workdayEnd: true },
    });
    res.json(user);
  } catch (error) {
    console.error('Error saving preferences:', error);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// Search users by email
router.get('/search', authenticate, async (req: AuthRequest, res) => {
  try {
    const { email } = req.query;
    if (!email || typeof email !== 'string') {
      return res.json([]);
    }

    const users = await prisma.user.findMany({
      where: {
        email: {
          contains: email,
          mode: 'insensitive'
        }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true
      },
      take: 5
    });

    res.json(users);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});


// Get Audit Logs (ADMIN only)
router.get('/admin/logs', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access forbidden: Admins only' });
    }
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
      take: 100
    });
    res.json(logs);
  } catch (err) {
    console.error('Failed to fetch audit logs', err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});


// Get All Users (ADMIN only)
router.get('/admin/all', authenticate, async (req: AuthRequest, res) => {
  try {
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access forbidden: Admins only' });
    }
    const users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, email: true, systemRole: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(users);
  } catch (err) {
    console.error('Failed to fetch users', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default router;
