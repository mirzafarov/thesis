import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Add it to backend/.env.`);
  }
  return value;
}

// Secrets must come from the environment: a fallback written in the code is public to anyone who reads it.
export const JWT_SECRET = required('JWT_SECRET');
export const ENCRYPTION_KEY = required('ENCRYPTION_KEY');

export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// Email: without SMTP_HOST, emails are saved as HTML files in backend/mail-outbox instead of being sent.
export const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || 'Safe Zone <no-reply@safezone.local>',
};
// Sessions end after this much inactivity, and in any case after SESSION_MAX_HOURS.
export const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 30);
export const SESSION_MAX_HOURS = Number(process.env.SESSION_MAX_HOURS || 24);
// Two-factor login is mandatory for administrators and project managers (set to "false" to make it optional).
export const REQUIRE_2FA_FOR_MANAGERS = process.env.REQUIRE_2FA_FOR_MANAGERS !== 'false';
// Version of the privacy policy / GDPR rules users accept at sign-up; stored with their consent.
export const PRIVACY_POLICY_VERSION = process.env.PRIVACY_POLICY_VERSION || '1.0';

// Time zone used for dates in emails (users' own time zones are not stored yet).
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Vilnius';
