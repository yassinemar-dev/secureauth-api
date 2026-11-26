import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { RefreshTokenService } from '../auth/refresh-token.service.js';
import { Role } from '../generated/prisma/client.js';
import type { SafeUser, UsersService } from '../users/users.service.js';
import { AdminController } from './admin.controller.js';

describe('AdminController', () => {
  const admin: AuthenticatedUser = { id: 'admin-1', role: Role.ADMIN };
  const target: SafeUser = {
    id: 'admin-2',
    email: 'second@example.com',
    role: Role.USER,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const users = {
    list: vi.fn(),
    updateRoleWithLastAdminGuard: vi.fn(),
  };
  const refreshTokens = { revokeAllForUser: vi.fn() };
  const controller = new AdminController(
    users as unknown as UsersService,
    refreshTokens as unknown as RefreshTokenService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists users with the DTO defaults', async () => {
    users.list.mockResolvedValue({ items: [target], nextCursor: null });

    await expect(controller.list({})).resolves.toEqual({
      items: [target],
      nextCursor: null,
    });
    expect(users.list).toHaveBeenCalledWith({ limit: 20, cursor: undefined });
  });

  it('refuses a self-demotion before touching the database', async () => {
    const error = await controller
      .updateRole('admin-1', { role: Role.USER }, admin)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(users.updateRoleWithLastAdminGuard).not.toHaveBeenCalled();
  });

  it('maps a missing target to 404', async () => {
    users.updateRoleWithLastAdminGuard.mockResolvedValue({ status: 'not-found' });

    const error = await controller
      .updateRole(target.id, { role: Role.ADMIN }, admin)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('keeps the genuine last-admin message distinct from contention', async () => {
    users.updateRoleWithLastAdminGuard.mockResolvedValue({ status: 'last-admin' });

    const error = await controller
      .updateRole(target.id, { role: Role.USER }, admin)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe('Unable to demote the last admin');
  });

  it('revokes target sessions after a successful role change', async () => {
    users.updateRoleWithLastAdminGuard.mockResolvedValue({
      status: 'updated',
      user: { ...target, role: Role.ADMIN },
    });

    await expect(
      controller.updateRole(target.id, { role: Role.ADMIN }, admin),
    ).resolves.toEqual({ ...target, role: Role.ADMIN });
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(target.id);
  });
});
