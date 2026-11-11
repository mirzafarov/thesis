// End-to-end test: time zone preferences, free-slot search API, automatic confirmation by majority.
import { BACKEND as HELPER_BACKEND } from './helpers.mjs';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const API = process.env.API || 'http://localhost:5021';
const BACKEND = HELPER_BACKEND;
const OUTBOX = path.join(BACKEND, 'mail-outbox');
const { PrismaClient } = createRequire(path.join(BACKEND, 'package.json'))('@prisma/client');
const prisma = new PrismaClient();

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(method, p, token, body) {
  const res = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const outbox = email => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []).map(f => fs.readFileSync(path.join(OUTBOX, f), 'utf8')).filter(b => b.startsWith(`<!-- To: ${email} |`));
const hourIn = (iso, tz) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso)));
const weekdayIn = (iso, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(iso));
// Local calendar date (not UTC: just after midnight the UTC date is still yesterday).
const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const people = [
  { email: `tz-a-${tag}@example.test`, firstName: 'Ana', lastName: 'Vilnius', timeZone: 'Europe/Vilnius' },
  { email: `tz-b-${tag}@example.test`, firstName: 'Bob', lastName: 'Newyork', timeZone: 'America/New_York' },
  { email: `tz-c-${tag}@example.test`, firstName: 'Cid', lastName: 'Vilnius', timeZone: 'Europe/Vilnius' },
];
const tok = {}, id = {};

