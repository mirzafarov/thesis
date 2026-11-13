// End-to-end test: meeting to-do lists (action items): permissions per role, validation, emails and reminders.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { API, BACKEND, OUTBOX, signUpAndConfirm, cleanOutbox } from './helpers.mjs';

const { PrismaClient } = createRequire(path.join(BACKEND, 'package.json'))('@prisma/client');
const prisma = new PrismaClient();

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, token, body) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const mailsTo = (email, subjectPart) => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : [])
  .map(f => fs.readFileSync(path.join(OUTBOX, f), 'utf8'))
  .filter(b => b.startsWith(`<!-- To: ${email} |`) && b.split('\n')[0].includes(subjectPart));
async function waitForMail(email, subjectPart) {
  for (let i = 0; i < 40; i++) { const m = mailsTo(email, subjectPart); if (m.length) return m; await sleep(250); }
  return [];
}
// Run the scheduled checks once, as if it were `nowIso` (same approach as the email suite).
// Only this test's projects: a run "as if it were" another time must never touch real meetings or activities.
let schedulerScope = [];
function runScheduler(nowIso) {
  if (!schedulerScope.length) throw new Error('runScheduler needs the test project ids (schedulerScope)');
  const script = path.join(BACKEND, '_run_scheduler_todos.ts');
  fs.writeFileSync(script, `import { runScheduledNotifications } from './src/lib/notifications';
runScheduledNotifications(new Date(${JSON.stringify(nowIso)}), { projectIds: ${JSON.stringify(schedulerScope)} }).then(r => { console.log(JSON.stringify(r)); process.exit(0); });`);
  try {
    const out = execSync('npx tsx _run_scheduler_todos.ts', { cwd: BACKEND, encoding: 'utf8', env: { ...process.env, SMTP_HOST: '' } });
    return JSON.parse(out.trim().split('\n').filter(l => l.startsWith('{')).pop());
  } finally {
    fs.unlinkSync(script);
  }
}

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const people = {
  Ana: { email: `todo-a-${tag}@example.test`, firstName: 'Ana', lastName: 'Manager' },
  Bob: { email: `todo-b-${tag}@example.test`, firstName: 'Bob', lastName: 'Employee' },
  Cid: { email: `todo-c-${tag}@example.test`, firstName: 'Cid', lastName: 'Observer' },
  Dan: { email: `todo-d-${tag}@example.test`, firstName: 'Dan', lastName: 'Outsider' },
};
const tok = {}, id = {};
// A due date far in the future, so the reminder run cannot touch anybody else's to-dos
const due = new Date(Date.now() + 400 * 86400e3).toISOString().slice(0, 10);

