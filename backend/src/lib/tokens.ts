import crypto from 'crypto';
import type { TokenPurpose } from '@prisma/client';
import { prisma } from './prisma';

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Create a one-time token (any older unused token for the same purpose stops working). Returns the raw token. */
export async function createUserToken(userId: string, purpose: TokenPurpose, validMinutes: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.userToken.create({
      data: { userId, purpose, tokenHash: hash(token), expiresAt: new Date(Date.now() + validMinutes * 60000) },
    }),
  ]);
  return token;
}

/**
 * Use a token: returns its user id if the token exists, has the right purpose, is unused and not expired.
 * The token is marked as used in the same step, so it cannot be used twice (even by two parallel requests).
 */
export async function consumeUserToken(token: unknown, purpose: TokenPurpose): Promise<string | null> {
  if (typeof token !== 'string' || token.length < 20) return null;
  const record = await prisma.userToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!record || record.purpose !== purpose || record.usedAt || record.expiresAt < new Date()) return null;

  const claimed = await prisma.userToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1 ? record.userId : null;
}
