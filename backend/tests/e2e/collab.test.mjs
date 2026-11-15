// End-to-end test: meeting agenda + confirmations, shared notes, encryption at rest, project email groups,
// and private meetings (hidden from project managers who are not invited).
import crypto from 'node:crypto';
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
const mailsTo = (email, part) => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []).filter(f => f.endsWith('.html'))
  .map(f => fs.readFileSync(path.join(OUTBOX, f), 'utf8')).filter(b => b.startsWith(`<!-- To: ${email} |`) && b.split('\n')[0].includes(part));

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const people = {
  M: { email: `c-m-${tag}@example.test`, firstName: 'Mara', lastName: 'Manager' },
  M2: { email: `c-n-${tag}@example.test`, firstName: 'Nils', lastName: 'Comanager' },
  E: { email: `c-e-${tag}@example.test`, firstName: 'Emil', lastName: 'Employee' },
  O: { email: `c-o-${tag}@example.test`, firstName: 'Olga', lastName: 'Observer' },
  X: { email: `c-x-${tag}@example.test`, firstName: 'Xena', lastName: 'Outsider' },
};
const tok = {}, id = {};
const SECRET_NOTE = `Budget approved ${tag}; supplier price stays confidential`;

try {
  for (const [k, p] of Object.entries(people)) {
    await signUpAndConfirm(p, password);
    const l = await call('POST', '/api/auth/login', null, { email: p.email, password });
    tok[k] = l.data.token; id[k] = l.data.user.id;
  }
  const pid = (await call('POST', '/api/projects', tok.M, { name: `Collab ${tag}` })).data.id;
  await call('POST', `/api/projects/${pid}/members`, tok.M, { newMemberUserId: id.M2, role: 'MANAGER' });
  await call('POST', `/api/projects/${pid}/members`, tok.M, { newMemberUserId: id.E, role: 'EMPLOYEE' });
  await call('POST', `/api/projects/${pid}/members`, tok.M, { newMemberUserId: id.O, role: 'OBSERVER' });
  const slot = new Date(Date.now() + 2 * 86400e3); slot.setUTCMinutes(0, 0, 0);
  const meeting = (await call('POST', '/api/meetings/poll', tok.M, { projectId: pid, title: 'Kick-off', durationMin: 30, proposedSlots: [slot.toISOString()], participantIds: [id.E, id.O] })).data;
  const base = `/api/meetings/${meeting.id}`;

  // ---- Agenda ----
  check('participant cannot write the agenda', (await call('PUT', `${base}/agenda`, tok.E, { agenda: 'x' })).status === 403);
  check('nothing to confirm before there is an agenda', (await call('POST', `${base}/agenda/confirm`, tok.E, {})).status === 400);
  let r = await call('PUT', `${base}/agenda`, tok.M, { agenda: '1. Welcome\n2. Budget' });
  check('organizer writes the agenda', r.status === 200);
  check('participant confirms the agenda', (await call('POST', `${base}/agenda/confirm`, tok.E, {})).status === 200);
  check('observer cannot confirm', (await call('POST', `${base}/agenda/confirm`, tok.O, {})).status === 403);
  r = await call('GET', `${base}/notes`, tok.E);
  check('confirmations are listed', r.data.confirmedByMe === true && r.data.confirmations.length === 1 && r.data.participants === 3, `${r.data.confirmations?.length} of ${r.data.participants}`);
  await call('PUT', `${base}/agenda`, tok.M, { agenda: '1. Welcome\n2. Budget\n3. Next steps' });
  r = await call('GET', `${base}/notes`, tok.E);
  check('changing the agenda asks everyone to confirm again', r.data.confirmations.length === 0 && r.data.agenda.includes('Next steps'));
  check('too long agenda refused', (await call('PUT', `${base}/agenda`, tok.M, { agenda: 'a'.repeat(10001) })).status === 400);

  // ---- Notes ----
  r = await call('POST', `${base}/notes`, tok.E, { content: SECRET_NOTE });
  const note = r.data;
  check('participant adds a note', r.status === 201 && note.content === SECRET_NOTE);
  check('observer cannot add notes', (await call('POST', `${base}/notes`, tok.O, { content: 'x' })).status === 403);
  check('outsider cannot read notes', (await call('GET', `${base}/notes`, tok.X)).status === 403);
  check('empty note refused', (await call('POST', `${base}/notes`, tok.E, { content: '  ' })).status === 400);
  check('author edits their note', (await call('PATCH', `/api/meeting-notes/${note.id}`, tok.E, { content: SECRET_NOTE + ' (edited)' })).data?.content.endsWith('(edited)'));
  await call('PUT', `${base}/notes-settings`, tok.M, { notesOpen: false });
  check('organizer closes notes: participants can no longer add', (await call('POST', `${base}/notes`, tok.E, { content: 'late' })).status === 403);
  check('... nor change their old notes', (await call('PATCH', `/api/meeting-notes/${note.id}`, tok.E, { content: 'changed' })).status === 403);
  check('organizer can still add notes', (await call('POST', `${base}/notes`, tok.M, { content: 'Organizer note' })).status === 201);
  check('participant cannot change the note setting', (await call('PUT', `${base}/notes-settings`, tok.E, { notesOpen: true })).status === 403);

  // ---- Encryption at rest ----
  const dbNote = await prisma.meetingNote.findUnique({ where: { id: note.id } });
  const dbMeeting = await prisma.meeting.findUnique({ where: { id: meeting.id } });
  check('note is encrypted in the database', dbNote.content.startsWith('enc:v1:') && !dbNote.content.includes('Budget approved'));
  check('agenda is encrypted in the database', dbMeeting.agenda.startsWith('enc:v1:') && !dbMeeting.agenda.includes('Welcome'));
  const noteAudit = await prisma.auditLog.findMany({ where: { projectId: pid, action: 'MEETING_NOTE_ADDED' } });
  check('the audit log never contains the note text', noteAudit.length === 2 && noteAudit.every(a => !a.details.includes('Budget approved')));
  const exp = await call('GET', '/api/auth/me/export', tok.E);
  check('GDPR export contains the user\'s notes readable', exp.data.meetingNotes?.some(n => n.content.startsWith('Budget approved')));

  // ---- Email groups ----
  check('employee cannot create a group', (await call('POST', `/api/projects/${pid}/groups`, tok.E, { name: 'x', memberIds: [id.E] })).status === 403);
  check('a group needs members of the project', (await call('POST', `/api/projects/${pid}/groups`, tok.M, { name: 'Ghosts', memberIds: [id.X] })).status === 400);
  r = await call('POST', `/api/projects/${pid}/groups`, tok.M, { name: 'Steering committee', memberIds: [id.M, id.E, id.O, id.X] });
  const group = r.data;
  check('manager creates a group (outsiders are dropped)', r.status === 201 && group.members.length === 3 && !group.members.some(m => m.id === id.X));
  check('group gets an address label', new RegExp(`^collab-${tag}-steering-committee@groups\\.safezone$`).test(group.alias), group.alias);
  r = await call('GET', `/api/projects/${pid}/groups`, tok.M2);
  check('other managers see all groups', r.data.groups.length === 1 && r.data.canManage === true);
  check('outsider cannot list the groups', (await call('GET', `/api/projects/${pid}/groups`, tok.X)).status === 403);
  r = await call('POST', `/api/groups/${group.id}/messages`, tok.E, { subject: 'Agenda for Friday', body: `Please read the draft. ${tag}` });
  check('member sends a message to the group', r.status === 201 && r.data.recipients === 2);
  check('observer cannot send', (await call('POST', `/api/groups/${group.id}/messages`, tok.O, { subject: 's', body: 'b' })).status === 403);
  check('outsider cannot read the history', (await call('GET', `/api/groups/${group.id}/messages`, tok.X)).status === 403);
  await sleep(1200);
  check('every other member gets the email', mailsTo(people.M.email, '[Steering committee] Agenda for Friday').length === 1 && mailsTo(people.O.email, '[Steering committee]').length === 1);
  check('the sender does not get a copy by email', mailsTo(people.E.email, '[Steering committee]').length === 0);
  r = await call('GET', `/api/groups/${group.id}/messages`, tok.O);
  check('history shows the message (observer can read)', r.data.messages.length === 1 && r.data.messages[0].body.includes(tag) && r.data.canSend === false);
  const dbMsg = await prisma.groupMessage.findFirst({ where: { groupId: group.id } });
  check('group messages are encrypted in the database', dbMsg.subject.startsWith('enc:v1:') && dbMsg.body.startsWith('enc:v1:') && !dbMsg.body.includes(tag));
  r = await call('PUT', `/api/groups/${group.id}`, tok.M, { memberIds: [id.M, id.E] });
  check('manager changes the members', r.status === 200 && r.data.members.length === 2);
  check('removed member no longer sees the group', (await call('GET', `/api/groups/${group.id}/messages`, tok.O)).status === 403);
  check('manager deletes the group', (await call('DELETE', `/api/groups/${group.id}`, tok.M)).status === 200);

  // ---- Private meetings ----
  const priv = (await call('POST', '/api/meetings/poll', tok.M, {
    projectId: pid, title: 'Salary review', durationMin: 30, proposedSlots: [slot.toISOString()], participantIds: [id.E], isPrivate: true,
  })).data;
  check('private meeting created', priv.isPrivate === true);
  const pbase = `/api/meetings/${priv.id}`;
  check('another manager (not invited) cannot read its notes', (await call('GET', `${pbase}/notes`, tok.M2)).status === 403);
  check('... nor its to-dos', (await call('GET', `${pbase}/action-items`, tok.M2)).status === 403);
  check('... nor use the AI on it', (await call('POST', '/api/ai/generate', tok.M2, { meetingId: priv.id, draftType: 'AGENDA', prompt: 'x' })).status === 403);
  check('... nor change its video call', (await call('PUT', `${pbase}/video`, tok.M2, { video: 'none' })).status === 403);
  check('invited participant can read its notes', (await call('GET', `${pbase}/notes`, tok.E)).status === 200);
  check('a normal meeting stays visible to other managers', (await call('GET', `${base}/notes`, tok.M2)).status === 200);
  // Linked to an activity: other members only see "Private meeting" on the Gantt chart
  const act = (await call('POST', `/api/projects/${pid}/activities`, tok.M, { title: 'HR', startDate: '2026-12-01', endDate: '2026-12-10' })).data;
  await prisma.meeting.update({ where: { id: priv.id }, data: { activityId: act.id } });
  const detailM2 = await call('GET', `/api/projects/${pid}`, tok.M2);
  const detailE = await call('GET', `/api/projects/${pid}`, tok.E);
  check('Gantt: not-invited manager sees only "Private meeting"', detailM2.data.activities.find(a => a.id === act.id)?.meetings[0]?.title === 'Private meeting');
  check('Gantt: invited participant sees the title', detailE.data.activities.find(a => a.id === act.id)?.meetings[0]?.title === 'Salary review');

  await call('DELETE', `/api/projects/${pid}`, tok.M);
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
