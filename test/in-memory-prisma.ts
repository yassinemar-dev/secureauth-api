import { createHmac, randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { RefreshToken, User } from '../src/generated/prisma/client.js';
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

type FakeTransactionOptions = { isolationLevel?: string };

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
  const users = new Map<string, User>();
  const transactionOptions: FakeTransactionOptions[] = [];
  // Transactions are serialized to imitate a database committing one before the next starts.
  let transactionTail: Promise<unknown> = Promise.resolve();

  const seedRefreshToken = (
    input: Pick<RefreshToken, 'userId' | 'familyId' | 'tokenHash' | 'expiresAt'> &
      Partial<RefreshToken>,
  ): RefreshToken => {
    const createdAt = input.createdAt ?? new Date();
    const row: RefreshToken = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      familyId: input.familyId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt ?? null,
      // Older seeds without an explicit session start fall back to creation.
      sessionStartedAt: input.sessionStartedAt ?? createdAt,
      createdAt,
    };
    refreshTokens.set(row.id, row);
    return row;
  };

  const seedUser = (input: User): User => {
    users.set(input.id, input);
    return input;
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

  const user = {
    findUnique: vi.fn(
      async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.email) {
          return (
            [...users.values()].find((row) => row.email === where.email) ?? null
          );
        }
        return null;
      },
    ),
    count: vi.fn(async ({ where }: { where?: { role?: string } } = {}) => {
      if (!where.role) return users.size;
      return [...users.values()].filter((row) => row.role === where.role).length;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<User>;
      }) => {
        const row = users.get(where.id);
        if (!row) throw new Error('Fake user not found');
        Object.assign(row, data);
        return row;
      },
    ),
  };

  const prisma = {
    refreshToken,
    user,
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
    $transaction: vi.fn(
      <T>(
        fn: (client: unknown, options?: FakeTransactionOptions) => Promise<T>,
        options?: FakeTransactionOptions,
      ): Promise<T> => {
        transactionOptions.push(options ?? {});
        const run = transactionTail.then(() => fn(prisma, options));
        transactionTail = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    ),
  } as unknown as PrismaService;

  return {
    prisma,
    refreshToken,
    refreshTokens,
    user,
    users,
    seedRefreshToken,
    seedUser,
    transactionOptions,
    clear: () => {
      refreshTokens.clear();
      users.clear();
      transactionOptions.length = 0;
      transactionTail = Promise.resolve();
    },
  };
}
