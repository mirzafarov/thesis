// End-to-end test: sessions, inactivity logout, two-factor login, recovery codes, audit log, consent.
// Runs against a backend with SMTP switched off (emails land in backend/mail-outbox). Creates and deletes temporary users.
import { BACKEND as HELPER_BACKEND } from './helpers.mjs';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const API = process.env.API || 'http://localhost:5021';
const BACKEND = HELPER_BACKEND;
const OUTBOX = path.join(BACKEND, 'mail-outbox');
const req = createRequire(path.join(BACKEND, 'package.json'));
const { authenticator } = req('otplib');
const { PrismaClient } = req('@prisma/client');
const prisma = new PrismaClient();
authenticator.options = { step: 30, digits: 6, window: 1 };

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, p, token, body) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'security-e2e (node)', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// TOTP code for a moment offset from now (seconds), e.g. +30 = next 30-second step.
const codeAt = (secret, offsetSec = 0) => authenticator.clone({ epoch: Date.now() + offsetSec * 1000 }).generate(secret);

async function verifyLink(email) {
  for (let i = 0; i < 40; i++) {
    const files = fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : [];
    for (const f of files) {
      const body = fs.readFileSync(path.join(OUTBOX, f), 'utf8');
      if (body.startsWith(`<!-- To: ${email} |`)) {
        const token = body.match(/token=([A-Za-z0-9_-]{20,})/)?.[1];
        if (token) return token;
      }
    }
    await sleep(250);
  }
  return null;
}

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const E = { email: `sec-e-${tag}@example.test`, firstName: 'Seca', lastName: 'Manager' };
const F = { email: `sec-f-${tag}@example.test`, firstName: 'Secf', lastName: 'Employee' };
const live = {}; // a valid token per user, for cleanup

async function signUp(u) {
  await call('POST', '/api/auth/register', null, { ...u, password, gdprConsent: true });
  await call('POST', '/api/auth/verify-email', null, { token: await verifyLink(u.email) });
}

