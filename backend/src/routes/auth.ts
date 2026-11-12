import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma';
import { JWT_SECRET, FRONTEND_URL } from '../lib/config';
import { getSettings, passwordPolicy, checkPasswordPolicy } from '../lib/settings';
import { sendEmail } from '../lib/mailer';
import { emails } from '../lib/emails';
import { createUserToken, consumeUserToken } from '../lib/tokens';
import { audit, clientIp } from '../lib/audit';
import { startSession, isTwoFactorRequired, activeSessionFilter, revokeAllSessions } from '../lib/sessions';
import {
  createPendingSecret, verifyPendingCode, verifyLoginCode,
  generateRecoveryCodes, useRecoveryCode, remainingRecoveryCodes,
} from '../lib/totp';
import { authenticate } from '../middleware/auth';
import { isValidTimeZone } from '../lib/timezones';
import type { AuthRequest } from '../middleware/auth';

const router = express.Router();

const RESET_MINUTES = 30;
const VERIFY_MINUTES = 24 * 60;
const MFA_CHALLENGE_MINUTES = 5;

// Brute-force protection, two layers:
//  1. per account: after N wrong passwords the account is locked for M minutes (settings; an admin can unlock);
//  2. per network (below): a broad limit that stops one IP address from trying many different accounts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // failed attempts per IP per window
  skipSuccessfulRequests: true, // only failed logins count towards the limit
  message: { error: 'Too many failed login attempts from this network. Please wait 15 minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Same protection for the 6-digit code step (a code has only 1,000,000 possibilities).
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Too many wrong codes. Please wait 15 minutes and try again.' },
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


/**
 * How many times this password appears in known data breaches (HaveIBeenPwned, k-anonymity:
 * only the first 5 characters of the SHA-1 hash leave the server). Returns 0 if the service is unavailable.
 */
async function breachCount(password: string): Promise<number> {
  if (!(await getSettings()).checkBreachedPasswords) return 0; // switched off by an administrator
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

const publicUser = (
  user: { id: string; email: string; firstName: string; lastName: string; systemRole: string },
  mfaSetupRequired = false,
) => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.systemRole,
  mfaSetupRequired,
});

// The current password rules, so the sign-up and reset forms can show and check them
router.get('/password-policy', async (_req, res) => {
  res.json(await passwordPolicy());
});

// ---------- Registration and email confirmation ----------

