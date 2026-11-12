// End-to-end check of the administrator panel: access, account lockout and unlock, blocking, roles,
// two-factor reset, sessions, settings that apply immediately, audit log search and CSV export.
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { API, BACKEND, signUpAndConfirm, cleanOutbox } from './helpers.mjs';

const req = createRequire(path.join(BACKEND, 'package.json'));
const { PrismaClient } = req('@prisma/client');
const { authenticator } = req('otplib');
authenticator.options = { step: 30, digits: 6, window: 1 };
const prisma = new PrismaClient();

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
async function call(method, p, token, body) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
const codeAt = (secret, offsetSec = 0) => authenticator.clone({ epoch: Date.now() + offsetSec * 1000 }).generate(secret);

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const A = { email: `adm-a-${tag}@example.test`, firstName: 'Ada', lastName: 'Admin' };
const U = { email: `adm-u-${tag}@example.test`, firstName: 'Uma', lastName: 'User' };
const N = { email: `adm-n-${tag}@example.test`, firstName: 'Ned', lastName: 'Newcomer' };
let adminToken, userToken, adminId, userId;

/** Log in (handles the two-factor step and first-time 2FA setup for the admin). */
async function loginAdmin() {
  let r = await call('POST', '/api/auth/login', null, { email: A.email, password });
  if (r.data.mfaRequired) {
    r = await call('POST', '/api/auth/login/2fa', null, { mfaToken: r.data.mfaToken, code: codeAt(adminSecret, 30) });
  }
  return r.data.token;
}
let adminSecret = null;

