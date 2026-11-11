import { PrismaClient } from '@prisma/client';

// One shared client for the whole app (each `new PrismaClient()` opens its own connection pool).
export const prisma = new PrismaClient();