router.post('/register', [
  body('email').isEmail().withMessage('Must be a valid email'),
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

    const policyError = await checkPasswordPolicy(password);
    if (policyError) return res.status(400).json({ error: policyError });
    const breaches = await breachCount(password);
    if (breaches > 0) return res.status(400).json({ error: breachMessage(breaches) });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const { privacyPolicyVersion } = await getSettings();
    const newUser = await prisma.user.create({
      data: {
        email, passwordHash, firstName, lastName, phone,
        // GDPR: record when, and to which version of the rules, the user consented.
        consentAt: new Date(),
        consentVersion: privacyPolicyVersion,
        timeZone: isValidTimeZone(req.body.timeZone) ? req.body.timeZone : null,
      },
    });
    await audit(req, { userId: newUser.id, action: 'REGISTER', details: `Account created; consented to privacy policy v${privacyPolicyVersion}.` });

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

router.post('/verify-email', async (req, res) => {
  try {
    const userId = await consumeUserToken(req.body.token, 'EMAIL_VERIFICATION');
    if (!userId) {
      return res.status(400).json({ error: 'This confirmation link is invalid or has expired. Request a new one from the login page.' });
    }
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await audit(req, { userId, action: 'EMAIL_VERIFIED', details: 'User confirmed their email address.' });
    res.json({ message: 'Your email address is confirmed. You can now log in.' });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Always answers the same way, so it does not reveal which emails exist.
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

// ---------- Password reset ----------

router.post('/forgot-password', emailLimiter, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { email: String(req.body.email || '') } });
    if (user) {
      const token = await createUserToken(user.id, 'PASSWORD_RESET', RESET_MINUTES);
      await sendEmail(emails.passwordReset(user, `${FRONTEND_URL}/reset-password?token=${token}`, RESET_MINUTES));
      await audit(req, { userId: user.id, action: 'PASSWORD_RESET_REQUESTED', details: 'A password reset link was emailed.' });
    }
    res.json({ message: `If an account exists for that email, we sent a link to reset the password. It is valid for ${RESET_MINUTES} minutes.` });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reset-password', async (req: any, res: any) => {
  try {
    const policyError = await checkPasswordPolicy(req.body.password);
    if (policyError) return res.status(400).json({ error: policyError });

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
      // A successful reset also lifts a lockout from wrong passwords (the user proved control of the inbox).
      data: { passwordHash, emailVerifiedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    // Anyone who was logged in with the old password is logged out everywhere.
    await revokeAllSessions(userId);

    await audit(req, { userId, action: 'PASSWORD_RESET', details: 'Password was changed with a reset link; all sessions were ended.' });
    await sendEmail(emails.passwordChanged(user, new Date(), clientIp(req)));

    res.json({ message: 'Your password has been changed. You can now log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Login (step 1: password, step 2: two-factor code) ----------

router.post('/login', loginLimiter, async (req: any, res: any) => {
  try {
    const { email, password } = req.body;

    const settings = await getSettings();
    const user = await prisma.user.findUnique({ where: { email: String(email || '') } });

    // Account temporarily locked after too many wrong passwords
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000));
      await audit(req, { userId: user.id, action: 'LOGIN_WHILE_LOCKED', details: 'Login attempt while the account was locked.' });
      return res.status(423).json({
        error: `Too many failed login attempts. This account is locked for ${minutes} more minute${minutes === 1 ? '' : 's'} to prevent brute-force attacks. You can also reset your password, or ask an administrator to unlock it.`,
        code: 'ACCOUNT_LOCKED',
      });
    }

    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
      if (user) {
        const count = user.failedLoginCount + 1;
        if (count >= settings.loginMaxAttempts) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + settings.loginLockMinutes * 60000) },
          });
          await audit(req, { userId: user.id, action: 'ACCOUNT_LOCKED', details: `Locked for ${settings.loginLockMinutes} minutes after ${count} wrong passwords.` });
        } else {
          await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: count } });
          await audit(req, { userId: user.id, action: 'LOGIN_FAILED', details: `Wrong password (${count} of ${settings.loginMaxAttempts}).` });
        }
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Blocked by an administrator (only revealed after a correct password)
    if (user.blockedAt) {
      await audit(req, { userId: user.id, action: 'LOGIN_BLOCKED', details: 'Login attempt on a blocked account.' });
      return res.status(403).json({ error: 'This account has been blocked by an administrator. Please contact your system administrator.', code: 'ACCOUNT_BLOCKED' });
    }
    if (user.failedLoginCount > 0) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0 } });
    }

    // First login from a browser: remember its time zone (users can change it in Settings).
    if (!user.timeZone && isValidTimeZone(req.body.timeZone)) {
      await prisma.user.update({ where: { id: user.id }, data: { timeZone: req.body.timeZone } });
    }

    // Only after the password is correct, so this does not reveal anything to someone guessing.
    if (!user.emailVerifiedAt) {
      return res.status(403).json({
        error: 'Please confirm your email address first. Check your inbox for the confirmation link.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    if (user.totpEnabledAt) {
      // Password is right; now ask for the code. This short-lived token only works for the next step.
      const mfaToken = jwt.sign({ userId: user.id, purpose: 'mfa-login' }, JWT_SECRET, { expiresIn: `${MFA_CHALLENGE_MINUTES}m` });
      return res.json({ mfaRequired: true, mfaToken });
    }

    const mfaSetupRequired = await isTwoFactorRequired(user.id, user.systemRole);
    const { token } = await startSession(req, user, mfaSetupRequired);
    await audit(req, {
      userId: user.id,
      action: 'LOGIN',
      details: mfaSetupRequired
        ? 'Logged in with password; must set up two-factor authentication before continuing.'
        : 'User successfully logged into the system.',
    });

    res.json({ token, user: publicUser(user, mfaSetupRequired) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login/2fa', codeLimiter, async (req: any, res: any) => {
  try {
    let userId: string;
    try {
      const payload = jwt.verify(String(req.body.mfaToken || ''), JWT_SECRET) as { userId: string; purpose: string };
      if (payload.purpose !== 'mfa-login') throw new Error('wrong purpose');
      userId = payload.userId;
    } catch {
      return res.status(401).json({ error: 'The login step expired. Please enter your email and password again.', code: 'MFA_EXPIRED' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpEnabledAt) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.blockedAt) {
      return res.status(403).json({ error: 'This account has been blocked by an administrator. Please contact your system administrator.', code: 'ACCOUNT_BLOCKED' });
    }

    const code = String(req.body.code || '').trim();
    let method = 'authenticator app';
    let ok = /^\d{6}$/.test(code.replace(/\s/g, '')) && (await verifyLoginCode(user, code));
    if (!ok && code.replace(/[^A-Za-z0-9]/g, '').length === 10) {
      ok = await useRecoveryCode(user.id, code);
      method = 'recovery code';
    }
    if (!ok) {
      await audit(req, { userId: user.id, action: 'LOGIN_2FA_FAILED', details: 'Wrong two-factor code.' });
      return res.status(401).json({ error: 'That code is not correct, or it was already used. Please try the newest code.' });
    }

    const { token } = await startSession(req, user, false);
    const left = method === 'recovery code' ? await remainingRecoveryCodes(user.id) : null;
    await audit(req, {
      userId: user.id,
      action: 'LOGIN',
      details: `Logged in with password and ${method}${left !== null ? ` (${left} recovery codes left)` : ''}.`,
    });

    res.json({ token, user: publicUser(user), recoveryCodesLeft: left });
  } catch (error) {
    console.error('2FA login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Current user, logout, sessions ----------

router.get('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      ...publicUser(user, req.user.mfaSetupRequired),
      phone: user.phone,
      consentAt: user.consentAt,
      consentVersion: user.consentVersion,
      twoFactorEnabled: !!user.totpEnabledAt,
      twoFactorRequired: await isTwoFactorRequired(user.id, user.systemRole),
      recoveryCodesLeft: user.totpEnabledAt ? await remainingRecoveryCodes(user.id) : 0,
      sessionIdleMinutes: (await getSettings()).sessionIdleMinutes,
      timeZone: user.timeZone,
      workdayStart: user.workdayStart,
      workdayEnd: user.workdayEnd,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', authenticate, async (req: AuthRequest, res) => {
  await prisma.session.update({ where: { id: req.user.sid }, data: { revokedAt: new Date() } });
  await audit(req, { userId: req.user.userId, action: 'LOGOUT', details: 'User logged out.' });
  res.json({ success: true });
});

router.get('/sessions', authenticate, async (req: AuthRequest, res) => {
  const sessions = await prisma.session.findMany({
    where: await activeSessionFilter(req.user.userId),
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true },
  });
  res.json(sessions.map(s => ({ ...s, current: s.id === req.user.sid })));
});

// End one of your own sessions (e.g. a forgotten login on another computer).
router.delete('/sessions/:id', authenticate, async (req: AuthRequest, res) => {
  const result = await prisma.session.updateMany({
    where: { id: req.params.id!, userId: req.user.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) return res.status(404).json({ error: 'Session not found' });
  await audit(req, { userId: req.user.userId, action: 'SESSION_REVOKED', details: `Ended session ${req.params.id}.` });
  res.json({ success: true });
});

router.post('/sessions/revoke-others', authenticate, async (req: AuthRequest, res) => {
  await revokeAllSessions(req.user.userId, req.user.sid);
  await audit(req, { userId: req.user.userId, action: 'SESSION_REVOKED', details: 'Ended all other sessions.' });
  res.json({ success: true });
});

// Your own audit trail: logins, security changes and actions you performed.
router.get('/me/activity', authenticate, async (req: AuthRequest, res) => {
  const logs = await prisma.auditLog.findMany({
    where: { userId: req.user.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, action: true, details: true, ipAddress: true, createdAt: true },
  });
  res.json(logs);
});

// ---------- Two-factor setup ----------

// Step 1: create a secret and return the QR code to scan with an authenticator app.
router.post('/2fa/setup', authenticate, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.totpEnabledAt) return res.status(400).json({ error: 'Two-factor authentication is already enabled.' });
    const { secret, qrDataUrl } = await createPendingSecret(user.id, user.email);
    res.json({ qrDataUrl, secret });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Step 2: confirm with the first code from the app; returns the recovery codes (shown once).
router.post('/2fa/enable', authenticate, codeLimiter, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.totpEnabledAt) return res.status(400).json({ error: 'Two-factor authentication is already enabled.' });

    const step = verifyPendingCode(user.totpPendingSecret, String(req.body.code || '').replace(/\s/g, ''));
    if (step === null) {
      return res.status(400).json({ error: 'That code is not correct. Make sure your phone shows the right time and try the newest code.' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step },
    });
    const recoveryCodes = await generateRecoveryCodes(user.id);
    // This session no longer needs to set up 2FA.
    await prisma.session.update({ where: { id: req.user.sid }, data: { mfaSetupRequired: false } });
    await audit(req, { userId: user.id, action: '2FA_ENABLED', details: 'Two-factor authentication was enabled.' });

    res.json({ success: true, recoveryCodes });
  } catch (error) {
    console.error('2FA enable error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// New recovery codes (the old ones stop working). Requires a current code.
router.post('/2fa/recovery-codes', authenticate, codeLimiter, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user?.totpEnabledAt) return res.status(400).json({ error: 'Two-factor authentication is not enabled.' });
  if (!(await verifyLoginCode(user, String(req.body.code || '')))) {
    return res.status(400).json({ error: 'That code is not correct, or it was already used.' });
  }
  const recoveryCodes = await generateRecoveryCodes(user.id);
  await audit(req, { userId: user.id, action: '2FA_RECOVERY_CODES_RENEWED', details: 'New recovery codes were generated.' });
  res.json({ recoveryCodes });
});

// Turn 2FA off (only where the role does not require it). Requires the password and a current code.
router.post('/2fa/disable', authenticate, codeLimiter, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
  if (!user?.totpEnabledAt) return res.status(400).json({ error: 'Two-factor authentication is not enabled.' });
  if (await isTwoFactorRequired(user.id, user.systemRole)) {
    return res.status(403).json({ error: 'Your role (administrator or project manager) requires two-factor authentication, so it cannot be turned off.' });
  }
  if (!(await bcrypt.compare(String(req.body.password || ''), user.passwordHash)) || !(await verifyLoginCode(user, String(req.body.code || '')))) {
    return res.status(400).json({ error: 'The password or the code is not correct.' });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null } }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
  ]);
  await audit(req, { userId: user.id, action: '2FA_DISABLED', details: 'Two-factor authentication was turned off.' });
  res.json({ success: true });
});

// ---------- GDPR ----------

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
        consentAt: true,
        consentVersion: true,
        totpEnabledAt: true,
        createdAt: true,
        updatedAt: true,
        projectMemberships: { include: { project: true } },
        meetingsOrganized: true,
        meetingParticipations: true,
        pollVotes: true,
        aiDrafts: true,
        // Never export the password hash, 2FA secret, recovery codes or (encrypted) calendar tokens.
        calendarAccounts: { select: { provider: true, email: true } },
        sessions: { select: { ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, revokedAt: true } },
        auditLogs: { select: { action: true, ipAddress: true, details: true, createdAt: true } },
        notifications: { select: { type: true, sentAt: true } },
      }
    });
    await audit(req, { userId: req.user.userId, action: 'DATA_EXPORTED', details: 'User downloaded their personal data (GDPR).' });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