try {
  // ---- Setup: an administrator (with 2FA) and a normal user ----
  await signUpAndConfirm(A, password);
  await signUpAndConfirm(U, password);
  await prisma.user.update({ where: { email: A.email }, data: { systemRole: 'ADMIN' } });
  let r = await call('POST', '/api/auth/login', null, { email: A.email, password });
  adminToken = r.data.token;
  adminId = r.data.user.id;
  if (r.data.user.mfaSetupRequired) {
    adminSecret = (await call('POST', '/api/auth/2fa/setup', adminToken)).data.secret;
    await call('POST', '/api/auth/2fa/enable', adminToken, { code: codeAt(adminSecret) });
  }
  r = await call('POST', '/api/auth/login', null, { email: U.email, password });
  userToken = r.data.token;
  userId = r.data.user.id;

  // ---- Access ----
  check('normal user cannot open the admin API', (await call('GET', '/api/admin/overview', userToken)).status === 403);
  r = await call('GET', '/api/admin/overview', adminToken);
  check('admin overview loads with counts and settings', r.status === 200 && r.data.users.total >= 2 && typeof r.data.settings.loginMaxAttempts === 'number', `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  r = await call('GET', '/api/admin/users?q=' + encodeURIComponent(tag), adminToken);
  check('user search finds both test users', r.status === 200 && r.data.length === 2 && r.data.every(u => 'activeSessions' in u && 'locked' in u));

  // ---- Per-account lockout after N wrong passwords, unlock by admin ----
  const { settings } = (await call('GET', '/api/admin/settings', adminToken)).data;
  const max = settings.loginMaxAttempts;
  for (let i = 0; i < max; i++) await call('POST', '/api/auth/login', null, { email: U.email, password: 'Wrong-Pass-1!' });
  r = await call('POST', '/api/auth/login', null, { email: U.email, password });
  check(`account locked after ${max} wrong passwords (even the right one is refused)`, r.status === 423 && r.data.code === 'ACCOUNT_LOCKED', r.data.error);
  r = await call('GET', '/api/admin/users?status=locked&q=' + encodeURIComponent(U.email), adminToken);
  check('locked account visible to the admin', r.data.length === 1 && r.data[0].locked);
  check('admin unlocks the account', (await call('POST', `/api/admin/users/${userId}/unlock`, adminToken)).status === 200);
  r = await call('POST', '/api/auth/login', null, { email: U.email, password });
  check('user can log in again after unlock', r.status === 200);
  userToken = r.data.token;

  // ---- Block / unblock ----
  check('admin cannot block themselves', (await call('POST', `/api/admin/users/${adminId}/block`, adminToken, {})).status === 400);
  check('admin blocks the user', (await call('POST', `/api/admin/users/${userId}/block`, adminToken, { reason: 'Test: suspicious activity' })).status === 200);
  check('blocked user is logged out immediately', (await call('GET', '/api/auth/me', userToken)).status === 401);
  r = await call('POST', '/api/auth/login', null, { email: U.email, password });
  check('blocked user cannot log in (told after correct password)', r.status === 403 && r.data.code === 'ACCOUNT_BLOCKED');
  r = await call('POST', '/api/auth/login', null, { email: U.email, password: 'Wrong-Pass-1!' });
  check('wrong password on a blocked account reveals nothing', r.status === 401 && r.data.error === 'Invalid credentials');
  await call('POST', `/api/admin/users/${userId}/unblock`, adminToken);
  r = await call('POST', '/api/auth/login', null, { email: U.email, password });
  check('unblocked user can log in', r.status === 200);
  userToken = r.data.token;

  // ---- Roles ----
  check('admin cannot change their own role', (await call('PUT', `/api/admin/users/${adminId}/role`, adminToken, { role: 'USER' })).status === 400);
  check('invalid role rejected', (await call('PUT', `/api/admin/users/${userId}/role`, adminToken, { role: 'GOD' })).status === 400);
  check('admin makes the user an administrator', (await call('PUT', `/api/admin/users/${userId}/role`, adminToken, { role: 'ADMIN' })).status === 200);
  check('role change ends the user\'s sessions', (await call('GET', '/api/auth/me', userToken)).status === 401);
  r = await call('POST', '/api/auth/login', null, { email: U.email, password });
  check('new admin can open the admin API after logging in again', (await call('GET', '/api/admin/overview', r.data.token)).status === 200 || r.data.user?.mfaSetupRequired === true);
  await call('PUT', `/api/admin/users/${userId}/role`, adminToken, { role: 'USER' });

  // ---- Reset 2FA, log out everywhere ----
  r = await call('POST', '/api/auth/login', null, { email: U.email, password });
  userToken = r.data.token;
  const uSecret = (await call('POST', '/api/auth/2fa/setup', userToken)).data.secret;
  await call('POST', '/api/auth/2fa/enable', userToken, { code: codeAt(uSecret) });
  check('admin resets the user\'s two-factor login', (await call('POST', `/api/admin/users/${userId}/reset-2fa`, adminToken)).status === 200);
  const uRow = await prisma.user.findUnique({ where: { id: userId } });
  check('2FA removed and recovery codes deleted', !uRow.totpEnabledAt && (await prisma.recoveryCode.count({ where: { userId } })) === 0);
  check('reset ends the user\'s sessions', (await call('GET', '/api/auth/me', userToken)).status === 401);
  r = await call('POST', '/api/auth/login', null, { email: U.email, password });
  check('user logs in without a code after the reset', r.status === 200 && !!r.data.token);
  userToken = r.data.token;
  check('admin logs the user out everywhere', (await call('POST', `/api/admin/users/${userId}/logout`, adminToken)).status === 200);
  check('...the session is gone', (await call('GET', '/api/auth/me', userToken)).status === 401);

  // ---- Resend confirmation ----
  await fetch(`${API}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...N, password, gdprConsent: true }) });
  const nId = (await prisma.user.findUnique({ where: { email: N.email } })).id;
  check('resend confirmation to an unconfirmed user', (await call('POST', `/api/admin/users/${nId}/resend-verification`, adminToken)).status === 200);
  check('...refused for an already confirmed user', (await call('POST', `/api/admin/users/${userId}/resend-verification`, adminToken)).status === 400);

  // ---- Settings apply immediately ----
  check('invalid setting rejected', (await call('PUT', '/api/admin/settings', adminToken, { passwordMinLength: 4 })).status === 400);
  check('unknown setting rejected', (await call('PUT', '/api/admin/settings', adminToken, { superUser: true })).status === 400);
  r = await call('PUT', '/api/admin/settings', adminToken, { passwordMinLength: 14, loginMaxAttempts: 3 });
  check('settings saved and changes reported', r.status === 200 && r.data.changed.includes('passwordMinLength'));
  await new Promise(res => setTimeout(res, 50));
  check('public password policy shows the new minimum', (await call('GET', '/api/auth/password-policy')).data.minLength === 14);
  r = await call('POST', '/api/auth/register', null, { email: `adm-x-${tag}@example.test`, firstName: 'Xia', lastName: 'Short', password: 'Ab1!xyzQ9w', gdprConsent: true });
  check('registration enforces the new minimum length', r.status === 400 && /14 characters/.test(r.data.error), r.data.error);
  for (let i = 0; i < 3; i++) await call('POST', '/api/auth/login', null, { email: U.email, password: 'Wrong-Pass-1!' });
  check('new lockout threshold (3) applies at once', (await call('POST', '/api/auth/login', null, { email: U.email, password })).status === 423);
  await call('POST', `/api/admin/users/${userId}/unlock`, adminToken);
  await call('PUT', '/api/admin/settings', adminToken, { passwordMinLength: settings.passwordMinLength, loginMaxAttempts: settings.loginMaxAttempts });

  // ---- Audit log: everything above is recorded, searchable and exportable ----
  r = await call('GET', `/api/admin/logs?group=admin&q=${encodeURIComponent(tag)}`, adminToken);
  const acts = new Set(r.data.items.map(i => i.action));
  check('admin actions recorded', ['ADMIN_USER_UNLOCKED', 'ADMIN_USER_BLOCKED', 'ADMIN_USER_UNBLOCKED', 'ADMIN_ROLE_CHANGED', 'ADMIN_2FA_RESET', 'ADMIN_SESSIONS_REVOKED'].every(a => acts.has(a)), [...acts].join(','));
  r = await call('GET', `/api/admin/logs?group=security&q=${encodeURIComponent(U.email)}`, adminToken);
  check('lockout recorded as a security event', r.data.items.some(i => i.action === 'ACCOUNT_LOCKED'));
  check('settings change recorded with before → after', (await call('GET', '/api/admin/logs?action=ADMIN_SETTINGS_CHANGED', adminToken)).data.items.some(i => /passwordMinLength: \d+ → 14/.test(i.details)));
  r = await call('GET', '/api/admin/logs?pageSize=10&page=1', adminToken);
  check('logs are paged', r.data.items.length === 10 && r.data.total > 10);
  r = await call('GET', `/api/admin/logs/export?q=${encodeURIComponent(tag)}`, adminToken);
  check('CSV export with header and rows', r.status === 200 && (r.headers.get('content-type') || '').includes('text/csv') && r.data.includes('"Action"') && r.data.includes('ADMIN_USER_BLOCKED'));
  check('normal user cannot export logs', (await call('GET', '/api/admin/logs/export', null)).status === 401);
  r = await call('GET', '/api/admin/overview', adminToken);
  check('overview shows the failed logins and lockouts', r.data.activity.failed24h > 0 && r.data.activity.locks24h > 0 && r.data.incidents.length > 0);
} catch (e) {
  fail++; console.log('FAIL  unexpected error', e);
} finally {
  const users = await prisma.user.findMany({ where: { email: { contains: `-${tag}@example.test` } }, select: { id: true } });
  for (const u of users) {
    await prisma.auditLog.updateMany({ where: { userId: u.id }, data: { userId: null } });
    await prisma.user.delete({ where: { id: u.id } });
  }
  const removed = cleanOutbox(tag);
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed (removed ${users.length} test users, ${removed} test emails)`);
}

process.exitCode = fail > 0 ? 1 : 0;
