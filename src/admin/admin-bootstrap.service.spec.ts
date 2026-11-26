import { vi } from 'vitest';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { Role } from '../generated/prisma/client.js';
import { UsersService, type SafeUser } from '../users/users.service.js';
import {
  AdminBootstrapService,
  AdminPromoteError,
} from './admin-bootstrap.service.js';

describe('AdminBootstrapService', () => {
  const usersFindByEmail = vi.fn();
  const usersUpdateRole = vi.fn();
  const refreshRevokeAllForUser = vi.fn();
  const service = new AdminBootstrapService(
    {
      findByEmail: usersFindByEmail,
      updateRole: usersUpdateRole,
    } as unknown as UsersService,
    {
      revokeAllForUser: refreshRevokeAllForUser,
    } as unknown as RefreshTokenService,
  );

  const safeUser: SafeUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: Role.USER,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes the email, promotes the user and revokes their tokens', async () => {
    usersFindByEmail.mockResolvedValue(safeUser);
    usersUpdateRole.mockResolvedValue({ ...safeUser, role: Role.ADMIN });

    const result = await service.promote('  USER@Example.COM  ');

    expect(usersFindByEmail).toHaveBeenCalledWith('user@example.com');
    expect(usersUpdateRole).toHaveBeenCalledWith('user-1', Role.ADMIN);
    expect(refreshRevokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(result.role).toBe(Role.ADMIN);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('fails clearly when the user does not exist', async () => {
    usersFindByEmail.mockResolvedValue(null);

    const error = await service.promote('nobody@example.com').catch((caught) => caught);
    expect(error).toBeInstanceOf(AdminPromoteError);
    expect((error as Error).message).toBe(
      'No user found for nobody@example.com',
    );
    expect(usersUpdateRole).not.toHaveBeenCalled();
    expect(refreshRevokeAllForUser).not.toHaveBeenCalled();
  });
});
