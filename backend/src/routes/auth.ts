import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// Brute-force protection: lock out after 5 failed attempts for 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: { error: 'Too many failed login attempts. Your account has been temporarily locked for 15 minutes to prevent brute-force attacks.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Register
router.post('/register', [
  body('email').isEmail().withMessage('Must be a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('firstName').notEmpty().withMessage('First name is required'),
  body('lastName').notEmpty().withMessage('Last name is required'),
], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { email, password, firstName, lastName, phone } = req.body;

    // Check HaveIBeenPwned database
    const shasum = crypto.createHash('sha1');
    shasum.update(password);
    const hash = shasum.digest('hex').toUpperCase();
    const prefix = hash.substring(0, 5);
    const suffix = hash.substring(5);

    try {
      const pwnedRes = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
      const text = await pwnedRes.text();
      const hashes = text.split('\n');
      for (const line of hashes) {
        const [h, count] = line.split(':');
        if (h === suffix) {
          return res.status(400).json({ error: `Security Alert: This password has appeared in a data breach ${count.trim()} times. Please choose a different password.` });
        }
      }
    } catch (err) {
      console.warn('Failed to check HaveIBeenPwned API:', err);
      // Fail open if the API is down
    }
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        phone
      }
    });

    res.status(201).json({ message: 'User registered successfully', userId: newUser.id });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login
router.post('/login', loginLimiter, async (req: any, res: any) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.systemRole },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Audit Log for successful login
    try {
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN',
          ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
          details: 'User successfully logged into the system.'
        }
      });
    } catch (err) {
      console.error('Audit log failed', err);
    }

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.systemRole
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// Export User Data (GDPR)
router.get('/me/export', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: {
        projectMemberships: { include: { project: true } },
        meetingsOrganized: true,
        calendarAccounts: true
      }
    });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Delete User Account (GDPR Right to be Forgotten)
router.delete('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    // Cannot associate with userId after it's deleted, so log it with 'System' or store details
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_ACCOUNT',
        ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
        details: `Account for User ID ${req.user.userId} was permanently deleted (GDPR Right to be Forgotten).`
      }
    });

    await prisma.user.delete({
      where: { id: req.user.userId }
    });
    res.json({ success: true, message: 'Account permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});


import crypto from 'crypto';

