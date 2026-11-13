// Optional personal ID code (e.g. a Lithuanian "asmens kodas"). It is sensitive personal data, so it is only
// stored encrypted (AES-256-GCM with the server key) and only shown to the user themself.
import { decrypt, encrypt } from './crypto';

/** "" / null = remove; letters, digits and hyphens, 4-20 characters; undefined = invalid. */
export function parseIdCode(value: unknown): string | null | undefined {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string') return undefined;
  const code = value.trim();
  return /^[A-Za-z0-9-]{4,20}$/.test(code) ? code : undefined;
}

export const ID_CODE_ERROR = 'The ID code may contain only letters, digits and hyphens (4-20 characters)';
export const encryptIdCode = (code: string | null) => (code ? encrypt(code) : null);
export const readIdCode = (stored: string | null | undefined) => (stored ? decrypt(stored) : null);
