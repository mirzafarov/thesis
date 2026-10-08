import express from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

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

export default router;

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

