import crypto from 'crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from './prisma';
import { encrypt, decrypt } from './crypto';

// Standard TOTP (RFC 6238): 6 digits, 30-second steps, accepts the previous/next step for clock drift.
authenticator.options = { step: 30, digits: 6, window: 1 };

const ISSUER = 'Safe Zone';
const STEP_MS = 30_000;

export async function createPendingSecret(userId: string, email: string) {
  const secret = authenticator.generateSecret(20);
  await prisma.user.update({ where: { id: userId }, data: { totpPendingSecret: encrypt(secret) } });
  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secret, otpauthUrl, qrDataUrl };
}

/** Returns the time step the code belongs to, or null if the code is wrong. */
function matchStep(secret: string, code: string): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  return Math.floor(Date.now() / STEP_MS) + delta;
}

/** Check a code against the secret being set up. */
export function verifyPendingCode(encryptedPending: string | null, code: string) {
  const secret = encryptedPending ? decrypt(encryptedPending) : null;
  if (!secret) return null;
  return matchStep(secret, code);
}

/**
 * Check a login code for a user with 2FA enabled. A code that was already used (same or earlier step)
 * is rejected, so an intercepted code cannot be replayed.
 */
export async function verifyLoginCode(user: { id: string; totpSecret: string | null; totpLastStep: number | null }, code: string) {
  const secret = user.totpSecret ? decrypt(user.totpSecret) : null;
  if (!secret) return false;
  const step = matchStep(secret, code.replace(/\s/g, ''));
  if (step === null || (user.totpLastStep !== null && step <= user.totpLastStep)) return false;
  // Only one request can move totpLastStep forward past this step.
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return claimed.count === 1;
}

// ---------- Recovery codes ----------

const hashCode = (code: string) => crypto.createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

/** Create 10 new one-time recovery codes (replacing old ones). Returns them once, in plain text. */
export async function generateRecoveryCodes(userId: string) {
  const codes = Array.from({ length: 10 }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 characters
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: codes.map(c => ({ userId, codeHash: hashCode(c) })) }),
  ]);
  return codes;
}

/** Use a recovery code (each works once). */
export async function useRecoveryCode(userId: string, code: string) {
  const used = await prisma.recoveryCode.updateMany({
    where: { userId, codeHash: hashCode(code), usedAt: null },
    data: { usedAt: new Date() },
  });
  return used.count === 1;
}

export const remainingRecoveryCodes = (userId: string) =>
  prisma.recoveryCode.count({ where: { userId, usedAt: null } });
