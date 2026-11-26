import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  INVALID_REFRESH_TOKEN,
  RefreshTokenService,
} from '../../src/auth/refresh-token.service.js';
import { Role } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { createPrisma, integrationConfig, resetDb } from './fixtures.js';

describe('RefreshTokenService against Postgres', () => {
  let prisma: PrismaService;
  let service: RefreshTokenService;
  let userId: string;

  beforeAll(async () => {
    prisma = await createPrisma();
    service = new RefreshTokenService(prisma, integrationConfig());
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const user = await prisma.user.create({
      data: {
        email: 'holder@example.com',
        passwordHash: 'not-used-by-these-tests',
        role: Role.USER,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('issues, rotates and revokes the whole family on reuse', async () => {
    const token = await service.issue(userId);
    const rotated = await service.rotate(token);
    const family = await prisma.refreshToken.findMany({
      where: { familyId: rotated.familyId },
    });

    expect(rotated.userId).toBe(userId);
    expect(family).toHaveLength(2);
    // The old token is revoked at rotation time; the new one stays usable.
    expect(family.filter((row) => row.revokedAt !== null)).toHaveLength(1);
    expect(family.filter((row) => row.revokedAt === null)).toHaveLength(1);

    const reuse = await service.rotate(token).catch((caught: unknown) => caught);
    expect((reuse as Error).message).toBe(INVALID_REFRESH_TOKEN);

    const revoked = await prisma.refreshToken.findMany({
      where: { familyId: rotated.familyId },
    });
    expect(revoked).toHaveLength(2);
    expect(revoked.every((row) => row.revokedAt !== null)).toBe(true);
    await expect(service.rotate(rotated.token)).rejects.toThrow(
      INVALID_REFRESH_TOKEN,
    );
  });

  it('allows exactly one of two concurrent rotations and revokes the family', async () => {
    // Repeated to reduce the chance that a lucky scheduling order hides a race.
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const familyId = randomUUID();
      const token = await service.issue(userId, familyId);

      const outcomes = await Promise.allSettled([
        service.rotate(token),
        service.rotate(token),
      ]);
      const successes = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<RefreshTokenService['rotate']>>> =>
          outcome.status === 'fulfilled',
      );
      const failures = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
      );

      expect(successes, `iteration ${iteration}`).toHaveLength(1);
      expect(failures, `iteration ${iteration}`).toHaveLength(1);
      expect((failures[0]!.reason as Error).message).toBe(
        INVALID_REFRESH_TOKEN,
      );

      const rows = await prisma.refreshToken.findMany({ where: { familyId } });
      expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
      await expect(service.rotate(token)).rejects.toThrow(
        INVALID_REFRESH_TOKEN,
      );
      await expect(service.rotate(successes[0]!.value.token)).rejects.toThrow(
        INVALID_REFRESH_TOKEN,
      );
    }
  });

  it('deletes a user\'s refresh tokens through the schema cascade', async () => {
    await service.issue(userId);
    await service.issue(userId);

    await prisma.user.delete({ where: { id: userId } });

    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('purges only rows older than the grace window', async () => {
    const oldHash = 'old-token-hash';
    const withinGraceHash = 'within-grace-token-hash';
    const freshHash = 'fresh-token-hash';
    await prisma.refreshToken.createMany({
      data: [
        {
          userId,
          familyId: randomUUID(),
          tokenHash: oldHash,
          expiresAt: new Date(Date.now() - 10 * 60_000),
        },
        {
          userId,
          familyId: randomUUID(),
          tokenHash: withinGraceHash,
          expiresAt: new Date(Date.now() - 30_000),
        },
        {
          userId,
          familyId: randomUUID(),
          tokenHash: freshHash,
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      ],
    });

    await service.purgeExpired();

    expect(
      await prisma.refreshToken.findUnique({ where: { tokenHash: oldHash } }),
    ).toBeNull();
    expect(
      await prisma.refreshToken.findUnique({
        where: { tokenHash: withinGraceHash },
      }),
    ).not.toBeNull();
    expect(
      await prisma.refreshToken.findUnique({ where: { tokenHash: freshHash } }),
    ).not.toBeNull();
  });
});
