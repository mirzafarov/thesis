// End-to-end test of the reports API: totals, hours per person per month, filters, access scope, audit.
// Saves the manager's report JSON for the export test, then removes all temporary data.
import { BACKEND as HELPER_BACKEND } from './helpers.mjs';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const API = process.env.API || 'http://localhost:5021';
const BACKEND = HELPER_BACKEND;
const OUTBOX = path.join(BACKEND, 'mail-outbox');
const HERE = os.tmpdir();
const { PrismaClient } = createRequire(path.join(BACKEND, 'package.json'))('@prisma/client');
const prisma = new PrismaClient();

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, token, body) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const q = o => '?' + new URLSearchParams(o).toString();

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const ppl = {
  M: { email: `rep-m-${tag}@example.test`, firstName: 'Mara', lastName: 'Manager', timeZone: 'Europe/Vilnius' },
  E: { email: `rep-e-${tag}@example.test`, firstName: 'Emil', lastName: 'Employee', timeZone: 'Europe/Vilnius' },
  O: { email: `rep-o-${tag}@example.test`, firstName: 'Olga', lastName: 'Other', timeZone: 'Europe/Vilnius' },
};
const tok = {}, id = {};

async function meeting(token, projectId, title, category, durationMin, startIso, participantIds) {
  const m = await call('POST', '/api/meetings/poll', token, { projectId, title, category, durationMin, proposedSlots: [startIso], participantIds });
  await call('POST', `/api/meetings/${m.data.id}/finalize`, token, { finalStartDate: startIso });
  return m.data.id;
}

