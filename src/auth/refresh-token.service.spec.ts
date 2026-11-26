import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import {
  createInMemoryPrisma,
  hashRefreshTokenForTest,
} from '../../test/in-memory-prisma.js';
import { testEnv } from '../../test/env.js';
import { RefreshTokenService } from './refresh-token.service.js';

function makeService() {
  const fake = createInMemoryPrisma();
  const config = {
    getOrThrow: vi.fn((key: string) => {
      if (key === 'JWT_REFRESH_SECRET') return testEnv.JWT_REFRESH_SECRET;
      if (key === 'JWT_REFRESH_TTL') return '7d';
      return undefined;
    }),
  } as unknown as ConfigService;
  return { service: new RefreshTokenService(fake.prisma, config), fake };
}

function rowsByToken(fake: ReturnType<typeof createInMemoryPrisma>, token: string) {
  return [...fake.refreshTokens.values()].find(
    (row) => row.tokenHash === hashRefreshTokenForTest(token),
  );
}

describe('RefreshTokenService', () => {
  it('issues an opaque token and stores only its HMAC hash', async () => {
    const { service, fake } = makeService();

    const token = await service.issue('user-1');

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = [...fake.refreshTokens.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).toBe(hashRefreshTokenForTest(token));
    expect(stored[0]!.tokenHash).not.toBe(token);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored[0]!.familyId).toEqual(expect.any(String));
  });

  it('rotates a token in the same family and revokes the old one', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    const oldToken = await service.issue('user-1', familyId);

    const result = await service.rotate(oldToken);

    expect(result.userId).toBe('user-1');
    expect(result.familyId).toBe(familyId);
    expect(result.token).not.toBe(oldToken);
    expect(rowsByToken(fake, oldToken)!.revokedAt).toBeInstanceOf(Date);
    expect(rowsByToken(fake, result.token)!.familyId).toBe(familyId);
    expect(rowsByToken(fake, result.token)!.revokedAt).toBeNull();
  });

  it('revokes the whole family on reuse, including the newest token', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    const oldToken = await service.issue('user-1', familyId);
    const { token: newest } = await service.rotate(oldToken);

    await expect(service.rotate(oldToken)).rejects.toThrow(
      'Invalid refresh token',
    );

    expect(rowsByToken(fake, newest)!.revokedAt).toBeInstanceOf(Date);
    await expect(service.rotate(newest)).rejects.toThrow(
      'Invalid refresh token',
    );
  });

  it('rejects expired and unknown tokens with the same message', async () => {
    const { service, fake } = makeService();
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId: randomUUID(),
      tokenHash: hashRefreshTokenForTest('expired-token'),
      expiresAt: new Date(Date.now() - 1000),
    });

    const expiredError = await service.rotate('expired-token').catch((e) => e);
    const unknownError = await service.rotate('unknown-token').catch((e) => e);

    expect(expiredError).toBeInstanceOf(UnauthorizedException);
    expect(unknownError).toBeInstanceOf(UnauthorizedException);
    expect((expiredError as Error).message).toBe('Invalid refresh token');
    expect((unknownError as Error).message).toBe(
      (expiredError as Error).message,
    );
  });

  it('treats an atomic update count of zero as family reuse', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    const oldToken = await service.issue('user-1', familyId);
    const sibling = await service.issue('user-1', familyId);

    fake.refreshToken.updateMany.mockImplementationOnce(async () => ({ count: 0 }));

    await expect(service.rotate(oldToken)).rejects.toThrow(
      'Invalid refresh token',
    );

    expect(rowsByToken(fake, sibling)!.revokedAt).toBeInstanceOf(Date);
    await expect(service.rotate(sibling)).rejects.toThrow(
      'Invalid refresh token',
    );
  });

  it('revokes a family by token and all tokens for a user', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    const first = await service.issue('user-1', familyId);
    const second = await service.issue('user-1', familyId);
    const otherFamily = await service.issue('user-1', randomUUID());
    const otherUser = await service.issue('user-2', randomUUID());

    await expect(service.revokeFamily('unknown-token')).resolves.toBeUndefined();
    await service.revokeFamily(first);

    expect(rowsByToken(fake, first)!.revokedAt).toBeInstanceOf(Date);
    expect(rowsByToken(fake, second)!.revokedAt).toBeInstanceOf(Date);
    expect(rowsByToken(fake, otherFamily)!.revokedAt).toBeNull();
    expect(rowsByToken(fake, otherUser)!.revokedAt).toBeNull();

    await service.revokeAllForUser('user-1');

    expect(rowsByToken(fake, otherFamily)!.revokedAt).toBeInstanceOf(Date);
    expect(rowsByToken(fake, otherUser)!.revokedAt).toBeNull();
  });

  it('purges only tokens older than the grace window', async () => {
    const { service, fake } = makeService();
    const oldToken = 'expired-long-ago';
    const graceToken = 'expired-within-grace';
    const futureToken = 'still-valid';
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId: randomUUID(),
      tokenHash: hashRefreshTokenForTest(oldToken),
      expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId: randomUUID(),
      tokenHash: hashRefreshTokenForTest(graceToken),
      expiresAt: new Date(Date.now() - 30 * 1000),
    });
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId: randomUUID(),
      tokenHash: hashRefreshTokenForTest(futureToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await service.purgeExpired();

    expect(rowsByToken(fake, oldToken)).toBeUndefined();
    expect(rowsByToken(fake, graceToken)).toBeDefined();
    expect(rowsByToken(fake, futureToken)).toBeDefined();
  });
});
