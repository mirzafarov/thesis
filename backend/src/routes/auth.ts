import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { JWT_SECRET } from '../lib/config';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

// Brute-force protection: lock out after 5 failed attempts for 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts per IP per window
  skipSuccessfulRequests: true, // only failed logins count towards the limit
  message: { error: 'Too many failed login attempts. Your account has been temporarily locked for 15 minutes to prevent brute-force attacks.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Letters (any language), spaces, apostrophes and hyphens only
const NAME_PATTERN = /^[\p{L}][\p{L} '\-]{0,49}$/u;

// Register
router.post('/register', [
  body('email').isEmail().withMessage('Must be a valid email'),
  body('password')
    .isStrongPassword({ minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 })
    .withMessage('Password must be at least 8 characters long and contain an uppercase letter, a lowercase letter, a number, and a special character.'),
  body('firstName').trim().matches(NAME_PATTERN).withMessage('First name may contain only letters, spaces, apostrophes and hyphens'),
  body('lastName').trim().matches(NAME_PATTERN).withMessage('Last name may contain only letters, spaces, apostrophes and hyphens'),
  body('gdprConsent').equals('true').withMessage('You must agree to the Privacy Policy and GDPR rules to register.'),
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
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
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

// Export User Data (GDPR)
router.get('/me/export', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        systemRole: true,
        createdAt: true,
        updatedAt: true,
        projectMemberships: { include: { project: true } },
        meetingsOrganized: true,
        meetingParticipations: true,
        pollVotes: true,
        aiDrafts: true,
        // Never export the password hash or the (encrypted) calendar tokens.
        calendarAccounts: { select: { provider: true, email: true } },
        auditLogs: { select: { action: true, ipAddress: true, details: true, createdAt: true } },
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
    const userId = req.user.userId;
    await prisma.$transaction([
      // Keep the audit trail but detach it from the deleted person.
      prisma.auditLog.updateMany({ where: { userId }, data: { userId: null } }),
      // Meetings require an organizer, so meetings this user organized are removed with them.
      prisma.meeting.deleteMany({ where: { organizerId: userId } }),
      prisma.user.delete({ where: { id: userId } }),
      // The account no longer exists, so this entry is logged without a user.
      prisma.auditLog.create({
        data: {
          action: 'DELETE_ACCOUNT',
          ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
          details: `Account for User ID ${userId} was permanently deleted (GDPR Right to be Forgotten).`
        }
      }),
    ]);
    res.json({ success: true, message: 'Account permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});
export default router;