try {
  for (const [k, p] of Object.entries(ppl)) {
    await call('POST', '/api/auth/register', null, { ...p, password, gdprConsent: true });
    await sleep(300);
    const mail = fs.readdirSync(OUTBOX).map(f => fs.readFileSync(path.join(OUTBOX, f), 'utf8')).find(b => b.startsWith(`<!-- To: ${p.email} |`));
    await call('POST', '/api/auth/verify-email', null, { token: mail.match(/token=([A-Za-z0-9_-]{20,})/)[1] });
    const l = await call('POST', '/api/auth/login', null, { email: p.email, password });
    tok[k] = l.data.token; id[k] = l.data.user.id;
  }

  const p1 = (await call('POST', '/api/projects', tok.M, { name: `Thesis app ${tag}`, startDate: '2026-10-01', endDate: '2026-12-31' })).data.id;
  await call('POST', `/api/projects/${p1}/members`, tok.M, { newMemberUserId: id.E, role: 'EMPLOYEE' });
  const p2 = (await call('POST', '/api/projects', tok.O, { name: `Secret ${tag}` })).data.id;

  // Meetings (times in UTC; Vilnius is UTC+3 until 25 Oct, then UTC+2)
  const m1 = await meeting(tok.M, p1, 'Strategy kickoff', 'STRATEGIC', 60, '2026-10-14T08:00:00.000Z', [id.E]);
  await meeting(tok.M, p1, 'Design review', 'REVIEW', 30, '2026-11-04T09:00:00.000Z', [id.E]);
  await meeting(tok.M, p1, 'Planning alone', 'STATUS', 90, '2026-11-05T09:00:00.000Z', []);
  await meeting(tok.M, p1, 'Outside the period', 'OTHER', 60, '2026-12-10T09:00:00.000Z', [id.E]);
  await call('POST', '/api/meetings/poll', tok.M, { projectId: p1, title: 'Open poll', durationMin: 30, proposedSlots: ['2026-11-20T09:00:00.000Z'], participantIds: [id.E] });
  await meeting(tok.O, p2, 'Secret meeting', 'STRATEGIC', 120, '2026-10-20T09:00:00.000Z', []);
  // Minutes for the kickoff (normally written by the AI assistant)
  await prisma.aiDraft.create({ data: { meetingId: m1, userId: id.M, draftType: 'SUMMARY', content: '## Minutes\n- Agreed scope\n- **Action:** Emil drafts the API' } });
  // Activities
  for (const [title, status, s, e] of [['Requirements', 'COMPLETED', '2026-10-01', '2026-10-15'], ['Backend', 'IN_PROGRESS', '2026-10-16', '2026-11-30'], ['Late thing', 'DELAYED', '2026-10-01', '2026-10-10'], ['Next year', 'PENDING', '2027-01-05', '2027-01-20']]) {
    const a = await call('POST', `/api/projects/${p1}/activities`, tok.M, { title, startDate: s, endDate: e });
    if (status !== 'PENDING') await call('PUT', `/api/projects/${p1}/activities/${a.data.id}`, tok.M, { status });
  }

  // ---- Manager, Oct–Nov ----
  let r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30' }), tok.M);
  const rep = r.data;
  check('report loads', r.status === 200);
  check('only own projects (not someone else\'s)', rep.projects.length === 1 && rep.projects[0].name.startsWith('Thesis app'));
  check('3 meetings in the period (December and open poll excluded)', rep.totals.meetings === 3, String(rep.totals.meetings));
  check('meeting hours 1 + 0.5 + 1.5 = 3', rep.totals.meetingHours === 3, String(rep.totals.meetingHours));
  check('person-hours 4.5 (Emil attended 2 of them)', rep.totals.personHours === 4.5, String(rep.totals.personHours));
  check('months Oct and Nov', JSON.stringify(rep.months) === '["2026-10","2026-11"]', JSON.stringify(rep.months));
  const mara = rep.people.find(p => p.id === id.M), emil = rep.people.find(p => p.id === id.E);
  check('Mara: 3 meetings, 3 h (Oct 1, Nov 2)', mara.meetings === 3 && mara.hours === 3 && mara.byMonth['2026-10'] === 1 && mara.byMonth['2026-11'] === 2, JSON.stringify(mara.byMonth));
  check('Emil: 2 meetings, 1.5 h (Oct 1, Nov 0.5)', emil.meetings === 2 && emil.hours === 1.5 && emil.byMonth['2026-11'] === 0.5, JSON.stringify(emil.byMonth));
  const pr = rep.projects[0];
  check('project: minutes, open poll, by type', pr.withMinutes === 1 && pr.openPolls === 1 && pr.byCategory.STRATEGIC === 1 && pr.byCategory.REVIEW === 1 && pr.byCategory.STATUS === 1);
  check('activities overlapping the period with statuses', pr.activities.total === 3 && pr.activities.completed === 1 && pr.activities.delayed === 1 && pr.activities.inProgress === 1, JSON.stringify(pr.activities));
  check('meeting list includes minutes text', rep.meetings.find(m => m.title === 'Strategy kickoff')?.minutes?.includes('Emil drafts the API'));
  check('people filter options: project members', rep.availablePeople.length === 2);

  // ---- Filters ----
  r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30', category: 'STRATEGIC' }), tok.M);
  check('type filter: only strategic meetings', r.data.totals.meetings === 1 && r.data.meetings[0].title === 'Strategy kickoff');
  r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30', userIds: id.E }), tok.M);
  check('person filter: Emil\'s meetings and hours only', r.data.totals.meetings === 2 && r.data.people.length === 1 && r.data.people[0].id === id.E);
  r = await call('GET', '/api/reports' + q({ from: '2026-11-01', to: '2026-11-30' }), tok.M);
  check('date filter: November only', r.data.totals.meetings === 2 && JSON.stringify(r.data.months) === '["2026-11"]');
  r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30', projectIds: p2 }), tok.M);
  check('cannot report on a project you are not in', r.status === 200 && r.data.projects.length === 0 && r.data.totals.meetings === 0);
  check('invalid period rejected', (await call('GET', '/api/reports' + q({ from: '2026-11-30', to: '2026-10-01' }), tok.M)).status === 400);
  check('invalid type rejected', (await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30', category: 'PARTY' }), tok.M)).status === 400);

  // ---- Phase filter: meetings linked to activities of the chosen phases ----
  const design = await prisma.phase.create({ data: { projectId: p1, name: 'Design', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') } });
  const build = await prisma.phase.create({ data: { projectId: p1, name: 'Build', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-30') } });
  const foreign = await prisma.phase.create({ data: { projectId: p2, name: 'Secret phase', startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31') } });
  const reqAct = await prisma.activity.findFirst({ where: { projectId: p1, title: 'Requirements' } });
  const backAct = await prisma.activity.findFirst({ where: { projectId: p1, title: 'Backend' } });
  await prisma.activity.update({ where: { id: reqAct.id }, data: { phaseId: design.id } });
  await prisma.activity.update({ where: { id: backAct.id }, data: { phaseId: build.id } });
  await prisma.meeting.update({ where: { id: m1 }, data: { activityId: reqAct.id } }); // Strategy kickoff → Design
  r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30' }), tok.M);
  check('phase options: the project\'s phases only', r.data.availablePhases.length === 2 && r.data.availablePhases.every(ph => ph.projectId === p1), JSON.stringify(r.data.availablePhases.map(p => p.name)));
  check('meeting list shows the phase of the linked activity', r.data.meetings.find(m => m.title === 'Strategy kickoff')?.phase === 'Design');
  r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30', phaseIds: design.id }), tok.M);
  check('phase filter: only meetings of that phase', r.data.totals.meetings === 1 && r.data.meetings[0].title === 'Strategy kickoff', String(r.data.totals.meetings));
  check('phase filter: only activities of that phase', r.data.activities.length === 1 && r.data.activities[0].title === 'Requirements');
  check('phase filter: named in the report filters', JSON.stringify(r.data.filters.phaseNames) === '["Design"]');
  r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30', phaseIds: `${design.id},${build.id}` }), tok.M);
  check('several phases: activities of both', r.data.activities.length === 2 && r.data.totals.meetings === 1);
  r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30', phaseIds: foreign.id }), tok.M);
  check('a phase of someone else\'s project is ignored', r.status === 200 && r.data.filters.phaseIds.length === 0 && r.data.totals.meetings === 3);

  // ---- Employee sees only their own data ----
  r = await call('GET', '/api/reports' + q({ from: '2026-10-01', to: '2026-11-30' }), tok.E);
  check('employee: only meetings they attended', r.data.totals.meetings === 2, String(r.data.totals.meetings));
  check('employee: only their own hours', r.data.people.length === 1 && r.data.people[0].id === id.E);
  check('employee: project marked as limited view', r.data.projects[0].fullAccess === false);
  check('employee: can filter only by themselves', r.data.availablePeople.length === 1);

  // ---- Export is logged ----
  await call('POST', '/api/reports/log', tok.M, { format: 'XLSX', projectIds: [p1], from: '2026-10-01', to: '2026-11-30' });
  const log = await prisma.auditLog.findFirst({ where: { projectId: p1, action: 'REPORT_EXPORTED' } });
  check('export recorded in audit log', /XLSX report for 2026-10-01 – 2026-11-30/.test(log?.details || ''), log?.details);

  fs.writeFileSync(path.join(HERE, 'report-sample.json'), JSON.stringify(rep));
  await call('DELETE', `/api/projects/${p1}`, tok.M);
  await call('DELETE', `/api/projects/${p2}`, tok.O);
} catch (e) {
  fail++; console.log('FAIL  unexpected error', e);
} finally {
  for (const t of Object.values(tok)) await call('DELETE', '/api/auth/me', t);
  for (const f of fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []) {
    if (fs.readFileSync(path.join(OUTBOX, f), 'utf8').split('\n')[0].includes(`-${tag}@example.test`)) fs.unlinkSync(path.join(OUTBOX, f));
  }
  const left = await prisma.user.count({ where: { email: { endsWith: '@example.test' } } });
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed (${left} test users left)`);
}

process.exitCode = fail > 0 ? 1 : 0;
