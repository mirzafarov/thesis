// End-to-end test: video call links (Jitsi rooms, custom links, in person), permissions, and the links in emails.
// Google Meet needs a real Google account, so here the "auto" option is checked to fall back to Jitsi without one.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
const mailsTo = email => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []).map(f => fs.readFileSync(path.join(OUTBOX, f), 'utf8')).filter(b => b.startsWith(`<!-- To: ${email} |`));
async function waitForMail(email, subjectPart) {
  for (let i = 0; i < 40; i++) {
    const m = mailsTo(email).find(b => b.split('\n')[0].includes(subjectPart));
    if (m) return m;
    await sleep(250);
  }
  return null;
}

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const people = {
  Ana: { email: `video-a-${tag}@example.test`, firstName: 'Ana', lastName: 'Organizer' },
  Bob: { email: `video-b-${tag}@example.test`, firstName: 'Bob', lastName: 'Member' },
};
const tok = {}, id = {};
const JITSI = /^https:\/\/meet\.jit\.si\/SafeZone-[A-Za-z0-9]{1,30}-[0-9a-f]{16}$/;

try {
  for (const [n, p] of Object.entries(people)) {
    await signUpAndConfirm(p, password);
    const l = await call('POST', '/api/auth/login', null, { email: p.email, password });
    tok[n] = l.data.token; id[n] = l.data.user.id;
  }
  const project = await call('POST', '/api/projects', tok.Ana, { name: `Video ${tag}` });
  const pid = project.data.id;
  await call('POST', `/api/projects/${pid}/members`, tok.Ana, { newMemberUserId: id.Bob });

  const slot = new Date(Date.now() + 3 * 86400e3); slot.setUTCMinutes(0, 0, 0);
  const base = { projectId: pid, durationMin: 30, proposedSlots: [slot.toISOString()], participantIds: [id.Bob] };

  // ---- Creating meetings ----
  let r = await call('POST', '/api/meetings/poll', tok.Ana, { ...base, title: 'Kick-off <b>call</b>' });
  const m1 = r.data;
  check('default: an online meeting with a Jitsi room is created', r.status === 201 && m1.videoProvider === 'auto' && JITSI.test(m1.videoUrl), m1.videoUrl);
  check('room name drops characters that are not letters or digits', m1.videoUrl.includes('SafeZone-Kickoffbcallb-'));
  r = await call('POST', '/api/meetings/poll', tok.Ana, { ...base, title: 'Kick-off <b>call</b>', video: 'jitsi' });
  const m2 = r.data;
  check('every meeting gets its own room', r.status === 201 && m2.videoProvider === 'jitsi' && m2.videoUrl !== m1.videoUrl);
  r = await call('POST', '/api/meetings/poll', tok.Ana, { ...base, title: 'Site visit', video: 'none' });
  check('in person: no video link', r.status === 201 && r.data.videoProvider === null && r.data.videoUrl === null);
  const inPerson = r.data;
  r = await call('POST', '/api/meetings/poll', tok.Ana, { ...base, title: 'Zoom', video: 'custom', videoUrl: 'https://zoom.us/j/123456789?pwd=abc' });
  check('own https link accepted', r.status === 201 && r.data.videoProvider === 'custom' && r.data.videoUrl === 'https://zoom.us/j/123456789?pwd=abc');
  for (const bad of ['http://zoom.us/j/1', 'javascript:alert(1)', 'https://user:pw@evil.test/x', 'not a url', `https://x.test/${'a'.repeat(600)}`]) {
    r = await call('POST', '/api/meetings/poll', tok.Ana, { ...base, title: 'Bad', video: 'custom', videoUrl: bad });
    check(`unsafe link refused: ${bad.slice(0, 30)}`, r.status === 400);
  }
  check('unknown video option refused', (await call('POST', '/api/meetings/poll', tok.Ana, { ...base, title: 'Bad', video: 'skype' })).status === 400);

  // ---- Invitation: no link yet (it may still become Google Meet) ----
  const invite = await waitForMail(people.Bob.email, 'Vote on a time: Kick-off');
  check('invitation says the meeting is online', !!invite && invite.includes('Online meeting (video call): the link comes with the confirmation'));
  check('invitation does not contain the room link yet', !!invite && !invite.includes(m1.videoUrl));
  check('meeting title is escaped in the email', !!invite && invite.includes('Kick-off &lt;b&gt;call&lt;/b&gt;'));

  // ---- Permissions ----
  check('participant (not organizer/manager) cannot change the video call', (await call('PUT', `/api/meetings/${m1.id}/video`, tok.Bob, { video: 'none' })).status === 403);

  // ---- Confirmation: "auto" without Google stays Jitsi, link goes into the emails ----
  await call('POST', `/api/meetings/poll/${m1.id}/vote`, tok.Bob, { votes: [{ selectedSlot: slot.toISOString(), availability: 'YES' }] });
  r = await call('POST', `/api/meetings/poll/${m1.id}/vote`, tok.Ana, { votes: [{ selectedSlot: slot.toISOString(), availability: 'YES' }] });
  check('majority confirms the meeting', !!r.data?.autoConfirmed);
  const list = await call('GET', '/api/meetings', tok.Bob);
  const confirmed = list.data.find(m => m.id === m1.id);
  check('without Google the Jitsi room stays (same link)', confirmed?.videoProvider === 'jitsi' && confirmed.videoUrl === m1.videoUrl);
  check('participant sees the link in the meeting list', !!confirmed?.videoUrl);
  const conf = await waitForMail(people.Bob.email, 'Confirmed: Kick-off');
  check('confirmation email has a Join link', !!conf && conf.includes(`href="${m1.videoUrl}"`) && conf.includes('Join on Jitsi Meet'));
  // The local outbox keeps only the HTML part, so the plain-text part is rendered straight from the template.
  const text = spawnSync('npx', ['tsx', '-e', `"import { emails } from './src/lib/emails'; const e = emails.meetingReminder({ email: 'x@example.test', firstName: 'X' }, { id: '1', title: 'T', projectName: 'P', startDate: new Date(), durationMin: 30, videoUrl: 'https://meet.jit.si/r', videoLabel: 'Jitsi Meet' }, '1 hour'); console.log(JSON.stringify(e.text))"`], { cwd: BACKEND, shell: true, encoding: 'utf8' });
  const plain = JSON.parse(text.stdout.trim().split('\n').pop() || '""');
  check('plain-text email has the link too', plain.includes('Video call (Jitsi Meet): https://meet.jit.si/r'), plain.slice(0, 80));
  check('1-hour reminder button joins the call', plain.includes('Join the video call: https://meet.jit.si/r'));
  check('"auto" cannot be chosen after confirmation', (await call('PUT', `/api/meetings/${m1.id}/video`, tok.Ana, { video: 'auto' })).status === 400);

  // ---- Changing the call ----
  r = await call('PUT', `/api/meetings/${m1.id}/video`, tok.Ana, { video: 'jitsi' });
  check('choosing Jitsi again keeps the room (links already sent keep working)', r.status === 200 && r.data.videoUrl === m1.videoUrl);
  r = await call('PUT', `/api/meetings/${m1.id}/video`, tok.Ana, { video: 'custom', videoUrl: 'https://teams.microsoft.com/l/meetup-join/abc' });
  check('switch to own link', r.status === 200 && r.data.videoProvider === 'custom');
  check('own link must be https here too', (await call('PUT', `/api/meetings/${m1.id}/video`, tok.Ana, { video: 'custom', videoUrl: 'ftp://x.test' })).status === 400);
  r = await call('PUT', `/api/meetings/${m1.id}/video`, tok.Ana, { video: 'none' });
  check('switch to in person removes the link', r.status === 200 && r.data.videoUrl === null && r.data.videoProvider === null);
  r = await call('PUT', `/api/meetings/${m1.id}/video`, tok.Ana, { video: 'jitsi' });
  check('back to Jitsi makes a new room', r.status === 200 && JITSI.test(r.data.videoUrl) && r.data.videoUrl !== m1.videoUrl);
  r = await call('PUT', `/api/meetings/${inPerson.id}/video`, tok.Ana, { video: 'auto' });
  check('before confirmation "auto" is allowed', r.status === 200 && r.data.videoProvider === 'auto');

  const audits = await prisma.auditLog.count({ where: { userId: id.Ana, action: 'MEETING_VIDEO_CHANGED' } });
  check('every change is in the audit log', audits === 5, `${audits}`);

  check('outsider cannot change it', (await call('PUT', `/api/meetings/${m1.id}/video`, 'invalid', { video: 'none' })).status === 401);

  await call('DELETE', `/api/projects/${pid}`, tok.Ana);
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
