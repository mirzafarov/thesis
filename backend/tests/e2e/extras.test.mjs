// End-to-end test: project log for managers, AI language/reply checks (without calling the AI), the meeting facts
// given to the AI, to-do progress on Gantt activities, and the encrypted personal ID code.
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { API, BACKEND, linkTokenFor, cleanOutbox } from './helpers.mjs';

const { PrismaClient } = createRequire(path.join(BACKEND, 'package.json'))('@prisma/client');
const prisma = new PrismaClient();

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
async function call(method, p, token, body) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const ID_CODE = '39001011234';
const people = {
  M: { email: `x-m-${tag}@example.test`, firstName: 'Mara', lastName: 'Manager', idCode: ID_CODE, timeZone: 'Europe/Vilnius' },
  E: { email: `x-e-${tag}@example.test`, firstName: 'Emil', lastName: 'Employee' },
  O: { email: `x-o-${tag}@example.test`, firstName: 'Olga', lastName: 'Outsider' },
};
const tok = {}, id = {};

try {
  // ---- Personal ID code (registration) ----
  check('invalid ID code refused at sign-up', (await call('POST', '/api/auth/register', null, { ...people.O, idCode: 'bad code!', password, gdprConsent: true })).status === 400);
  for (const [k, p] of Object.entries(people)) {
    const r = await call('POST', '/api/auth/register', null, { ...p, password, gdprConsent: true });
    if (r.status !== 201) throw new Error(`register ${k}: ${JSON.stringify(r.data)}`);
    await call('POST', '/api/auth/verify-email', null, { token: await linkTokenFor(p.email, 'Confirm your email') });
    const l = await call('POST', '/api/auth/login', null, { email: p.email, password });
    tok[k] = l.data.token; id[k] = l.data.user.id;
  }
  let me = await call('GET', '/api/auth/me', tok.M);
  check('ID code saved at sign-up and shown to the user', me.data.idCode === ID_CODE);
  const stored = await prisma.user.findUnique({ where: { id: id.M }, select: { idCodeEncrypted: true } });
  check('ID code is stored encrypted (not readable in the database)', !!stored.idCodeEncrypted && !stored.idCodeEncrypted.includes(ID_CODE));
  check('users without an ID code: null', (await call('GET', '/api/auth/me', tok.E)).data.idCode === null);
  check('change ID code', (await call('PUT', '/api/users/me/id-code', tok.E, { idCode: 'AB-1234' })).data?.idCode === 'AB-1234');
  check('invalid ID code refused in Settings', (await call('PUT', '/api/users/me/id-code', tok.E, { idCode: '<script>' })).status === 400);
  check('remove ID code', (await call('PUT', '/api/users/me/id-code', tok.E, { idCode: '' })).data?.idCode === null);
  const exp = await call('GET', '/api/auth/me/export', tok.M);
  check('data export contains the readable ID code, not the encrypted one', exp.data.idCode === ID_CODE && !('idCodeEncrypted' in exp.data));
  const idAudit = await prisma.auditLog.findMany({ where: { userId: id.E, action: 'PROFILE_UPDATED' } });
  check('ID code changes are logged without the code itself', idAudit.length === 2 && idAudit.every(a => !a.details.includes('AB-1234')));

  // ---- Project with an activity, a meeting linked to it and to-dos ----
  const pid = (await call('POST', '/api/projects', tok.M, { name: `Extras ${tag}` })).data.id;
  await call('POST', `/api/projects/${pid}/members`, tok.M, { newMemberUserId: id.E, role: 'EMPLOYEE' });
  const act = (await call('POST', `/api/projects/${pid}/activities`, tok.M, { title: 'Pilot', startDate: '2026-12-01', endDate: '2026-12-20' })).data;
  const slot = new Date(Date.now() + 3 * 86400e3); slot.setUTCMinutes(0, 0, 0);
  const meeting = (await call('POST', '/api/meetings/poll', tok.M, { projectId: pid, activityId: act.id, title: 'Pilot planning', durationMin: 45, proposedSlots: [slot.toISOString()], participantIds: [id.E] })).data;
  await call('POST', `/api/meetings/${meeting.id}/finalize`, tok.M, { finalStartDate: slot.toISOString() });
  const t1 = (await call('POST', `/api/meetings/${meeting.id}/action-items`, tok.M, { title: 'Book vehicles', assigneeId: id.E })).data;
  await call('POST', `/api/meetings/${meeting.id}/action-items`, tok.M, { title: 'Write plan' });
  await call('PATCH', `/api/action-items/${t1.id}`, tok.E, { done: true });

  // ---- To-do progress on the Gantt activity ----
  const det = await call('GET', `/api/projects/${pid}`, tok.E);
  const a = det.data.activities.find(x => x.id === act.id);
  check('activity carries the to-do progress of its meetings', a?.todos?.total === 2 && a.todos.done === 1, JSON.stringify(a?.todos));
  check('meetings in the project detail do not leak the to-do list', !('actionItems' in (a?.meetings?.[0] ?? {})));

  // ---- Project log for managers ----
  let r = await call('GET', `/api/projects/${pid}/logs`, tok.M);
  check('manager sees the project log', r.status === 200 && r.data.total >= 5, String(r.data?.total));
  check('project log has no IP addresses', r.data.items.every(i => !('ipAddress' in i)));
  check('project log names who did it', r.data.items.some(i => i.user?.id === id.E && i.action === 'ACTION_ITEM_UPDATED'));
  check('employee cannot see the project log', (await call('GET', `/api/projects/${pid}/logs`, tok.E)).status === 403);
  check('outsider cannot see the project log', (await call('GET', `/api/projects/${pid}/logs`, tok.O)).status === 403);
  r = await call('GET', `/api/projects/${pid}/logs?group=meetings`, tok.M);
  check('filter by type: meetings and to-dos only', r.data.items.length > 0 && r.data.items.every(i => i.action.startsWith('MEETING_') || i.action.startsWith('ACTION_ITEM_')));
  r = await call('GET', `/api/projects/${pid}/logs?q=${encodeURIComponent('Book vehicles')}`, tok.M);
  check('search finds the matching entries', r.data.items.length >= 1 && r.data.items.every(i => i.details.includes('Book vehicles')));
  r = await call('GET', `/api/projects/${pid}/logs?userId=${id.E}`, tok.M);
  check('filter by person', r.data.items.length >= 1 && r.data.items.every(i => i.user?.id === id.E));
  r = await call('GET', `/api/projects/${pid}/logs?group=security`, tok.M);
  check('admin-only log types are ignored (no logins of members)', r.data.items.every(i => !i.action.startsWith('LOGIN')));

  // ---- AI: checks that happen before anything is sent to the AI ----
  const gen = body => call('POST', '/api/ai/generate', tok.M, { meetingId: meeting.id, draftType: 'AGENDA', prompt: 'Short agenda', ...body });
  check('AI: unknown language refused', (await gen({ language: 'fr' })).status === 400);
  check('AI: empty instructions refused', (await gen({ prompt: '   ' })).status === 400);
  check('AI: unknown draft type refused', (await gen({ draftType: 'POEM' })).status === 400);
  const outsiderProject = (await call('POST', '/api/projects', tok.O, { name: `Other ${tag}` })).data.id;
  await call('POST', `/api/projects/${outsiderProject}/members`, tok.O, { newMemberUserId: id.E, role: 'EMPLOYEE' });
  const hidden = (await call('POST', '/api/meetings/poll', tok.O, { projectId: outsiderProject, title: 'Private chat', durationMin: 30, proposedSlots: [slot.toISOString()], participantIds: [] })).data;
  check('AI: a project member who is not invited cannot use a meeting', (await call('POST', '/api/ai/generate', tok.E, { meetingId: hidden.id, draftType: 'AGENDA', prompt: 'x' })).status === 403);
  check('AI reply: unknown language refused', (await call('POST', `/api/meetings/${meeting.id}/email-draft`, tok.E, { responseType: 'ACCEPT', language: 'de' })).status === 400);
  check('AI reply: only invited people', (await call('POST', `/api/meetings/${meeting.id}/email-draft`, tok.O, { responseType: 'ACCEPT', language: 'en' })).status === 403);

  // ---- The facts the AI receives (checked directly, without calling the AI) ----
  const script = `import { meetingContext } from './src/lib/aiContext'; meetingContext(${JSON.stringify(meeting.id)}, ${JSON.stringify(id.M)}).then(c => { console.log(JSON.stringify(c?.text)); process.exit(0); });`;
  const run = spawnSync('npx', ['tsx', '-e', `"${script.replace(/"/g, '\\"')}"`], { cwd: BACKEND, shell: true, encoding: 'utf8' });
  const ctx = JSON.parse(run.stdout.trim().split('\n').filter(l => l.startsWith('"')).pop() || '""');
  check('AI context: title, project, duration', ctx.includes('Meeting title: Pilot planning') && ctx.includes(`Project: Extras ${tag}`) && ctx.includes('45 minutes'));
  check('AI context: time in the user\'s time zone', /Time: .*(EET|GMT\+2)/.test(ctx), ctx.match(/Time: [^\n]*/)?.[0]);
  check('AI context: participants, activity and to-dos', ctx.includes('Emil Employee') && ctx.includes('Related project activity: Pilot') && ctx.includes('- Book vehicles (responsible: Emil Employee), done'));

  await call('DELETE', `/api/projects/${pid}`, tok.M);
  await call('DELETE', `/api/projects/${outsiderProject}`, tok.O);
} catch (e) {
  fail++; console.log('FAIL  unexpected error', e);
} finally {
  for (const t of Object.values(tok)) await call('DELETE', '/api/auth/me', t);
  const removed = cleanOutbox(`-${tag}@example.test`);
  const left = await prisma.user.count({ where: { email: { endsWith: '@example.test' } } });
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed (removed ${removed} test emails, ${left} test users left)`);
}

process.exitCode = fail > 0 ? 1 : 0;
