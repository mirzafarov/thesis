import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { SMTP } from './config';

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const OUTBOX_DIR = path.resolve(__dirname, '..', '..', 'mail-outbox');

const transporter = SMTP.host
  ? nodemailer.createTransport({
      host: SMTP.host,
      port: SMTP.port,
      secure: SMTP.port === 465,
      auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined,
    })
  : null;

export const mailMode = transporter ? `SMTP (${SMTP.host})` : `local outbox (${OUTBOX_DIR})`;

// Save the email as an HTML file you can open in a browser (development without a mail account).
function saveToOutbox(email: Email) {
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = email.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  const file = path.join(OUTBOX_DIR, `${stamp}-${slug}.html`);
  // Subjects contain user-typed titles: escape them so they cannot break out of the comment when the file is opened.
  const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/--/g, '&#45;&#45;');
  const header = `<!-- To: ${safe(email.to)} | Subject: ${safe(email.subject)} -->\n`;
  fs.writeFileSync(file, header + email.html);
  console.log(`[mail] To ${email.to}: "${email.subject}" (saved to mail-outbox/${path.basename(file)})`);
}

/**
 * Addresses that can never receive mail (reserved for testing and documentation, RFC 2606 / RFC 6761).
 * Email to them is always kept in the local outbox — even when a real mail server is configured —
 * so test and demo accounts never cause real emails or bounce messages.
 */
export function isReservedAddress(address: string) {
  const domain = address.split('@').pop()?.toLowerCase().trim() ?? '';
  return /\.(test|example|invalid|localhost)$/.test(domain) || /^example\.(com|net|org)$/.test(domain);
}

/** Send an email. Never throws: a failed email must not break the action that triggered it. */
export async function sendEmail(email: Email): Promise<boolean> {
  try {
    if (!transporter || isReservedAddress(email.to)) {
      saveToOutbox(email);
      return true;
    }
    await transporter.sendMail({ from: SMTP.from, ...email });
    console.log(`[mail] Sent to ${email.to}: "${email.subject}"`);
    return true;
  } catch (err) {
    console.error(`[mail] Failed to send "${email.subject}" to ${email.to}:`, err);
    return false;
  }
}