try {
  for (const [n, p] of Object.entries(people)) {
    await signUpAndConfirm(p, password);
    const l = await call('POST', '/api/auth/login', null, { email: p.email, password });
    tok[n] = l.data.token; id[n] = l.data.user.id;
  }
  const pid = (await call('POST', '/api/projects', tok.Ana, { name: `Todos ${tag}` })).data.id;
  schedulerScope = [pid];
  await call('POST', `/api/projects/${pid}/members`, tok.Ana, { newMemberUserId: id.Bob, role: 'EMPLOYEE' });
  await call('POST', `/api/projects/${pid}/members`, tok.Ana, { newMemberUserId: id.Cid, role: 'OBSERVER' });
  const slot = new Date(Date.now() + 2 * 86400e3); slot.setUTCMinutes(0, 0, 0);
  const meeting = (await call('POST', '/api/meetings/poll', tok.Ana, {
    projectId: pid, title: 'Planning', durationMin: 30, proposedSlots: [slot.toISOString()], participantIds: [id.Bob, id.Cid],
  })).data;
  const base = `/api/meetings/${meeting.id}/action-items`;

  // ---- Viewing ----
  let r = await call('GET', base, tok.Bob);
  check('participant sees the (empty) list and may add', r.status === 200 && r.data.items.length === 0 && r.data.canAdd === true && r.data.canManageAll === false);
  r = await call('GET', base, tok.Cid);
  check('observer sees the list but may not add', r.status === 200 && r.data.canAdd === false);
  check('outsider cannot see the list', (await call('GET', base, tok.Dan)).status === 403);
  check('not logged in: refused', (await call('GET', base, null)).status === 401);

  // ---- Adding ----
  r = await call('POST', base, tok.Ana, { title: '  Send the <b>budget</b> to the client  ', assigneeId: id.Bob, dueDate: due });
  const item1 = r.data;
  check('organizer adds a to-do for a participant', r.status === 201 && item1.title === 'Send the <b>budget</b> to the client' && item1.assignee?.id === id.Bob && item1.dueDate.startsWith(due));
  const assignedMail = await waitForMail(people.Bob.email, 'New to-do');
  check('assignee gets an email', assignedMail.length === 1 && assignedMail[0].includes('Planning'));
  check('to-do title is escaped in the email', assignedMail[0]?.includes('Send the &lt;b&gt;budget&lt;/b&gt;'));
  r = await call('POST', base, tok.Bob, { title: 'Book the room', assigneeId: id.Bob });
  const item2 = r.data;
  check('participant adds a to-do for themself (no email to self)', r.status === 201);
  await sleep(800);
  check('no email when assigning to yourself', mailsTo(people.Bob.email, 'New to-do').length === 1);
  check('observer cannot add', (await call('POST', base, tok.Cid, { title: 'x' })).status === 403);
  check('outsider cannot add', (await call('POST', base, tok.Dan, { title: 'x' })).status === 403);
  check('empty title refused', (await call('POST', base, tok.Ana, { title: '   ' })).status === 400);
  check('title over 300 characters refused', (await call('POST', base, tok.Ana, { title: 'a'.repeat(301) })).status === 400);
  check('invalid due date refused', (await call('POST', base, tok.Ana, { title: 'x', dueDate: '2026-02-30' })).status === 400);
  check('cannot assign to someone outside the meeting', (await call('POST', base, tok.Ana, { title: 'x', assigneeId: id.Dan })).status === 400);

  // ---- Changing ----
  check('participant cannot edit someone else\'s to-do', (await call('PATCH', `/api/action-items/${item1.id}`, tok.Cid, { title: 'hack' })).status === 403);
  r = await call('PATCH', `/api/action-items/${item1.id}`, tok.Bob, { title: 'changed by assignee' });
  check('assignee cannot rename a to-do they did not create', r.status === 403);
  r = await call('PATCH', `/api/action-items/${item1.id}`, tok.Bob, { done: true });
  check('assignee can tick it done', r.status === 200 && !!r.data.doneAt);
  r = await call('PATCH', `/api/action-items/${item1.id}`, tok.Bob, { done: false });
  check('and reopen it', r.status === 200 && r.data.doneAt === null);
  check('observer cannot tick', (await call('PATCH', `/api/action-items/${item1.id}`, tok.Cid, { done: true })).status === 403);
  r = await call('PATCH', `/api/action-items/${item2.id}`, tok.Ana, { title: 'Book the big room', dueDate: due });
  check('organizer (manager) can edit any to-do', r.status === 200 && r.data.title === 'Book the big room');
  check('outsider cannot change anything', (await call('PATCH', `/api/action-items/${item2.id}`, tok.Dan, { done: true })).status === 403);

  // ---- Lists and counts ----
  r = await call('GET', '/api/action-items/mine', tok.Bob);
  check('"my to-dos" lists open items assigned to me with the meeting', r.status === 200 && r.data.length === 2 && r.data[0].meeting.title === 'Planning');
  const meetings = await call('GET', '/api/meetings', tok.Ana);
  check('meetings list shows the to-do count', meetings.data.find(m => m.id === meeting.id)?.todos?.total === 2);

  // ---- Reminder the day before ----
  const dayBefore = new Date(`${due}T09:00:00.000Z`); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  let run = runScheduler(dayBefore.toISOString());
  check('reminder run sends the due-tomorrow emails', run.todos === 2, JSON.stringify(run));
  const dueMails = await waitForMail(people.Bob.email, 'Due tomorrow');
  check('assignee receives "due tomorrow"', dueMails.length === 2);
  run = runScheduler(dayBefore.toISOString());
  check('reminders are not sent twice', run.todos === 0);
  await call('PATCH', `/api/action-items/${item2.id}`, tok.Bob, { done: true });
  const later = new Date(`${due}T00:00:00.000Z`); later.setUTCDate(later.getUTCDate() + 7);
  const newDue = later.toISOString().slice(0, 10);
  await call('PATCH', `/api/action-items/${item1.id}`, tok.Ana, { dueDate: newDue });
  const dayBeforeNew = new Date(`${newDue}T09:00:00.000Z`); dayBeforeNew.setUTCDate(dayBeforeNew.getUTCDate() - 1);
  run = runScheduler(dayBeforeNew.toISOString());
  check('moved due date gets a new reminder; done items get none', run.todos === 1, JSON.stringify(run));

  // ---- Deleting ----
  check('assignee cannot delete a to-do they did not create', (await call('DELETE', `/api/action-items/${item1.id}`, tok.Bob)).status === 403);
  check('creator can delete their own to-do', (await call('DELETE', `/api/action-items/${item2.id}`, tok.Bob)).status === 200);
  check('manager can delete any to-do', (await call('DELETE', `/api/action-items/${item1.id}`, tok.Ana)).status === 200);
  check('deleted to-do is gone', (await call('PATCH', `/api/action-items/${item1.id}`, tok.Ana, { done: true })).status === 404);

  const audits = await prisma.auditLog.count({ where: { projectId: pid, action: { startsWith: 'ACTION_ITEM_' } } });
  check('changes are recorded in the audit log', audits >= 8, `${audits}`);

  // ---- Deleting the meeting removes its to-dos ----
  const extra = (await call('POST', base, tok.Ana, { title: 'temporary' })).data;
  await call('DELETE', `/api/projects/${pid}`, tok.Ana);
  check('to-dos are removed with their project/meeting', (await prisma.actionItem.count({ where: { id: extra.id } })) === 0);
} catch (e) {
  fail++; console.log('FAIL  unexpected error', e);
} finally {
  for (const t of Object.values(tok)) await call('DELETE', '/api/auth/me', t);
  const removed = cleanOutbox(`-${tag}@example.test`);
  await prisma.notificationLog.deleteMany({ where: { type: 'ACTION_ITEM_DUE', user: { email: { endsWith: `-${tag}@example.test` } } } }).catch(() => {});
  const left = await prisma.user.count({ where: { email: { endsWith: '@example.test' } } });
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed (removed ${removed} test emails, ${left} test users left)`);
}

process.exitCode = fail > 0 ? 1 : 0;
