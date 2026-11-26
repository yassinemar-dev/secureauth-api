import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { vi } from 'vitest';
import { Role, type User } from '../generated/prisma/client.js';
import { PasswordService } from '../password/password.service.js';
import { UsersService, type SafeUser } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { JwtPayload } from './auth.types.js';

describe('AuthService', () => {
  const usersCreate = vi.fn();
  const usersFindByEmailWithHash = vi.fn();
  const usersFindById = vi.fn();
  const usersUpdatePasswordHash = vi.fn();
  const passwordHash = vi.fn();
  const passwordVerify = vi.fn();
  const passwordNeedsRehash = vi.fn();
  const configGetOrThrow = vi.fn();

  const user: User = {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'stored-hash',
    role: Role.USER,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const safeUser: SafeUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };

  const jwt = new JwtService({
    secret: 'test_only_access_secret_do_not_use_1234567890',
    signOptions: { algorithm: 'HS256', expiresIn: 900 },
  });
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    passwordHash.mockResolvedValue('dummy-hash');
    passwordVerify.mockResolvedValue(true);
    passwordNeedsRehash.mockReturnValue(false);
    configGetOrThrow.mockImplementation((key: string) =>
      key === 'JWT_ACCESS_TTL' ? '15m' : undefined,
    );

    service = new AuthService(
      {
        create: usersCreate,
        findByEmailWithHash: usersFindByEmailWithHash,
        findById: usersFindById,
        updatePasswordHash: usersUpdatePasswordHash,
      } as unknown as UsersService,
      {
        hash: passwordHash,
        verify: passwordVerify,
        needsRehash: passwordNeedsRehash,
      } as unknown as PasswordService,
      jwt,
      { getOrThrow: configGetOrThrow } as unknown as ConfigService,
    );
  });

  it('register delegates to UsersService with only email and password', async () => {
    usersCreate.mockResolvedValue(safeUser);

    const result = await service.register({
      email: '  User@Example.COM  ',
      password: 'password12345',
    });

    expect(usersCreate).toHaveBeenCalledWith({
      email: '  User@Example.COM  ',
      password: 'password12345',
    });
    expect(result).toEqual(safeUser);
  });

  it('login returns a token whose payload has sub and role', async () => {
    usersFindByEmailWithHash.mockResolvedValue(user);

    const result = await service.login({
      email: 'user@example.com',
      password: 'password12345',
    });
    const payload = await jwt.verifyAsync<JwtPayload>(result.accessToken, {
      algorithms: ['HS256'],
    });

    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe(Role.USER);
    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(900);
  });

  it('unknown email and wrong password produce the same error message', async () => {
    passwordVerify.mockResolvedValue(false);
    usersFindByEmailWithHash.mockResolvedValueOnce(null).mockResolvedValueOnce(user);

    const login = () =>
      service
        .login({ email: 'user@example.com', password: 'password12345' })
        .catch((error: unknown) => error);

    const [unknownEmailError, wrongPasswordError] = await Promise.all([
      login(),
      login(),
    ]);

    expect(unknownEmailError).toBeInstanceOf(UnauthorizedException);
    expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
    expect((unknownEmailError as Error).message).toBe('Invalid credentials');
    expect((wrongPasswordError as Error).message).toBe(
      (unknownEmailError as Error).message,
    );
  });

  it('still verifies against the dummy hash when the user does not exist', async () => {
    usersFindByEmailWithHash.mockResolvedValue(null);
    passwordVerify.mockResolvedValue(false);

    await expect(
      service.login({ email: 'nobody@example.com', password: 'password12345' }),
    ).rejects.toThrow('Invalid credentials');

    expect(passwordVerify).toHaveBeenCalledWith('dummy-hash', 'password12345');
  });

  it('rehashes and updates the stored hash when parameters are stale', async () => {
    usersFindByEmailWithHash.mockResolvedValue(user);
    passwordNeedsRehash.mockReturnValue(true);
    passwordHash.mockResolvedValueOnce('rehashed-hash');

    await service.login({
      email: 'user@example.com',
      password: 'password12345',
    });

    expect(passwordNeedsRehash).toHaveBeenCalledWith('stored-hash');
    expect(usersUpdatePasswordHash).toHaveBeenCalledWith(
      user.id,
      'rehashed-hash',
    );
  });
});
