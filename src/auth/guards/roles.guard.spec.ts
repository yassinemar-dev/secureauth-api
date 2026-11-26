import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { vi } from 'vitest';
import { Role } from '../../generated/prisma/client.js';
import { UsersService, type SafeUser } from '../../users/users.service.js';
import type { AuthenticatedUser } from '../auth.types.js';
import { RolesGuard } from './roles.guard.js';

function makeContext(user?: AuthenticatedUser): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflectorGet = vi.fn();
  const usersFindById = vi.fn();
  const guard = new RolesGuard(
    { getAllAndOverride: reflectorGet } as unknown as Reflector,
    { findById: usersFindById } as unknown as UsersService,
  );

  const dbUser: SafeUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: Role.USER,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a user whose current DB role is permitted', async () => {
    reflectorGet.mockReturnValue([Role.ADMIN]);
    usersFindById.mockResolvedValue({ ...dbUser, role: Role.ADMIN });

    await expect(
      guard.canActivate(
        makeContext({ id: dbUser.id, role: Role.ADMIN }),
      ),
    ).resolves.toBe(true);
  });

  it('rejects a USER on an admin route with 403', async () => {
    reflectorGet.mockReturnValue([Role.ADMIN]);
    usersFindById.mockResolvedValue(dbUser);

    const error = await guard
      .canActivate(makeContext({ id: dbUser.id, role: Role.USER }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as Error).message).toBe('Forbidden');
  });

  it('reads the role from the DB, not from the token', async () => {
    reflectorGet.mockReturnValue([Role.ADMIN]);
    usersFindById.mockResolvedValue(dbUser);

    const error = await guard
      .canActivate(makeContext({ id: dbUser.id, role: Role.ADMIN }))
      .catch((caught: unknown) => caught);

    expect(usersFindById).toHaveBeenCalledWith(dbUser.id);
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it('returns 401 when the user no longer exists', async () => {
    reflectorGet.mockReturnValue([Role.ADMIN]);
    usersFindById.mockResolvedValue(null);

    const error = await guard
      .canActivate(makeContext({ id: 'deleted-user', role: Role.ADMIN }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as Error).message).toBe('Unauthorized');
  });

  it('fails closed when @Roles metadata is missing', async () => {
    reflectorGet.mockReturnValue(undefined);

    const error = await guard
      .canActivate(makeContext({ id: dbUser.id, role: Role.ADMIN }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as Error).message).toBe('Forbidden');
    expect(usersFindById).not.toHaveBeenCalled();
  });
});
