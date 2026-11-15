// Encryption at rest for user-written content (meeting notes, agendas, AI drafts, group messages).
// Stored as "enc:v1:<iv:tag:ciphertext>" with AES-256-GCM and the server key (ENCRYPTION_KEY in .env).
// Reading still accepts older plain-text rows, so existing data keeps working.
import { decrypt, encrypt } from './crypto';

const PREFIX = 'enc:v1:';

export const isSealed = (value: string | null | undefined) => !!value && value.startsWith(PREFIX);

/** Encrypt before saving. */
export const seal = (text: string) => (text ? PREFIX + encrypt(text) : text);
export const sealOrNull = (text: string | null | undefined) => (text ? seal(text) : null);

/** Decrypt after reading (plain-text rows from before encryption are returned as they are). */
export function open(value: string): string;
export function open(value: string | null | undefined): string | null;
export function open(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  if (!isSealed(value)) return value;
  return decrypt(value.slice(PREFIX.length)) ?? '[this text cannot be decrypted with the current server key]';
}
