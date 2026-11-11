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
// Time zone used for dates in emails (users' own time zones are not stored yet).
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Europe/Vilnius';
