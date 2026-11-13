// Shared helpers for the end-to-end test suites.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUTBOX = path.join(BACKEND, 'mail-outbox');
// A port of its own, so the tests never talk to a dev or demo server by mistake.
export const API = process.env.API || 'http://localhost:5021';

/** Find the newest email to `email` in the local outbox and return the token from its link. */
export async function linkTokenFor(email, subjectPart = '') {
  for (let i = 0; i < 40; i++) {
    const files = fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().reverse() : [];
    for (const f of files) {
      const body = fs.readFileSync(path.join(OUTBOX, f), 'utf8');
      if (body.startsWith(`<!-- To: ${email} |`) && body.split('\n')[0].includes(subjectPart)) {
        const token = body.match(/token=([A-Za-z0-9_-]{20,})/)?.[1];
        if (token) return token;
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

/** Register a user and confirm their email address through the link in the confirmation email. */
export async function signUpAndConfirm(user, password) {
  const reg = await fetch(`${API}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...user, password, gdprConsent: true }),
  });
  const token = await linkTokenFor(user.email, 'Confirm your email');
  await fetch(`${API}/api/auth/verify-email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
  return reg.status;
}

/** Remove this run's emails from the outbox. */
export function cleanOutbox(tag) {
  let removed = 0;
  for (const f of fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX) : []) {
    if (!f.endsWith('.html') || !fs.existsSync(path.join(OUTBOX, f))) continue;
    if (fs.readFileSync(path.join(OUTBOX, f), 'utf8').split('\n')[0].includes(tag)) {
      fs.unlinkSync(path.join(OUTBOX, f));
      removed++;
      // attachments of that email (e.g. the .ics file) are saved as <email name>-<file name>
      const stem = f.slice(0, -'.html'.length) + '-';
      for (const a of fs.readdirSync(OUTBOX)) if (a.startsWith(stem)) fs.unlinkSync(path.join(OUTBOX, a));
    }
  }
  return removed;
}
