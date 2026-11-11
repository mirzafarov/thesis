// End-to-end check of the Gantt chart API: phases, milestones, activities, permissions, moving linked meetings.
import crypto from 'node:crypto';
import { API, signUpAndConfirm, cleanOutbox } from './helpers.mjs';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };

async function call(method, p, token, body) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const DAY = 86400000;
const utcDay = offset => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() + offset * DAY).toISOString(); };

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const users = [
  { email: `gantt-a-${tag}@example.test`, firstName: 'Gantta', lastName: 'Manager' },
  { email: `gantt-b-${tag}@example.test`, firstName: 'Ganttb', lastName: 'Employee' },
];
const tokens = [], ids = [];

for (const u of users) {
  await signUpAndConfirm(u, password);
  const l = await call('POST', '/api/auth/login', null, { email: u.email, password });
  check(`login ${u.firstName}`, l.status === 200);
  tokens.push(l.data.token); ids.push(l.data.user.id);
}
const [A, B] = tokens;

const p = await call('POST', '/api/projects', A, { name: `Gantt demo ${tag}`, description: 'Temporary test project', startDate: utcDay(-10), endDate: utcDay(50) });
const pid = p.data.id;
await call('POST', `/api/projects/${pid}/members`, A, { newMemberUserId: ids[1], role: 'EMPLOYEE' });
const other = await call('POST', '/api/projects', A, { name: `Other ${tag}` });

// Phases
const ph1 = await call('POST', `/api/projects/${pid}/phases`, A, { name: 'Research', startDate: utcDay(-10), endDate: utcDay(8) });
check('manager creates phase', ph1.status === 201);
const ph2 = await call('POST', `/api/projects/${pid}/phases`, A, { name: 'Development', startDate: utcDay(9), endDate: utcDay(35) });
const ms = await call('POST', `/api/projects/${pid}/phases`, A, { name: 'Thesis deadline', startDate: utcDay(40), endDate: utcDay(99), isMilestone: true });
check('milestone end = start', ms.status === 201 && ms.data.endDate === ms.data.startDate);
check('employee cannot create phase', (await call('POST', `/api/projects/${pid}/phases`, B, { name: 'x', startDate: utcDay(0), endDate: utcDay(1) })).status === 403);
check('phase end before start rejected', (await call('POST', `/api/projects/${pid}/phases`, A, { name: 'x', startDate: utcDay(5), endDate: utcDay(1) })).status === 400);
check('phase without dates rejected', (await call('POST', `/api/projects/${pid}/phases`, A, { name: 'x' })).status === 400);
const otherPhase = await call('POST', `/api/projects/${other.data.id}/phases`, A, { name: 'Foreign', startDate: utcDay(0), endDate: utcDay(3) });

// Activities
const mk = body => call('POST', `/api/projects/${pid}/activities`, A, body);
const a1 = await mk({ title: 'Literature review', phaseId: ph1.data.id, startDate: utcDay(-10), endDate: utcDay(-3), responsibleId: ids[0] });
const a2 = await mk({ title: 'User interviews', phaseId: ph1.data.id, startDate: utcDay(-4), endDate: utcDay(-1), responsibleId: ids[1], isCritical: true });
const a3 = await mk({ title: 'Backend API', phaseId: ph2.data.id, startDate: utcDay(9), endDate: utcDay(22), responsibleId: ids[1] });
const a4 = await mk({ title: 'Gantt chart UI', phaseId: ph2.data.id, startDate: utcDay(14), endDate: utcDay(30) });
const a5 = await mk({ title: 'Write introduction' });
check('activities created (incl. undated)', [a1, a2, a3, a4, a5].every(r => r.status === 201));
await call('PUT', `/api/projects/${pid}/activities/${a1.data.id}`, A, { status: 'COMPLETED' });
check('activity end before start rejected', (await mk({ title: 'x', startDate: utcDay(5), endDate: utcDay(1) })).status === 400);
check('phase from another project rejected', (await mk({ title: 'x', phaseId: otherPhase.data.id })).status === 400);
check('non-member responsible rejected', (await mk({ title: 'x', responsibleId: '00000000-0000-0000-0000-000000000000' })).status === 400);
check('invalid date rejected', (await mk({ title: 'x', startDate: 'not-a-date' })).status === 400);

