import { vi } from 'vitest';
import { Role } from '../generated/prisma/client.js';
import type { SafeUser } from '../users/users.service.js';
import { AuthController } from './auth.controller.js';
import type { AuthenticatedUser, LoginResponse } from './auth.types.js';
import type { AuthService } from './auth.service.js';

describe('AuthController', () => {
  const loginResponse: LoginResponse = {
    accessToken: 'access',
    refreshToken: 'refresh',
    tokenType: 'Bearer',
    expiresIn: 900,
  };
  const safeUser: SafeUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: Role.USER,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const auth = {
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
    me: vi.fn(),
  };
  const controller = new AuthController(auth as unknown as AuthService);
  const current: AuthenticatedUser = { id: 'user-1', role: Role.USER };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates registration and returns the safe user', async () => {
    auth.register.mockResolvedValue(safeUser);
    const dto = { email: 'user@example.com', password: 'password12345' };

    await expect(controller.register(dto)).resolves.toBe(safeUser);
    expect(auth.register).toHaveBeenCalledWith(dto);
  });

  it('delegates login, refresh and logout to the auth service', async () => {
    auth.login.mockResolvedValue(loginResponse);
    auth.refresh.mockResolvedValue(loginResponse);
    auth.logout.mockResolvedValue(undefined);

    await expect(
      controller.login({ email: 'user@example.com', password: 'password12345' }),
    ).resolves.toBe(loginResponse);
    await expect(
      controller.refresh({ refreshToken: 'old-token' }),
    ).resolves.toBe(loginResponse);
    await expect(
      controller.logout({ refreshToken: 'old-token' }),
    ).resolves.toBeUndefined();
    expect(auth.login).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'password12345',
    });
    expect(auth.refresh).toHaveBeenCalledWith('old-token');
    expect(auth.logout).toHaveBeenCalledWith('old-token');
  });

  it('uses the authenticated user id for logout-all and me', async () => {
    auth.logoutAll.mockResolvedValue(undefined);
    auth.me.mockResolvedValue(safeUser);

    await controller.logoutAll(current);
    await expect(controller.me(current)).resolves.toBe(safeUser);

    expect(auth.logoutAll).toHaveBeenCalledWith(current.id);
    expect(auth.me).toHaveBeenCalledWith(current.id);
  });
});
