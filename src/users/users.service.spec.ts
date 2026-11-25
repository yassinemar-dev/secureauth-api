import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { PasswordService } from '../password/password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  normalizeEmail,
  UsersService,
  type SafeUser,
} from './users.service.js';

describe('UsersService', () => {
  const userCreate = vi.fn();
  const userFindUnique = vi.fn();
  const hash = vi.fn();
  let service: UsersService;

  const safeUser: SafeUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: 'USER',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: { user: { create: userCreate, findUnique: userFindUnique } },
        },
        { provide: PasswordService, useValue: { hash } },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('normalizes email by trimming and lowercasing', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('hashes the password and stores the normalized email', async () => {
    hash.mockResolvedValue('hashed-value');
    userCreate.mockResolvedValue(safeUser);

    await service.create({
      email: '  User@Example.COM  ',
      password: 'plain-password',
    });

    expect(hash).toHaveBeenCalledExactlyOnceWith('plain-password');
    expect(userCreate).toHaveBeenCalledWith({
      data: {
        email: 'user@example.com',
        passwordHash: 'hashed-value',
        role: 'USER',
      },
      omit: { passwordHash: true },
    });
  });

  it('does not return passwordHash from create', async () => {
    hash.mockResolvedValue('hashed-value');
    userCreate.mockResolvedValue(safeUser);

    const result = await service.create({
      email: 'user@example.com',
      password: 'plain-password',
    });

    expect(result).toEqual(safeUser);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('turns a Prisma P2002 violation into a generic ConflictException', async () => {
    hash.mockResolvedValue('hashed-value');
    userCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.10.1',
      }),
    );

    await expect(
      service.create({
        email: 'user@example.com',
        password: 'plain-password',
      }),
    ).rejects.toThrow(new ConflictException('Unable to create user'));
  });

  it('normalizes the email passed to findByEmail', async () => {
    userFindUnique.mockResolvedValue(null);

    await service.findByEmail('  User@Example.COM  ');

    expect(userFindUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      omit: { passwordHash: true },
    });
  });
});
