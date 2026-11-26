import { createHmac, randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { RefreshToken } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { testEnv } from './env.js';

export function hashRefreshTokenForTest(token: string): string {
  return createHmac('sha256', testEnv.JWT_REFRESH_SECRET!)
    .update(token)
    .digest('hex');
}

type FakeWhere = {
  id?: string;
  userId?: string;
  familyId?: string;
  tokenHash?: string;
  revokedAt?: Date | null;
  expiresAt?: { lt: Date };
};

function matches(row: RefreshToken, where: FakeWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.familyId !== undefined && row.familyId !== where.familyId) {
    return false;
  }
  if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) {
    return false;
  }
  if (where.revokedAt === null && row.revokedAt !== null) return false;
  if (where.expiresAt?.lt && row.expiresAt >= where.expiresAt.lt) return false;
  return true;
}

export function createInMemoryPrisma() {
  const refreshTokens = new Map<string, RefreshToken>();

  const seedRefreshToken = (
    input: Pick<RefreshToken, 'userId' | 'familyId' | 'tokenHash' | 'expiresAt'> &
      Partial<RefreshToken>,
  ): RefreshToken => {
    const row: RefreshToken = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      familyId: input.familyId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt ?? null,
      createdAt: input.createdAt ?? new Date(),
    };
    refreshTokens.set(row.id, row);
    return row;
  };

  const refreshToken = {
    findUnique: vi.fn(async ({ where }: { where: FakeWhere }) => {
      if (!where.tokenHash) return null;
      return (
        [...refreshTokens.values()].find(
          (row) => row.tokenHash === where.tokenHash,
        ) ?? null
      );
    }),
    create: vi.fn(
      async ({
        data,
      }: {
        data: Pick<
          RefreshToken,
          'userId' | 'familyId' | 'tokenHash' | 'expiresAt'
        > &
          Partial<RefreshToken>;
      }) => seedRefreshToken(data),
    ),
    updateMany: vi.fn(
      async ({ where, data }: { where: FakeWhere; data: Partial<RefreshToken> }) => {
        let count = 0;
        for (const row of refreshTokens.values()) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    ),
    deleteMany: vi.fn(async ({ where }: { where: FakeWhere }) => {
      let count = 0;
      for (const [id, row] of refreshTokens) {
        if (matches(row, where)) {
          refreshTokens.delete(id);
          count += 1;
        }
      }
      return { count };
    }),
  };

  const prisma = {
    refreshToken,
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
    $transaction: vi.fn(
      async (fn: (client: unknown) => Promise<unknown>) => fn(prisma),
    ),
  } as unknown as PrismaService;

  return {
    prisma,
    refreshToken,
    refreshTokens,
    seedRefreshToken,
    clear: () => refreshTokens.clear(),
  };
}
