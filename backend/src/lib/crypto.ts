import crypto from 'crypto';
import { ENCRYPTION_KEY } from './config';

// Derive a fixed 32-byte key from the configured secret, whatever its length.
const KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();

// AES-256-GCM: encrypts and also detects tampering. Format: iv:authTag:ciphertext (hex).
export function encrypt(text: string): string {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

// Returns null when the value cannot be decrypted (wrong key, old format, or tampered data).
export function decrypt(value: string): string | null {
  if (!value) return value;
  const parts = value.split(':');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, data] = parts as [string, string, string];
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