// Responsible employee: status only
check('responsible employee can change status', (await call('PUT', `/api/projects/${pid}/activities/${a3.data.id}`, B, { status: 'IN_PROGRESS' })).status === 200);
check('responsible employee cannot change dates', (await call('PUT', `/api/projects/${pid}/activities/${a3.data.id}`, B, { startDate: utcDay(1) })).status === 403);
check('non-responsible employee cannot change status', (await call('PUT', `/api/projects/${pid}/activities/${a4.data.id}`, B, { status: 'COMPLETED' })).status === 403);

// Meeting linked to "Backend API", confirmed in the future
const slot = new Date(utcDay(12)); slot.setUTCHours(10);
const m = await call('POST', '/api/meetings/poll', A, { projectId: pid, activityId: a3.data.id, title: 'API design review', durationMin: 60, proposedSlots: [slot.toISOString()], participantIds: [ids[1]] });
await call('POST', `/api/meetings/${m.data.id}/finalize`, A, { finalStartDate: slot.toISOString() });

// Move the activity 3 days later -> suggestion to move the meeting 3 days later
const moved = await call('PUT', `/api/projects/${pid}/activities/${a3.data.id}`, A, { startDate: utcDay(12), endDate: utcDay(25) });
const sug = moved.data.meetingSuggestions?.[0];
check('moving activity suggests moving its meeting', moved.status === 200 && moved.data.shiftDays === 3 && !!sug);
check('suggested time shifted by 3 days', sug && new Date(sug.suggestedStart) - new Date(sug.currentStart) === 3 * DAY);
check('employee cannot reschedule meeting', (await call('PUT', `/api/meetings/${m.data.id}/reschedule`, B, { startDate: sug.suggestedStart })).status === 403);
const rs = await call('PUT', `/api/meetings/${m.data.id}/reschedule`, A, { startDate: sug.suggestedStart });
check('manager reschedules meeting', rs.status === 200 && rs.data.status === 'RESCHEDULED' && rs.data.startDate === sug.suggestedStart);
// Move it back: rescheduled meetings are suggested again
const back = await call('PUT', `/api/projects/${pid}/activities/${a3.data.id}`, A, { startDate: utcDay(9), endDate: utcDay(22) });
check('rescheduled meeting suggested again on next move', back.data.meetingSuggestions?.length === 1 && back.data.shiftDays === -3);
await call('PUT', `/api/meetings/${m.data.id}/reschedule`, A, { startDate: back.data.meetingSuggestions[0].suggestedStart });

// Project detail shape for the chart
const detail = await call('GET', `/api/projects/${pid}`, B);
check('detail has phases, activities, meetings', detail.data.phases.length === 3 && detail.data.activities.length === 5 &&
  detail.data.activities.find(a => a.id === a3.data.id)?.meetings?.length === 1 && !!detail.data.activities.find(a => a.id === a3.data.id)?.responsible);

// Phase deletion keeps activities
const tmpPhase = await call('POST', `/api/projects/${pid}/phases`, A, { name: 'Temp', startDate: utcDay(0), endDate: utcDay(2) });
const tmpAct = await mk({ title: 'Temp activity', phaseId: tmpPhase.data.id });
await call('DELETE', `/api/projects/${pid}/phases/${tmpPhase.data.id}`, A);
const after = await call('GET', `/api/projects/${pid}`, A);
check('deleting a phase keeps its activities', after.data.activities.find(a => a.id === tmpAct.data.id)?.phaseId === null);
await call('DELETE', `/api/projects/${pid}/activities/${tmpAct.data.id}`, A);
await call('DELETE', `/api/projects/${other.data.id}`, A);

// Clean up: delete the project and both temporary accounts.
await call('DELETE', `/api/projects/${pid}`, A);
for (const t of tokens) await call('DELETE', '/api/auth/me', t);
cleanOutbox(tag);
console.log(`\n${pass} passed, ${fail} failed`);

process.exitCode = fail > 0 ? 1 : 0;
