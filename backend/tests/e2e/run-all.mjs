// Runs every end-to-end suite against a fresh test server.
//   npm run test:e2e            (from the backend folder)
// The test server uses port 5021 (or the port in API), never sends real email (SMTP off: emails go to mail-outbox), and uses
// the database from .env. Each suite creates temporary @example.test users and deletes them afterwards.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BACKEND, API } from './helpers.mjs';

const SUITES = ['bugfixes', 'gantt', 'email', 'security', 'timezones', 'reports'];
const only = process.argv.slice(2);
const suites = only.length ? SUITES.filter(s => only.includes(s)) : SUITES;

// Never run against a server that is already there (it may have different settings, e.g. 2FA switched off).
try {
  await fetch(`${API}/api/health`);
  console.error(`Something is already running on ${API}. Stop it, or set API=http://localhost:<free port>.`);
  process.exit(1);
} catch { /* port is free: good */ }

const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: BACKEND,
  shell: true,
  env: {
    ...process.env,
    PORT: new URL(API).port || '5021',
    SMTP_HOST: '', // never send real emails from tests
    NOTIFY_INTERVAL_MINUTES: '600', // the email suite triggers reminders itself
    REQUIRE_2FA_FOR_MANAGERS: 'true', // the security suite checks this rule
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => (serverLog += d));
server.stderr.on('data', d => (serverLog += d));

const stopServer = () => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
};

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
  if (!(await waitForServer())) {
    console.error('Test server did not start. Is the database running? Server output:\n' + serverLog);
    process.exitCode = 1;
  } else {
    for (const name of suites) {
      console.log(`\n========== ${name} ==========`);
      // SMTP off for the suites too: the email suite starts helper processes that would otherwise read .env.
      const run = spawnSync(process.execPath, [path.join(BACKEND, 'tests', 'e2e', `${name}.test.mjs`)], {
        cwd: BACKEND, env: { ...process.env, API, SMTP_HOST: '' }, encoding: 'utf8',
      });
      const out = (run.stdout || '') + (run.stderr || '').split('\n').filter(l => !/Assertion failed|DeprecationWarning|trace-deprecation/.test(l)).join('\n');
      process.stdout.write(out);
      const summary = out.match(/(\d+) passed, (\d+) failed/);
      results.push({ name, passed: Number(summary?.[1] ?? 0), failed: summary ? Number(summary[2]) : 1 });
    }
  }
} finally {
  stopServer();
  if (results.length) {
    console.log('\n========== summary ==========');
    for (const r of results) console.log(`${r.failed ? 'FAIL' : 'ok  '}  ${r.name.padEnd(10)} ${r.passed} passed, ${r.failed} failed`);
    const failed = results.reduce((s, r) => s + r.failed, 0);
    console.log(`\nTotal: ${results.reduce((s, r) => s + r.passed, 0)} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
    fs.writeFileSync(path.join(BACKEND, 'tests', 'e2e', 'last-run.txt'), results.map(r => `${r.name}: ${r.passed} passed, ${r.failed} failed`).join('\n') + '\n');
  }
}
