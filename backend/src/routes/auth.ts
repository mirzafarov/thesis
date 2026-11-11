import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { JWT_SECRET, FRONTEND_URL } from '../lib/config';
import { sendEmail } from '../lib/mailer';
import { emails } from '../lib/emails';
import { createUserToken, consumeUserToken } from '../lib/tokens';
import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

const RESET_MINUTES = 30;
const VERIFY_MINUTES = 24 * 60;

// Brute-force protection: lock out after 5 failed attempts for 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts per IP per window
  skipSuccessfulRequests: true, // only failed logins count towards the limit
  message: { error: 'Too many failed login attempts. Your account has been temporarily locked for 15 minutes to prevent brute-force attacks.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limits emails that anyone can trigger (reset / resend), so the app cannot be used to spam an inbox.
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Letters (any language), spaces, apostrophes and hyphens only
const NAME_PATTERN = /^[\p{L}][\p{L} '\-]{0,49}$/u;

const strongPassword = (field: string) =>
  body(field)
    .isStrongPassword({ minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 })
    .withMessage('Password must be at least 8 characters long and contain an uppercase letter, a lowercase letter, a number, and a special character.');

const clientIp = (req: express.Request) => req.ip || req.socket.remoteAddress || 'unknown';

/**
 * How many times this password appears in known data breaches (HaveIBeenPwned, k-anonymity:
 * only the first 5 characters of the SHA-1 hash leave the server). Returns 0 if the service is unavailable.
 */
async function breachCount(password: string): Promise<number> {
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
    if (!res.ok) return 0;
    for (const line of (await res.text()).split('\n')) {
      const [suffix, count] = line.trim().split(':');
      if (suffix === hash.slice(5)) return Number(count) || 1;
    }
  } catch (err) {
    console.warn('Failed to check HaveIBeenPwned API:', err);
  }
  return 0;
}

const breachMessage = (count: number) =>
  `Security Alert: This password has appeared in a data breach ${count} times. Please choose a different password.`;

async function sendVerificationEmail(user: { id: string; email: string; firstName: string }) {
  const token = await createUserToken(user.id, 'EMAIL_VERIFICATION', VERIFY_MINUTES);
  await sendEmail(emails.verifyEmail(user, `${FRONTEND_URL}/verify-email?token=${token}`));
}

// Register
router.post('/register', [
  body('email').isEmail().withMessage('Must be a valid email'),
  strongPassword('password'),
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

    const breaches = await breachCount(password);
    if (breaches > 0) return res.status(400).json({ error: breachMessage(breaches) });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const newUser = await prisma.user.create({
      data: { email, passwordHash, firstName, lastName, phone },
    });

    // The account can be used once the email address is confirmed.
    await sendVerificationEmail(newUser);

    res.status(201).json({
      message: 'Account created. We sent you an email: click the link in it to confirm your address, then log in.',
      userId: newUser.id,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Confirm email address (link from the confirmation email)
router.post('/verify-email', async (req, res) => {
  try {
    const userId = await consumeUserToken(req.body.token, 'EMAIL_VERIFICATION');
    if (!userId) {
      return res.status(400).json({ error: 'This confirmation link is invalid or has expired. Request a new one from the login page.' });
    }
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await prisma.auditLog.create({
      data: { userId, action: 'EMAIL_VERIFIED', ipAddress: clientIp(req), details: 'User confirmed their email address.' },
    });
    res.json({ message: 'Your email address is confirmed. You can now log in.' });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Send the confirmation email again. Always answers the same way, so it does not reveal which emails exist.
router.post('/resend-verification', emailLimiter, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: String(req.body.email || '') } });
    if (user && !user.emailVerifiedAt) await sendVerificationEmail(user);
    res.json({ message: 'If that account exists and is not confirmed yet, a new confirmation email is on its way.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot password: email a one-time reset link. Always answers the same way (no account enumeration).
router.post('/forgot-password', emailLimiter, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: String(req.body.email || '') } });
    if (user) {
      const token = await createUserToken(user.id, 'PASSWORD_RESET', RESET_MINUTES);
      await sendEmail(emails.passwordReset(user, `${FRONTEND_URL}/reset-password?token=${token}`, RESET_MINUTES));
      await prisma.auditLog.create({
        data: { userId: user.id, action: 'PASSWORD_RESET_REQUESTED', ipAddress: clientIp(req), details: 'A password reset link was emailed.' },
      });
    }
    res.json({ message: `If an account exists for that email, we sent a link to reset the password. It is valid for ${RESET_MINUTES} minutes.` });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password with the one-time token from the email
router.post('/reset-password', [strongPassword('password')], async (req: any, res: any) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const breaches = await breachCount(req.body.password);
    if (breaches > 0) return res.status(400).json({ error: breachMessage(breaches) });

    // Checked after validation, so a weak password does not use up the link.
    const userId = await consumeUserToken(req.body.token, 'PASSWORD_RESET');
    if (!userId) {
      return res.status(400).json({ error: 'This reset link is invalid, already used or expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(req.body.password, await bcrypt.genSalt(10));
    // Opening the link proves the user controls the inbox, so the address also counts as confirmed.
    const user = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, emailVerifiedAt: new Date() },
    });

    const now = new Date();
    await prisma.auditLog.create({
      data: { userId, action: 'PASSWORD_RESET', ipAddress: clientIp(req), details: 'Password was changed with a reset link.' },
    });
    await sendEmail(emails.passwordChanged(user, now, clientIp(req)));

    res.json({ message: 'Your password has been changed. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
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

    // Only after the password is correct, so this does not reveal anything to someone guessing.
    if (!user.emailVerifiedAt) {
      return res.status(403).json({
        error: 'Please confirm your email address first. Check your inbox for the confirmation link.',
        code: 'EMAIL_NOT_VERIFIED',
      });
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
          ipAddress: clientIp(req),
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
        emailVerifiedAt: true,
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
        notifications: { select: { type: true, sentAt: true } },
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
          ipAddress: clientIp(req),
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
