import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { ttlToSeconds } from './ttl.js';

export const INVALID_REFRESH_TOKEN = 'Invalid refresh token';

// A short grace period avoids deleting a token that expired while a request was in flight.
const PURGE_GRACE_MS = 60_000;

type RefreshClient = Pick<PrismaService, 'refreshToken'>;

interface RotatedToken {
  userId: string;
  familyId: string;
  token: string;
}

type RotateOutcome = { ok: true; value: RotatedToken } | { ok: false };

@Injectable()
export class RefreshTokenService {
  private readonly secret: string;
  private readonly refreshTtlSeconds: number;
  private readonly maxSessionAgeSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.refreshTtlSeconds = ttlToSeconds(
      config.getOrThrow<string>('JWT_REFRESH_TTL'),
    );
    this.maxSessionAgeSeconds = ttlToSeconds(
      config.getOrThrow<string>('MAX_SESSION_AGE'),
    );
  }

  // JWT_REFRESH_SECRET doubles as the HMAC pepper: only the server can derive
  // these hashes, and raw refresh tokens are never written to the database.
  private hashToken(rawToken: string): string {
    return createHmac('sha256', this.secret).update(rawToken).digest('hex');
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException(INVALID_REFRESH_TOKEN);
  }

  private expiresAtFor(sessionStartedAt: Date): Date {
    const sliding = Date.now() + this.refreshTtlSeconds * 1000;
    const absolute = sessionStartedAt.getTime() + this.maxSessionAgeSeconds * 1000;
    // Rotation slides the token, but never past the absolute session deadline.
    return new Date(Math.min(sliding, absolute));
  }

  private async issueOn(
    client: RefreshClient,
    userId: string,
    familyId: string,
    sessionStartedAt: Date = new Date(),
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await client.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hashToken(token),
        sessionStartedAt,
        expiresAt: this.expiresAtFor(sessionStartedAt),
      },
    });
    return token;
  }

  private async revokeFamilyOn(
    client: RefreshClient,
    familyId: string,
  ): Promise<void> {
    await client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  issue(userId: string, familyId: string = randomUUID()): Promise<string> {
    return this.issueOn(this.prisma, userId, familyId);
  }

  async rotate(rawToken: string): Promise<RotatedToken> {
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<RotateOutcome> => {
        const row = await tx.refreshToken.findUnique({
          where: { tokenHash: this.hashToken(rawToken) },
        });
        if (!row) {
          return { ok: false };
        }

        // Reuse is checked first: a revoked token is a theft signal even if it
        // has since expired, so the whole family must be revoked.
        if (row.revokedAt) {
          await this.revokeFamilyOn(tx, row.familyId);
          return { ok: false };
        }

        // Old rows created before this column existed fall back to createdAt.
        const sessionStartedAt = row.sessionStartedAt ?? row.createdAt;
        if (
          Date.now() - sessionStartedAt.getTime() >
          this.maxSessionAgeSeconds * 1000
        ) {
          await this.revokeFamilyOn(tx, row.familyId);
          return { ok: false };
        }

        // A genuinely expired, unrevoked token fails without implicating the
        // rest of its family.
        if (row.expiresAt.getTime() <= Date.now()) {
          return { ok: false };
        }

        const revoked = await tx.refreshToken.updateMany({
          where: { id: row.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (revoked.count !== 1) {
          await this.revokeFamilyOn(tx, row.familyId);
          return { ok: false };
        }

        const token = await this.issueOn(
          tx,
          row.userId,
          row.familyId,
          sessionStartedAt,
        );
        return {
          ok: true,
          value: { userId: row.userId, familyId: row.familyId, token },
        };
      },
    );

    // Revocations above must commit before the 401 is thrown.
    if (!outcome.ok) {
      throw this.unauthorized();
    }
    return outcome.value;
  }

  async revokeFamily(rawToken: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.refreshToken.findUnique({
        where: { tokenHash: this.hashToken(rawToken) },
      });
      if (!row) {
        return;
      }
      await this.revokeFamilyOn(tx, row.familyId);
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - PURGE_GRACE_MS);
    const result = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return result.count;
  }
}
