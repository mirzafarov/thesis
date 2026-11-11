// End-to-end test of email confirmation, password reset and meeting/delay notifications.
// Uses the local outbox (backend/mail-outbox) to read the emails. Creates temporary users and removes them at the end.
import { BACKEND as HELPER_BACKEND } from './helpers.mjs';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const API = process.env.API || 'http://localhost:5021';
const BACKEND = HELPER_BACKEND;
const OUTBOX = path.join(BACKEND, 'mail-outbox');
const SCRATCH = os.tmpdir();

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, p, token, body) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

// Emails in the outbox for an address (newest first), optionally filtered by subject text.
function inbox(email, subjectPart = '') {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readdirSync(OUTBOX).sort().reverse()
    .map(f => ({ f, body: fs.readFileSync(path.join(OUTBOX, f), 'utf8') }))
    .filter(x => x.body.startsWith(`<!-- To: ${email} |`) && x.body.split('\n')[0].includes(subjectPart));
}
async function waitFor(email, subjectPart, count = 1) {
  for (let i = 0; i < 40; i++) {
    const found = inbox(email, subjectPart);
    if (found.length >= count) return found;
    await sleep(250);
  }
  return inbox(email, subjectPart);
}
const linkToken = mail => mail?.body.match(/token=([A-Za-z0-9_-]{20,})/)?.[1];

// Run the scheduled checks once, as if it were `nowIso`.
function runScheduler(nowIso) {
  const script = path.join(BACKEND, '_run_scheduler.ts');
  fs.writeFileSync(script, `import { runScheduledNotifications } from './src/lib/notifications';
runScheduledNotifications(new Date(${JSON.stringify(nowIso)})).then(r => { console.log(JSON.stringify(r)); process.exit(0); });`);
  try {
    const out = execSync('npx tsx _run_scheduler.ts', { cwd: BACKEND, encoding: 'utf8', env: { ...process.env, SMTP_HOST: '' } });
    return JSON.parse(out.trim().split('\n').filter(l => l.startsWith('{')).pop());
  } finally {
    fs.unlinkSync(script);
  }
}

const tag = crypto.randomBytes(4).toString('hex');
const pw1 = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const pw2 = `Yw#${crypto.randomBytes(9).toString('base64url')}7b`;
const C = { email: `mail-c-${tag}@example.test`, firstName: 'Mailc', lastName: 'Manager' };
const D = { email: `mail-d-${tag}@example.test`, firstName: 'Maild', lastName: '<b>Employee</b>' };
const tokens = {};
const state = { users: [C, D], passwords: { [C.email]: pw2, [D.email]: pw1 } };
fs.writeFileSync(path.join(SCRATCH, 'email-e2e-users.json'), JSON.stringify(state));