try {
  for (const p of people) {
    await call('POST', '/api/auth/register', null, { ...p, password, gdprConsent: true });
    await sleep(300);
    const t = outbox(p.email)[0].match(/token=([A-Za-z0-9_-]{20,})/)[1];
    await call('POST', '/api/auth/verify-email', null, { token: t });
    const l = await call('POST', '/api/auth/login', null, { email: p.email, password });
    tok[p.firstName] = l.data.token; id[p.firstName] = l.data.user.id;
  }
  const me = await call('GET', '/api/auth/me', tok.Bob);
  check('time zone saved from the browser at sign-up', me.data.timeZone === 'America/New_York' && me.data.workdayStart === 9 && me.data.workdayEnd === 17);
  check('invalid time zone rejected', (await call('PUT', '/api/users/me/preferences', tok.Bob, { timeZone: 'Mars/Olympus' })).status === 400);
  check('working day must start before it ends', (await call('PUT', '/api/users/me/preferences', tok.Bob, { workdayStart: 17, workdayEnd: 9 })).status === 400);
  check('valid preferences saved', (await call('PUT', '/api/users/me/preferences', tok.Bob, { timeZone: 'America/New_York', workdayStart: 9, workdayEnd: 17 })).status === 200);

  const p = await call('POST', '/api/projects', tok.Ana, { name: `TZ ${tag}` });
  const pid = p.data.id;
  for (const n of ['Bob', 'Cid']) await call('POST', `/api/projects/${pid}/members`, tok.Ana, { newMemberUserId: id[n] });
  const outsider = await call('POST', '/api/projects', tok.Bob, { name: `Other ${tag}` });

  // ---- Search across several days ----
  const start = new Date(); const end = new Date(Date.now() + 10 * 86400e3);
  let r = await call('POST', '/api/calendar/suggest', tok.Ana, { projectId: pid, durationMin: 60, mode: 'range', startDate: key(start), endDate: key(end) });
  check('range search returns 3–5 options', r.status === 200 && r.data.slots.length >= 3 && r.data.slots.length <= 5, `${r.data?.slots?.length}`);
  check('every option inside everyone\'s working hours (16:00 Vilnius = 09:00 New York)',
    r.data.slots.every(s => hourIn(s.start, 'Europe/Vilnius') === 16 && hourIn(s.start, 'America/New_York') === 9), r.data.slots.map(s => s.start).join(' '));
  check('no weekends', r.data.slots.every(s => !['Sat', 'Sun'].includes(weekdayIn(s.start, 'Europe/Vilnius'))));
  check('participants and their zones returned', r.data.participants.length === 3 && r.data.participants.some(x => x.timeZone === 'America/New_York'));
  check('exactly one option marked best', r.data.slots.filter(s => s.best).length === 1);
  const first = r.data.slots[0].start;

  // ---- Single day on a weekend -> nothing, with the reason ----
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7));
  r = await call('POST', '/api/calendar/suggest', tok.Ana, { projectId: pid, durationMin: 60, mode: 'day', date: key(sat) });
  check('weekend day -> no options, reason: outside working hours', r.status === 200 && r.data.slots.length === 0 && r.data.stats.outsideHours === r.data.stats.checked);
  // ---- Time window that cannot overlap with New York ----
  r = await call('POST', '/api/calendar/suggest', tok.Ana, { projectId: pid, durationMin: 60, mode: 'range', startDate: key(start), endDate: key(end), fromHour: 9, toHour: 12 });
  check('morning window in Vilnius (night in NY) -> no options', r.data.slots.length === 0);
  // ---- Access control ----
  check('cannot search a project you are not in', (await call('POST', '/api/calendar/suggest', tok.Cid, { projectId: outsider.data.id, durationMin: 60, mode: 'day', date: key(end) })).status === 403);
  check('range over 31 days rejected', (await call('POST', '/api/calendar/suggest', tok.Ana, { projectId: pid, durationMin: 60, mode: 'range', startDate: key(start), endDate: key(new Date(Date.now() + 60 * 86400e3)) })).status === 400);

  // ---- Poll + automatic confirmation by majority (2 of 3 YES) ----
  r = await call('POST', '/api/calendar/suggest', tok.Ana, { projectId: pid, durationMin: 60, mode: 'range', startDate: key(start), endDate: key(end) });
  const [s1, s2] = r.data.slots.map(s => s.start);
  const m = await call('POST', '/api/meetings/poll', tok.Ana, { projectId: pid, title: 'Sprint review', durationMin: 60, proposedSlots: [s1, s2], participantIds: [id.Bob, id.Cid] });
  const mid = m.data.id;
  let list = (await call('GET', '/api/meetings', tok.Ana)).data.find(x => x.id === mid);
  check('meeting list shows tallies and majority needed', list.poll.majority === 2 && list.poll.tallies.length === 2 && list.poll.voted === 0);
  check('participants\' time zones included', list.participants.some(pp => pp.user.timeZone === 'America/New_York'));
  const pending = (await call('GET', '/api/meetings/polls/pending', tok.Bob)).data.find(x => x.id === mid);
  check('pending poll includes participants\' zones', pending.meeting.participants.some(pp => pp.user.timeZone === 'Europe/Vilnius'));

  let v = await call('POST', `/api/meetings/poll/${mid}/vote`, tok.Bob, { votes: [{ selectedSlot: s1, availability: 'YES' }, { selectedSlot: s2, availability: 'NO' }] });
  check('1 of 3 YES -> not confirmed yet', v.status === 201 && v.data.autoConfirmed === null);
  v = await call('POST', `/api/meetings/poll/${mid}/vote`, tok.Cid, { votes: [{ selectedSlot: s1, availability: 'YES' }, { selectedSlot: s2, availability: 'IF_NECESSARY' }] });
  check('2 of 3 YES -> confirmed automatically', v.data.autoConfirmed?.startDate === s1);
  list = (await call('GET', '/api/meetings', tok.Ana)).data.find(x => x.id === mid);
  check('meeting now confirmed at the winning time', ['CONFIRMED', 'CALENDAR_SYNCHRONIZED'].includes(list.status) && list.startDate === s1);
  check('voting closed afterwards', (await call('POST', `/api/meetings/poll/${mid}/vote`, tok.Ana, { votes: [{ selectedSlot: s2, availability: 'YES' }] })).status === 400);
  const log = await prisma.auditLog.findFirst({ where: { projectId: pid, action: 'MEETING_AUTO_CONFIRMED' } });
  check('auto-confirmation recorded in the audit log', /2 of 3 participants voted YES/.test(log?.details || ''), log?.details);

  await sleep(1000);
  const bobMail = outbox(people[1].email).find(b => b.includes('Confirmed: Sprint review'));
  const anaMail = outbox(people[0].email).find(b => b.includes('Confirmed: Sprint review'));
  check('confirmation email to New York shows New York time', !!bobMail && /09:00 (GMT-5|EST)/.test(bobMail), bobMail?.match(/When: <strong>([^<]+)/)?.[1]);
  check('confirmation email to Vilnius shows Vilnius time', !!anaMail && /16:00 (EET|GMT\+2)/.test(anaMail), anaMail?.match(/When: <strong>([^<]+)/)?.[1]);

  // ---- Confirmed meeting now counts as busy ----
  r = await call('POST', '/api/calendar/suggest', tok.Ana, { projectId: pid, durationMin: 60, mode: 'range', startDate: key(start), endDate: key(end) });
  check('confirmed meeting time is no longer suggested', !r.data.slots.some(s => s.start === s1) && r.data.stats.busy > 0);

  await call('DELETE', `/api/projects/${pid}`, tok.Ana);
  await call('DELETE', `/api/projects/${outsider.data.id}`, tok.Bob);
} catch (e) {
  fail++; console.log('FAIL  unexpected error', e);
} finally {
  for (const t of Object.values(tok)) await call('DELETE', '/api/auth/me', t);
  let removed = 0;
  for (const f of fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []) {
    if (fs.readFileSync(path.join(OUTBOX, f), 'utf8').split('\n')[0].includes(`-${tag}@example.test`)) { fs.unlinkSync(path.join(OUTBOX, f)); removed++; }
  }
  const left = await prisma.user.count({ where: { email: { endsWith: '@example.test' } } });
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed (removed ${removed} test emails, ${left} test users left)`);
}

process.exitCode = fail > 0 ? 1 : 0;
