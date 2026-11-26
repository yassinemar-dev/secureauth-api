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

function makeService(overrides: Record<string, string> = {}) {
  const fake = createInMemoryPrisma();
  const values: Record<string, string> = {
    JWT_REFRESH_SECRET: testEnv.JWT_REFRESH_SECRET!,
    JWT_REFRESH_TTL: '7d',
    MAX_SESSION_AGE: '30d',
    ...overrides,
  };
  const config = {
    getOrThrow: vi.fn((key: string) => values[key]),
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

  it('revokes the family when an already revoked token is replayed after expiry', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('expired-revoked-token'),
      expiresAt: new Date(Date.now() - 60_000),
      revokedAt: new Date(Date.now() - 120_000),
    });
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('sibling-of-expired'),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await expect(service.rotate('expired-revoked-token')).rejects.toThrow(
      'Invalid refresh token',
    );

    expect(
      rowsByToken(fake, 'sibling-of-expired')!.revokedAt,
    ).toBeInstanceOf(Date);
  });

  it('revokes the family when the absolute age is exceeded even if the token expired', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('expired-over-age'),
      sessionStartedAt: new Date(Date.now() - 31 * 86_400_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('sibling-over-age'),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await expect(service.rotate('expired-over-age')).rejects.toThrow(
      'Invalid refresh token',
    );

    expect(rowsByToken(fake, 'sibling-over-age')!.revokedAt).toBeInstanceOf(
      Date,
    );
  });

  it('does not revoke the family for an unrevoked expired token', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('plain-expired-token'),
      expiresAt: new Date(Date.now() - 60_000),
    });
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('sibling-plain-expired'),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await expect(service.rotate('plain-expired-token')).rejects.toThrow(
      'Invalid refresh token',
    );

    expect(rowsByToken(fake, 'sibling-plain-expired')!.revokedAt).toBeNull();
  });

  it('sets a session start on issue and copies it on rotation', async () => {
    const { service, fake } = makeService();
    const before = Date.now();

    const oldToken = await service.issue('user-1');
    const issued = rowsByToken(fake, oldToken)!;
    expect(issued.sessionStartedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(issued.expiresAt.getTime()).toBeLessThanOrEqual(
      issued.sessionStartedAt.getTime() + 30 * 86_400_000,
    );

    const { token: newest } = await service.rotate(oldToken);
    expect(rowsByToken(fake, newest)!.sessionStartedAt).toEqual(
      issued.sessionStartedAt,
    );
  });

  it('revokes the whole family when the absolute session age is exceeded', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('stale-token'),
      sessionStartedAt: new Date(Date.now() - 31 * 86_400_000),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('sibling-token'),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await expect(service.rotate('stale-token')).rejects.toThrow(
      'Invalid refresh token',
    );

    expect(rowsByToken(fake, 'stale-token')!.revokedAt).toBeInstanceOf(Date);
    expect(rowsByToken(fake, 'sibling-token')!.revokedAt).toBeInstanceOf(Date);
  });

  it('caps a rotated token at the absolute session deadline', async () => {
    const { service, fake } = makeService();
    const familyId = randomUUID();
    const startedAt = new Date(Date.now() - 29 * 86_400_000);
    fake.seedRefreshToken({
      userId: 'user-1',
      familyId,
      tokenHash: hashRefreshTokenForTest('near-cap-token'),
      sessionStartedAt: startedAt,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });

    const { token } = await service.rotate('near-cap-token');
    const rotated = rowsByToken(fake, token)!;

    expect(rotated.sessionStartedAt).toEqual(startedAt);
    expect(rotated.expiresAt.getTime()).toBe(
      startedAt.getTime() + 30 * 86_400_000,
    );
    expect(rotated.expiresAt.getTime()).toBeGreaterThan(Date.now());
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

    await expect(service.purgeExpired()).resolves.toBe(1);

    expect(rowsByToken(fake, oldToken)).toBeUndefined();
    expect(rowsByToken(fake, graceToken)).toBeDefined();
    expect(rowsByToken(fake, futureToken)).toBeDefined();
  });
});
