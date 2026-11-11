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
