// Type-safe helpers for caught errors (a `catch` receives `unknown`, not a known error type).
import { Prisma } from '@prisma/client';

/** A readable message from anything that was thrown. */
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The database refused a duplicate (unique constraint, Prisma code P2002), e.g. "already a member". */
export const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
