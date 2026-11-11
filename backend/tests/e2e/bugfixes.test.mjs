// End-to-end check of the review fixes: access control, polls, voting, AI routes, GDPR export and deletion.
import crypto from 'node:crypto';
import { API, signUpAndConfirm, cleanOutbox } from './helpers.mjs';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data; try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const tag = crypto.randomBytes(4).toString('hex');
const password = `Zq!${crypto.randomBytes(9).toString('base64url')}9a`;
const users = [
  { email: `e2e-a-${tag}@example.test`, firstName: 'Testa', lastName: 'Organizer' },
  { email: `e2e-b-${tag}@example.test`, firstName: 'Testb', lastName: 'Member' },
];

const tokens = [];
const ids = [];
try {
  for (const u of users) {
    const status = await signUpAndConfirm(u, password);
    check(`register ${u.firstName}`, status === 201);
    const l = await call('POST', '/api/auth/login', null, { email: u.email, password });
    check(`login ${u.firstName}`, l.status === 200 && !!l.data?.token);
    tokens.push(l.data.token); ids.push(l.data.user.id);
  }
  const [A, B] = tokens;

  // Projects and access control
  const p = await call('POST', '/api/projects', A, { name: `E2E ${tag}`, description: 'temp' });
  check('A creates project', p.status === 201);
  const pid = p.data.id;
  check('B (not a member) cannot open project', (await call('GET', `/api/projects/${pid}`, B)).status === 403);

  const act = await call('POST', `/api/projects/${pid}/activities`, A, { title: 'Kickoff' });
  check('A (manager) adds activity', act.status === 201);
  const list = await call('GET', '/api/projects', A);
  const listed = list.data.find(x => x.id === pid);
  check('project list includes activities', listed?.activities?.length === 1);

  check('member add with no role uses EMPLOYEE', (await call('POST', `/api/projects/${pid}/members`, A, { newMemberUserId: ids[1] })).status === 201);
  check('B (employee) cannot delete activity', (await call('DELETE', `/api/projects/${pid}/activities/${act.data.id}`, B)).status === 403);
  check('B (employee) cannot change activity status', (await call('PUT', `/api/projects/${pid}/activities/${act.data.id}`, B, { status: 'COMPLETED' })).status === 403);
  check('A can change activity status', (await call('PUT', `/api/projects/${pid}/activities/${act.data.id}`, A, { status: 'IN_PROGRESS' })).data?.activity?.status === 'IN_PROGRESS');
  check('invalid status rejected', (await call('PUT', `/api/projects/${pid}/activities/${act.data.id}`, A, { status: 'BOGUS' })).status === 400);

  // Meeting poll, voting, finalize
  const slots = [new Date(Date.now() + 86400000), new Date(Date.now() + 2 * 86400000)].map(d => { d.setUTCMinutes(0, 0, 0); return d.toISOString(); });
  const m = await call('POST', '/api/meetings/poll', A, {
    projectId: pid, activityId: act.data.id, title: 'E2E sync', description: 'temp', durationMin: 30,
    proposedSlots: slots, participantIds: [ids[1], '00000000-0000-0000-0000-000000000000'],
  });
  check('A creates poll (non-member id ignored)', m.status === 201);
  const mid = m.data.id;

  const pending = await call('GET', '/api/meetings/polls/pending', B);
  check('B sees pending poll', pending.data.some(x => x.id === mid));
  const v1 = await call('POST', `/api/meetings/poll/${mid}/vote`, B, { votes: slots.map(s => ({ selectedSlot: s, availability: 'YES' })) });
  check('B votes', v1.status === 201 && v1.data.votes.length === 2 && v1.data.autoConfirmed === null);
  const v2 = await call('POST', `/api/meetings/poll/${mid}/vote`, B, { votes: [{ selectedSlot: slots[0], availability: 'NO' }] });
  check('B changes vote (no duplicate error)', v2.status === 201 && v2.data.votes[0]?.vote === 'NO');

  check('B cannot finalize', (await call('POST', `/api/meetings/${mid}/finalize`, B, { finalStartDate: slots[0] })).status === 403);
  check('A cannot finalize at an unproposed time', (await call('POST', `/api/meetings/${mid}/finalize`, A, { finalStartDate: new Date().toISOString() })).status === 400);
  const fin = await call('POST', `/api/meetings/${mid}/finalize`, A, { finalStartDate: slots[1] });
  check('A finalizes', fin.status === 200 && fin.data.status === 'CONFIRMED', `calendarSynced=${fin.data?.calendarSynced}`);
  check('voting closed after finalize', (await call('POST', `/api/meetings/poll/${mid}/vote`, B, { votes: [] })).status === 400);

  // AI routes: access checks (do not spend Gemini quota on outsiders)
  const outsider = await call('POST', '/api/ai/generate', null, { meetingId: mid, draftType: 'AGENDA', prompt: 'x' });
  check('AI requires login', outsider.status === 401);
  check('AI rejects unknown draft type', (await call('POST', '/api/ai/generate', A, { meetingId: mid, draftType: 'POEM', prompt: 'x' })).status === 400);
  const draft = await call('POST', `/api/meetings/${mid}/email-draft`, B, { responseType: 'ACCEPT' });
  check('AI email draft no longer crashes', draft.status === 200 && typeof draft.data?.draft === 'string', draft.status === 200 ? `${draft.data.draft.length} chars` : JSON.stringify(draft.data));

  // GDPR export
  const exp = await call('GET', '/api/auth/me/export', A);
  const expText = JSON.stringify(exp.data);
  check('export has no password hash', exp.status === 200 && !expText.includes('passwordHash'));
  check('export has no calendar tokens', !expText.includes('accessToken') && !expText.includes('refreshToken'));

  // Cleanup project (manager delete) — B cannot, A can
  check('B cannot delete project', (await call('DELETE', `/api/projects/${pid}`, B)).status === 403);
  check('A deletes project', (await call('DELETE', `/api/projects/${pid}`, A)).status === 200);

  // Account deletion must not leave projects behind empty or without a manager.
  const solo = await call('POST', '/api/projects', A, { name: `Solo ${tag}` });
  const shared = await call('POST', '/api/projects', A, { name: `Shared ${tag}` });
  await call('POST', `/api/projects/${shared.data.id}/members`, A, { newMemberUserId: ids[1], role: 'EMPLOYEE' });
  const delA = await call('DELETE', '/api/auth/me', A);
  check('delete account Testa (GDPR; has LOGIN audit entries)', delA.status === 200, JSON.stringify(delA.data));
  tokens[0] = null;
  const bProjects = (await call('GET', '/api/projects', B)).data;
  const sharedNow = bProjects.find(p => p.id === shared.data.id);
  check('project shared with others: remaining member becomes manager', sharedNow?.members.find(m => m.userId === ids[1])?.role === 'MANAGER');
  check('project with no other members is deleted with the account', !bProjects.some(p => p.id === solo.data.id));
  check('B can manage the inherited project', (await call('DELETE', `/api/projects/${shared.data.id}`, B)).status === 200);
} catch (e) {
  fail++; console.log('FAIL  unexpected error', e);
} finally {
  // Account deletion (the GDPR fix): both users have LOGIN audit entries, which used to block this.
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i]) continue;
    const d = await call('DELETE', '/api/auth/me', tokens[i]);
    check(`delete account ${users[i].firstName}`, d.status === 200, JSON.stringify(d.data));
  }
  cleanOutbox(tag);
  console.log(`\n${pass} passed, ${fail} failed`);
}

process.exitCode = fail > 0 ? 1 : 0;