try {
  // ---- Email confirmation ----
  let r = await call('POST', '/api/auth/register', null, { ...C, password: pw1, gdprConsent: true });
  check('register sends confirmation email', r.status === 201 && /email/i.test(r.data.message));
  const verifyMail = (await waitFor(C.email, 'Confirm your email'))[0];
  check('confirmation email in outbox', !!verifyMail);
  r = await call('POST', '/api/auth/login', null, { email: C.email, password: pw1 });
  check('login blocked until confirmed', r.status === 403 && r.data.code === 'EMAIL_NOT_VERIFIED');
  r = await call('POST', '/api/auth/login', null, { email: C.email, password: 'wrong-Password1!' });
  check('wrong password still says invalid credentials (no hint)', r.status === 401);
  r = await call('POST', '/api/auth/verify-email', null, { token: linkToken(verifyMail) });
  check('confirmation link works', r.status === 200);
  r = await call('POST', '/api/auth/verify-email', null, { token: linkToken(verifyMail) });
  check('confirmation link works only once', r.status === 400);
  r = await call('POST', '/api/auth/verify-email', null, { token: 'x'.repeat(43) });
  check('made-up token rejected', r.status === 400);
  r = await call('POST', '/api/auth/login', null, { email: C.email, password: pw1 });
  check('login works after confirming', r.status === 200);

  // ---- Password reset ----
  r = await call('POST', '/api/auth/forgot-password', null, { email: `nobody-${tag}@example.test` });
  const unknownMsg = r.data.message;
  check('unknown email gets the same answer and no email', r.status === 200 && inbox(`nobody-${tag}@example.test`).length === 0);
  r = await call('POST', '/api/auth/forgot-password', null, { email: C.email });
  check('known email gets identical answer', r.status === 200 && r.data.message === unknownMsg);
  const resetMail = (await waitFor(C.email, 'Reset your password'))[0];
  const resetToken = linkToken(resetMail);
  check('reset email in outbox with link', !!resetToken);
  r = await call('POST', '/api/auth/reset-password', null, { token: resetToken, password: 'weak' });
  check('weak new password rejected', r.status === 400);
  r = await call('POST', '/api/auth/reset-password', null, { token: resetToken, password: pw2 });
  check('reset with strong password works (weak attempt did not use up the link)', r.status === 200, r.data?.error);
  r = await call('POST', '/api/auth/reset-password', null, { token: resetToken, password: pw2 });
  check('reset link works only once', r.status === 400);
  check('password-changed security email sent', (await waitFor(C.email, 'Your password was changed')).length === 1);
  check('old password no longer works', (await call('POST', '/api/auth/login', null, { email: C.email, password: pw1 })).status === 401);
  r = await call('POST', '/api/auth/login', null, { email: C.email, password: pw2 });
  check('new password works', r.status === 200);
  tokens.C = r.data.token;

  // Second user (confirmed via the link)
  await call('POST', '/api/auth/register', null, { ...D, password: pw1, gdprConsent: false });
  check('registration without consent rejected (no email)', inbox(D.email).length === 0);
  await call('POST', '/api/auth/register', null, { ...D, lastName: 'Employee', password: pw1, gdprConsent: true });
  D.lastName = 'Employee';
  await call('POST', '/api/auth/verify-email', null, { token: linkToken((await waitFor(D.email, 'Confirm your email'))[0]) });
  r = await call('POST', '/api/auth/login', null, { email: D.email, password: pw1 });
  tokens.D = r.data.token;
  const dId = r.data.user.id;

  // ---- Meeting emails ----
  const p = await call('POST', '/api/projects', tokens.C, { name: `Mail test <script>${tag}</script>` });
  const pid = p.data.id;
  await call('POST', `/api/projects/${pid}/members`, tokens.C, { newMemberUserId: dId });

  const start = new Date(Date.now() + 23.5 * 3600e3); start.setSeconds(0, 0);
  const alt = new Date(start.getTime() + 2 * 86400e3);
  const m = await call('POST', '/api/meetings/poll', tokens.C, {
    projectId: pid, title: 'Budget <img src=x onerror=alert(1)> review', durationMin: 45,
    proposedSlots: [start.toISOString(), alt.toISOString()], participantIds: [dId],
  });
  const mid = m.data.id;
  const invite = (await waitFor(D.email, 'Vote on a time'))[0];
  check('invitation email to participant', !!invite);
  check('organizer gets no invitation', inbox(C.email, 'Vote on a time').length === 0);
  check('HTML in titles is escaped in emails', invite && !invite.body.includes('<img src=x') && invite.body.includes('&lt;img src=x') && !invite.body.includes('<script>'));

  await call('POST', `/api/meetings/${mid}/finalize`, tokens.C, { finalStartDate: start.toISOString() });
  check('confirmation email to both', (await waitFor(D.email, 'Confirmed:')).length === 1 && (await waitFor(C.email, 'Confirmed:')).length === 1);

  // ---- Reminders ----
  let s = runScheduler(new Date().toISOString());
  check('24h reminder sent when 23-24h before', (await waitFor(D.email, 'is tomorrow')).length === 1 && (await waitFor(C.email, 'is tomorrow')).length === 1, JSON.stringify(s));
  runScheduler(new Date().toISOString());
  check('24h reminder not sent twice', inbox(D.email, 'is tomorrow').length === 1);
  s = runScheduler(new Date(start.getTime() - 30 * 60e3).toISOString());
  check('1h reminder sent 30 min before', (await waitFor(D.email, 'starts in 1 hour')).length === 1, JSON.stringify(s));
  s = runScheduler(new Date(start.getTime() - 5 * 3600e3).toISOString());
  check('no 24h reminder 5h before (outside window)', inbox(D.email, 'is tomorrow').length === 1);

  // Reschedule -> moved email, reminders can be sent again for the new time
  const newStart = new Date(start.getTime() + 86400e3);
  await call('PUT', `/api/meetings/${mid}/reschedule`, tokens.C, { startDate: newStart.toISOString() });
  check('moved email to participants', (await waitFor(D.email, 'Moved:')).length === 1);
  await sleep(500);
  runScheduler(new Date(newStart.getTime() - 30 * 60e3).toISOString());
  check('reminders reset after reschedule (new 1h reminder)', (await waitFor(D.email, 'starts in 1 hour', 2)).length === 2);

  // ---- Delay alerts ----
  const DAY = 86400e3;
  const day = off => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() + off * DAY).toISOString(); };
  const crit = await call('POST', `/api/projects/${pid}/activities`, tokens.C, { title: 'Submit ethics form', isCritical: true, responsibleId: dId, startDate: day(-10), endDate: day(-2) });
  await call('POST', `/api/projects/${pid}/activities`, tokens.C, { title: 'Not critical', startDate: day(-10), endDate: day(-2) });
  await call('POST', `/api/projects/${pid}/activities`, tokens.C, { title: 'Critical but done', isCritical: true, startDate: day(-10), endDate: day(-2) })
    .then(x => call('PUT', `/api/projects/${pid}/activities/${x.data.id}`, tokens.C, { status: 'COMPLETED' }));
  await call('POST', `/api/projects/${pid}/activities`, tokens.C, { title: 'Critical due today', isCritical: true, startDate: day(-3), endDate: day(0) });

  s = runScheduler(new Date().toISOString());
  const dMail = (await waitFor(D.email, 'Delayed:'));
  const cMail = (await waitFor(C.email, 'Delayed:'));
  check('delay alert to responsible person', dMail.length === 1 && dMail[0].body.includes('You are responsible'), JSON.stringify(s));
  check('delay alert to manager', cMail.length === 1 && cMail[0].body.includes('Responsible: Maild Employee'));
  check('only the late, unfinished critical activity triggers alerts', dMail.length + cMail.length === 2 && ![...dMail, ...cMail].some(x => /Not critical|Critical but done|Critical due today/.test(x.body)));
  const detail = await call('GET', `/api/projects/${pid}`, tokens.C);
  check('late critical activity marked DELAYED', detail.data.activities.find(a => a.id === crit.data.id)?.status === 'DELAYED');
  runScheduler(new Date().toISOString());
  check('delay alert not repeated', inbox(D.email, 'Delayed:').length === 1 && inbox(C.email, 'Delayed:').length === 1);
  await call('PUT', `/api/projects/${pid}/activities/${crit.data.id}`, tokens.C, { endDate: day(-1) });
  runScheduler(new Date().toISOString());
  check('new end date missed again -> new alert', (await waitFor(D.email, 'Delayed:', 2)).length === 2);

  // ---- Meetings that have ended are marked as held ----
  const pastStart = new Date(Date.now() - 3 * 3600e3); pastStart.setSeconds(0, 0);
  const past = await call('POST', '/api/meetings/poll', tokens.C, { projectId: pid, title: 'Earlier today', durationMin: 60, proposedSlots: [pastStart.toISOString()], participantIds: [] });
  await call('POST', `/api/meetings/${past.data.id}/finalize`, tokens.C, { finalStartDate: pastStart.toISOString() });
  runScheduler(new Date().toISOString());
  const afterRun = (await call('GET', '/api/meetings', tokens.C)).data;
  check('ended meeting marked as held', afterRun.find(x => x.id === past.data.id)?.status === 'COMPLETED');
  check('future meeting stays scheduled', ['CONFIRMED', 'CALENDAR_SYNCHRONIZED', 'RESCHEDULED'].includes(afterRun.find(x => x.id === mid)?.status), afterRun.find(x => x.id === mid)?.status);

  await call('DELETE', `/api/projects/${pid}`, tokens.C);
} catch (e) {
  fail++; console.log('FAIL  unexpected error', e);
} finally {
  for (const u of [C, D]) {
    const l = await call('POST', '/api/auth/login', null, { email: u.email, password: state.passwords[u.email] });
    if (l.status === 200) await call('DELETE', '/api/auth/me', l.data.token);
    else console.log(`cleanup: could not log in as ${u.firstName} (${l.status})`);
  }
  // Remove this test's emails from the outbox
  let removed = 0;
  for (const f of fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []) {
    const head = fs.readFileSync(path.join(OUTBOX, f), 'utf8').split('\n')[0];
    if (head.includes(`-${tag}@example.test`)) { fs.unlinkSync(path.join(OUTBOX, f)); removed++; }
  }
  fs.unlinkSync(path.join(SCRATCH, 'email-e2e-users.json'));
  console.log(`\n${pass} passed, ${fail} failed (removed ${removed} test emails)`);
}

process.exitCode = fail > 0 ? 1 : 0;
