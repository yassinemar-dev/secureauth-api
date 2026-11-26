import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { getTestDatabaseUrl, integrationEnv } from './test-db.js';

export function integrationConfig(
  overrides: Record<string, string> = {},
): ConfigService {
  return new ConfigService({
    ...integrationEnv(getTestDatabaseUrl()),
    ...overrides,
  });
}

export async function createPrisma(): Promise<PrismaService> {
  const prisma = new PrismaService(integrationConfig());
  await prisma.onModuleInit();
  return prisma;
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "refresh_tokens", "users" RESTART IDENTITY CASCADE',
  );
}
