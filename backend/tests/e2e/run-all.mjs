// Runs every end-to-end suite against a fresh test server.
//   npm run test:e2e            (from the backend folder)
// The test server uses port 5021 (or the port in API), never sends real email (SMTP off: emails go to mail-outbox), and uses
// the database from .env. Each suite creates temporary @example.test users and deletes them afterwards.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BACKEND, API } from './helpers.mjs';

const SUITES = ['bugfixes', 'gantt', 'email', 'security', 'timezones', 'reports', 'admin', 'video', 'todos'];
const only = process.argv.slice(2);
const suites = only.length ? SUITES.filter(s => only.includes(s)) : SUITES;

// Never run against a server that is already there (it may have different settings, e.g. 2FA switched off).
try {
  await fetch(`${API}/api/health`);
  console.error(`Something is already running on ${API}. Stop it, or set API=http://localhost:<free port>.`);
  process.exit(1);
} catch { /* port is free: good */ }

// The admin settings live in the shared database: save them, run the tests with the defaults, then restore them.
const { PrismaClient } = createRequire(path.join(BACKEND, 'package.json'))('@prisma/client');
const prisma = new PrismaClient();
const savedSettings = await prisma.systemSetting.findMany();
// Safety net: the tests must never change existing (real or demo) data. Remember every existing meeting's and
// activity's status now and compare after the run.
const snapshot = async () => new Map([
  ...(await prisma.meeting.findMany({ select: { id: true, status: true, title: true } })).map(m => [`meeting ${m.id}`, `${m.title}: ${m.status}`]),
  ...(await prisma.activity.findMany({ select: { id: true, status: true, title: true } })).map(a => [`activity ${a.id}`, `${a.title}: ${a.status}`]),
]);
const before = await snapshot();
await prisma.systemSetting.deleteMany();
const runStarted = new Date();
const restoreSettings = async () => {
  const after = await snapshot();
  const changed = [...before].filter(([k, v]) => after.has(k) && after.get(k) !== v).map(([k, v]) => `${v} -> ${after.get(k).split(': ').pop()}`);
  if (changed.length) {
    console.error(`\nFAIL  the tests changed ${changed.length} existing record(s):\n  ${changed.join('\n  ')}`);
    results.push({ name: 'real data', passed: 0, failed: changed.length });
  }
  await prisma.systemSetting.deleteMany();
  for (const row of savedSettings) await prisma.systemSetting.create({ data: row });
  // Remove the audit entries the test users produced (their accounts were deleted, so the entries lost their user).
  // Entries of real accounts keep their user id and are never touched.
  const removed = await prisma.auditLog.deleteMany({
    where: { createdAt: { gte: runStarted }, OR: [{ userId: null }, { user: { email: { endsWith: '@example.test' } } }] },
  });
  console.log(`(removed ${removed.count} audit entries created by the test users)`);
  await prisma.$disconnect();
};

// Each suite gets a fresh server, so in-memory state (e.g. rate limits) cannot leak from one suite into the next.
let server = null;
let serverLog = '';
function startServer() {
  serverLog = '';
  server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: BACKEND,
    shell: true,
    env: {
      ...process.env,
      PORT: new URL(API).port || '5021',
      SMTP_HOST: '', // never send real emails from tests
      // No automatic reminder runs on the test server: they would act on everybody's real data.
      // The email and to-do suites run the checks themselves, limited to their own test projects.
      NOTIFICATIONS_OFF: 'true',
      REQUIRE_2FA_FOR_MANAGERS: 'true', // the security suite checks this rule
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', d => (serverLog += d));
  server.stderr.on('data', d => (serverLog += d));
}

async function stopServer() {
  if (!server) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
  server = null;
  // Wait until the port is free again before the next suite starts its server
  for (let i = 0; i < 20; i++) {
    try { await fetch(`${API}/api/health`); } catch { return; }
    await new Promise(r => setTimeout(r, 250));
  }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${API}/api/health`);
      if (res.ok && (await res.json()).message?.includes('Safe Zone')) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

const results = [];
try {
  for (const name of suites) {
    console.log(`\n========== ${name} ==========`);
    startServer();
    if (!(await waitForServer())) {
      console.error('Test server did not start. Is the database running? Server output:\n' + serverLog);
      results.push({ name, passed: 0, failed: 1 });
      break;
    }
    // SMTP off for the suites too: the email suite starts helper processes that would otherwise read .env.
    const run = spawnSync(process.execPath, [path.join(BACKEND, 'tests', 'e2e', `${name}.test.mjs`)], {
      cwd: BACKEND, env: { ...process.env, API, SMTP_HOST: '' }, encoding: 'utf8',
    });
    const out = (run.stdout || '') + (run.stderr || '').split('\n').filter(l => !/Assertion failed|DeprecationWarning|trace-deprecation/.test(l)).join('\n');
    process.stdout.write(out);
    const summary = out.match(/(\d+) passed, (\d+) failed/);
    results.push({ name, passed: Number(summary?.[1] ?? 0), failed: summary ? Number(summary[2]) : 1 });
    await stopServer();
  }
} finally {
  await stopServer();
  await restoreSettings();
  if (results.length) {
    console.log('\n========== summary ==========');
    for (const r of results) console.log(`${r.failed ? 'FAIL' : 'ok  '}  ${r.name.padEnd(10)} ${r.passed} passed, ${r.failed} failed`);
    const failed = results.reduce((s, r) => s + r.failed, 0);
    console.log(`\nTotal: ${results.reduce((s, r) => s + r.passed, 0)} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
    fs.writeFileSync(path.join(BACKEND, 'tests', 'e2e', 'last-run.txt'), results.map(r => `${r.name}: ${r.passed} passed, ${r.failed} failed`).join('\n') + '\n');
  }
}