try {
  await signUp(E);
  await signUp(F);

  // ---- Consent + plain login (no projects yet -> 2FA not required) ----
  let r = await call('POST', '/api/auth/login', null, { email: E.email, password });
  check('login without 2FA when role does not require it', r.status === 200 && !!r.data.token && r.data.user.mfaSetupRequired === false);
  let tE = r.data.token; live.E = tE;
  let me = await call('GET', '/api/auth/me', tE);
  check('consent time and version stored', !!me.data.consentAt && me.data.consentVersion === '1.0');
  check('2FA not required yet', me.data.twoFactorRequired === false && me.data.twoFactorEnabled === false);

  // ---- Becoming a manager -> 2FA required from next login ----
  const p = await call('POST', '/api/projects', tE, { name: `Sec test ${tag}` });
  const pid = p.data.id;
  check('existing session keeps working right after becoming manager', (await call('GET', '/api/projects', tE)).status === 200);
  r = await call('POST', '/api/auth/login', null, { email: E.email, password });
  check('next login flags 2FA setup as required', r.data.user?.mfaSetupRequired === true);
  const tSetup = r.data.token; live.E = tSetup;
  r = await call('GET', '/api/projects', tSetup);
  check('app blocked until 2FA is set up', r.status === 403 && r.data.code === 'MFA_SETUP_REQUIRED');
  check('/me still allowed during setup', (await call('GET', '/api/auth/me', tSetup)).status === 200);

  // ---- 2FA setup ----
  r = await call('POST', '/api/auth/2fa/setup', tSetup);
  check('setup returns QR code and key', r.status === 200 && r.data.qrDataUrl.startsWith('data:image/png;base64,') && r.data.secret.length >= 16);
  const secret = r.data.secret;
  check('wrong code rejected at setup', (await call('POST', '/api/auth/2fa/enable', tSetup, { code: '000000' })).status === 400);
  r = await call('POST', '/api/auth/2fa/enable', tSetup, { code: codeAt(secret) });
  check('correct code enables 2FA and returns 10 recovery codes', r.status === 200 && r.data.recoveryCodes?.length === 10);
  const recovery = r.data.recoveryCodes;
  check('same session unlocked after setup', (await call('GET', '/api/projects', tSetup)).status === 200);
  const dbUser = await prisma.user.findUnique({ where: { email: E.email } });
  check('2FA secret stored encrypted (not the plain key)', !!dbUser.totpSecret && !dbUser.totpSecret.includes(secret) && dbUser.totpSecret.split(':').length === 3);

  // ---- Logout ends the session ----
  await call('POST', '/api/auth/logout', tE);
  check('logged-out token no longer works', (await call('GET', '/api/auth/me', tE)).status === 401);

  // ---- Two-step login ----
  r = await call('POST', '/api/auth/login', null, { email: E.email, password });
  check('password step asks for a code (no token yet)', r.status === 200 && r.data.mfaRequired === true && !r.data.token);
  const mfaToken = r.data.mfaToken;
  check('challenge token is not a login token', (await call('GET', '/api/auth/me', mfaToken)).status === 401);
  r = await call('POST', '/api/auth/login/2fa', null, { mfaToken, code: '123456' });
  check('wrong code rejected', r.status === 401);
  const next = codeAt(secret, 30); // the next 30-second step (the current one was used to enable 2FA)
  r = await call('POST', '/api/auth/login/2fa', null, { mfaToken, code: next });
  check('correct code logs in', r.status === 200 && !!r.data.token);
  const tE2 = r.data.token; live.E = tE2;
  r = await call('POST', '/api/auth/login/2fa', null, { mfaToken, code: next });
  check('same code cannot be used twice (replay)', r.status === 401);

  // Recovery code
  r = await call('POST', '/api/auth/login', null, { email: E.email, password });
  r = await call('POST', '/api/auth/login/2fa', null, { mfaToken: r.data.mfaToken, code: recovery[0].toLowerCase() });
  check('recovery code logs in (case-insensitive)', r.status === 200 && r.data.recoveryCodesLeft === 9);
  const tE3 = r.data.token;
  r = await call('POST', '/api/auth/login', null, { email: E.email, password });
  r = await call('POST', '/api/auth/login/2fa', null, { mfaToken: r.data.mfaToken, code: recovery[0] });
  check('recovery code works only once', r.status === 401);


  // ---- Sessions ----
  r = await call('GET', '/api/auth/sessions', tE2);
  check('session list shows all active sessions, current marked', r.data.length === 3 && r.data.filter(s => s.current).length === 1 && r.data.every(s => s.userAgent));
  const other = r.data.find(s => !s.current);
  await call('DELETE', `/api/auth/sessions/${other.id}`, tE2);
  check('ended session stops working', (await call('GET', '/api/auth/me', tE3)).status === 401);
  check('cannot end another user\'s session', (await call('DELETE', `/api/auth/sessions/${other.id}`, null)).status === 401);

  // ---- Inactivity ----
  const sid = JSON.parse(Buffer.from(tE2.split('.')[1], 'base64url').toString()).sid;
  await prisma.session.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - 31 * 60e3) } });
  r = await call('GET', '/api/auth/me', tE2);
  check('session ends after 30 minutes of inactivity', r.status === 401 && r.data.code === 'SESSION_IDLE', r.data?.error);
  check('...and stays ended', (await call('GET', '/api/auth/me', tE2)).status === 401);

  // New E session for the rest
  r = await call('POST', '/api/auth/login', null, { email: E.email, password });
  r = await call('POST', '/api/auth/login/2fa', null, { mfaToken: r.data.mfaToken, code: recovery[1] });
  const tE4 = r.data.token; live.E = tE4;

  // ---- Employee: optional 2FA can be turned off ----
  r = await call('POST', '/api/auth/login', null, { email: F.email, password });
  let tF = r.data.token; live.F = tF;
  await call('POST', `/api/projects/${pid}/members`, tE4, { newMemberUserId: r.data.user.id, role: 'EMPLOYEE' });
  const fId = r.data.user.id;
  const fSecret = (await call('POST', '/api/auth/2fa/setup', tF)).data.secret;
  await call('POST', '/api/auth/2fa/enable', tF, { code: codeAt(fSecret) });
  check('employee can turn 2FA off with password + code', (await call('POST', '/api/auth/2fa/disable', tF, { password, code: codeAt(fSecret, 30) })).status === 200);

  // ---- Roles + audit ----
  check('last manager cannot demote themselves', (await call('PUT', `/api/projects/${pid}/members/${dbUser.id}`, tE4, { role: 'EMPLOYEE' })).status === 400);
  check('employee cannot change roles', (await call('PUT', `/api/projects/${pid}/members/${dbUser.id}`, tF, { role: 'EMPLOYEE' })).status === 403);
  check('manager changes a role', (await call('PUT', `/api/projects/${pid}/members/${fId}`, tE4, { role: 'OBSERVER' })).status === 200);
  const act = await call('POST', `/api/projects/${pid}/activities`, tE4, { title: 'Draft chapter', startDate: '2026-12-01', endDate: '2026-12-05' });
  await call('PUT', `/api/projects/${pid}/activities/${act.data.id}`, tE4, { startDate: '2026-12-03', endDate: '2026-12-08', status: 'IN_PROGRESS' });
  await call('POST', `/api/projects/${pid}/report-log`, tE4, { format: 'PDF' });

  const logs = await prisma.auditLog.findMany({ where: { projectId: pid }, orderBy: { createdAt: 'asc' } });
  const actions = logs.map(l => l.action);
  check('project actions logged with project id', ['PROJECT_CREATED', 'MEMBER_ADDED', 'MEMBER_ROLE_CHANGED', 'ACTIVITY_CREATED', 'ACTIVITY_UPDATED', 'REPORT_EXPORTED'].every(a => actions.includes(a)), actions.join(','));
  const roleLog = logs.find(l => l.action === 'MEMBER_ROLE_CHANGED');
  check('role change records who did it and old → new role', roleLog?.userId === dbUser.id && /EMPLOYEE → OBSERVER/.test(roleLog.details));
  const planLog = logs.find(l => l.action === 'ACTIVITY_UPDATED');
  check('plan change describes what changed', /status PENDING → IN_PROGRESS/.test(planLog?.details) && /2026-12-01 – 2026-12-05 → 2026-12-03 – 2026-12-08/.test(planLog?.details), planLog?.details);

  r = await call('GET', '/api/auth/me/activity', tE4);
  const mine = r.data.map(a => a.action);
  check('own activity shows logins, 2FA events, failures', ['LOGIN', '2FA_ENABLED', 'LOGIN_2FA_FAILED', 'LOGOUT', 'SESSION_REVOKED'].every(a => mine.includes(a)), [...new Set(mine)].join(','));
  check('own activity only contains own entries', (await prisma.auditLog.count({ where: { id: { in: r.data.map(a => a.id) }, NOT: { userId: dbUser.id } } })) === 0);

  // ---- Export has no secrets ----
  const exp = JSON.stringify((await call('GET', '/api/auth/me/export', tE4)).data);
  check('data export has no secrets', !/passwordHash|totpSecret|codeHash|accessToken/.test(exp) && exp.includes('consentVersion'));

  // ---- Password reset ends all sessions ----
  await call('POST', '/api/auth/forgot-password', null, { email: F.email });
  await sleep(500);
  const resetToken = fs.readdirSync(OUTBOX).map(f => fs.readFileSync(path.join(OUTBOX, f), 'utf8'))
    .filter(b => b.startsWith(`<!-- To: ${F.email} |`) && b.includes('reset-password?token='))
    .map(b => b.match(/token=([A-Za-z0-9_-]{20,})/)[1]).pop();
  await call('POST', '/api/auth/reset-password', null, { token: resetToken, password: password + 'x' });
  check('password reset logs out all sessions', (await call('GET', '/api/auth/me', tF)).status === 401);
  r = await call('POST', '/api/auth/login', null, { email: F.email, password: password + 'x' });
  live.F = r.data.token;

  // Last failure-counting call (the code limiter allows 5 wrong codes per 15 minutes).
  check('manager cannot turn 2FA off', (await call('POST', '/api/auth/2fa/disable', tE4, { password, code: codeAt(secret, 60) })).status === 403);
  await call('DELETE', `/api/projects/${pid}`, tE4);
} catch (e) {
  fail++; console.log('FAIL  unexpected error', e);
} finally {
  for (const [k, t] of Object.entries(live)) {
    const d = await call('DELETE', '/api/auth/me', t);
    if (d.status !== 200) console.log(`cleanup: could not delete user ${k} (${d.status}); removing directly`);
  }
  // Fallback cleanup straight in the database
  const left = await prisma.user.findMany({ where: { email: { contains: `-${tag}@example.test` } }, select: { id: true } });
  for (const u of left) {
    await prisma.auditLog.updateMany({ where: { userId: u.id }, data: { userId: null } });
    await prisma.meeting.deleteMany({ where: { organizerId: u.id } });
    await prisma.project.deleteMany({ where: { members: { every: { userId: u.id } }, name: { contains: tag } } });
    await prisma.user.delete({ where: { id: u.id } });
  }
  let removed = 0;
  for (const f of fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []) {
    if (fs.readFileSync(path.join(OUTBOX, f), 'utf8').split('\n')[0].includes(`-${tag}@example.test`)) { fs.unlinkSync(path.join(OUTBOX, f)); removed++; }
  }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed (removed ${removed} test emails, ${left.length} users needed direct cleanup)`);
}

process.exitCode = fail > 0 ? 1 : 0;