router.delete('/me', authenticate, async (req: AuthRequest, res) => {
  try {
    const userId = req.user.userId;

    // Projects must not be left behind empty or without a manager.
    const memberships = await prisma.projectMembership.findMany({
      where: { userId },
      include: { project: { include: { members: { orderBy: { createdAt: 'asc' } } } } },
    });
    const emptyProjects: string[] = [];
    const promotions: { projectId: string; membershipId: string; userId: string }[] = [];
    for (const m of memberships) {
      const others = m.project.members.filter(x => x.userId !== userId);
      if (others.length === 0) {
        emptyProjects.push(m.projectId);
      } else if (m.role === 'MANAGER' && !others.some(x => x.role === 'MANAGER')) {
        // The longest-standing remaining member takes over as manager.
        promotions.push({ projectId: m.projectId, membershipId: others[0]!.id, userId: others[0]!.userId });
      }
    }

    await prisma.$transaction([
      ...promotions.map(p => prisma.projectMembership.update({ where: { id: p.membershipId }, data: { role: 'MANAGER' } })),
      ...promotions.map(p => prisma.auditLog.create({
        data: {
          projectId: p.projectId, action: 'MEMBER_ROLE_CHANGED', ipAddress: clientIp(req),
          details: `User ${p.userId} became MANAGER because the only manager deleted their account.`,
        },
      })),
      prisma.project.deleteMany({ where: { id: { in: emptyProjects } } }),
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
          details: `Account for User ID ${userId} was permanently deleted (GDPR Right to be Forgotten); ${emptyProjects.length} project(s) without other members were deleted.`
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
