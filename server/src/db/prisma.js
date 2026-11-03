import { PrismaClient } from '@prisma/client';

let prisma;

export function getPrisma() {
  if (!process.env.DATABASE_URL) return null;
  prisma ??= new PrismaClient();
  return prisma;
}

export async function disconnectPrisma() {
  if (prisma) await prisma.$disconnect();
}
