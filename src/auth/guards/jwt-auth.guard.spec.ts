import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { testEnv } from '../../../test/env.js';
import { Role } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, JwtPayload } from '../auth.types.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../jwt-claims.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

function makeContext(header?: string): {
  context: ExecutionContext;
  request: {
    headers: { authorization?: string };
    user?: AuthenticatedUser;
  };
} {
  const request: {
    headers: { authorization?: string };
    user?: AuthenticatedUser;
  } = { headers: header ? { authorization: header } : {} };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

function noneToken(payload: JwtPayload): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

describe('JwtAuthGuard', () => {
  const secret = testEnv.JWT_ACCESS_SECRET!;
  const jwt = new JwtService({
    secret,
    signOptions: { algorithm: 'HS256' },
  });
  const guard = new JwtAuthGuard(jwt);
  const payload: JwtPayload = { sub: 'user-1', role: Role.USER };

  const expectUnauthorized = async (header?: string) => {
    const { context } = makeContext(header);
    const error = await guard.canActivate(context).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as Error).message).toBe('Unauthorized');
  };

  it('rejects a missing Authorization header', async () => {
    await expectUnauthorized();
  });

  it('rejects a wrong scheme', async () => {
    await expectUnauthorized('Basic not-a-token');
  });

  it('rejects a garbage token', async () => {
    await expectUnauthorized('Bearer garbage');
  });

  it('rejects a token signed with another secret', async () => {
    const otherJwt = new JwtService({
      secret: 'another_test_secret_do_not_use_abcdefghijklmnop',
      signOptions: { algorithm: 'HS256' },
    });
    const token = await otherJwt.signAsync(payload);
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('rejects an expired token', async () => {
    const expiredJwt = new JwtService({
      secret,
      signOptions: { algorithm: 'HS256', expiresIn: -1 },
    });
    const token = await expiredJwt.signAsync(payload);
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('rejects a token forged with alg none', async () => {
    await expectUnauthorized(`Bearer ${noneToken(payload)}`);
  });

  it('rejects a token with a wrong issuer', async () => {
    const token = await jwt.signAsync(payload, {
      issuer: 'another-api',
      audience: JWT_AUDIENCE,
    });
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('rejects a token with a wrong audience', async () => {
    const token = await jwt.signAsync(payload, {
      issuer: JWT_ISSUER,
      audience: 'another-client',
    });
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('rejects a token with no issuer or audience', async () => {
    const token = await jwt.signAsync(payload);
    await expectUnauthorized(`Bearer ${token}`);
  });

  it('accepts a valid HS256 token with the expected issuer and audience', async () => {
    const token = await jwt.signAsync(payload, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const { context, request } = makeContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: payload.sub, role: payload.role });
  });
});
