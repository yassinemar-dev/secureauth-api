import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { Prisma, Role } from '../generated/prisma/client.js';
import { PasswordService } from '../password/password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createInMemoryPrisma } from '../../test/in-memory-prisma.js';
import {
  normalizeEmail,
  UsersService,
  type SafeUser,
} from './users.service.js';

describe('UsersService', () => {
  const userCreate = vi.fn();
  const userFindUnique = vi.fn();
  const userFindMany = vi.fn();
  const userCount = vi.fn();
  const userUpdate = vi.fn();
  const transaction = vi.fn();
  const hash = vi.fn();
  let service: UsersService;

  const serializationFailure = () =>
    new Prisma.PrismaClientKnownRequestError('Write conflict', {
      code: 'P2034',
      clientVersion: '7.10.1',
    });

  const safeUser: SafeUser = {
    id: 'user-1',
    email: 'user@example.com',
    role: 'USER',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    transaction.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              create: userCreate,
              findUnique: userFindUnique,
              findMany: userFindMany,
              count: userCount,
              update: userUpdate,
            },
            $transaction: transaction,
          },
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

  it('updates a password hash without returning it', async () => {
    userUpdate.mockResolvedValue(safeUser);

    const result = await service.updatePasswordHash('user-1', 'new-hash');

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-hash' },
      omit: { passwordHash: true },
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('lists users with keyset pagination and never returns passwordHash', async () => {
    const rows = [
      safeUser,
      { ...safeUser, id: 'user-2' },
      { ...safeUser, id: 'user-3' },
    ];
    userFindMany.mockResolvedValue(rows);

    const page = await service.list({ limit: 2 });

    expect(userFindMany).toHaveBeenCalledWith({
      take: 3,
      orderBy: { id: 'asc' },
      omit: { passwordHash: true },
    });
    expect(page.items.map((item) => item.id)).toEqual(['user-1', 'user-2']);
    expect(page.nextCursor).toBe('user-2');
    expect(page.items.every((item) => !('passwordHash' in item))).toBe(true);

    await service.list({ limit: 2, cursor: 'user-1' });
    expect(userFindMany).toHaveBeenLastCalledWith({
      take: 3,
      where: { id: { gt: 'user-1' } },
      orderBy: { id: 'asc' },
      omit: { passwordHash: true },
    });
  });

  it('returns a normal page for a syntactically valid but absent cursor', async () => {
    userFindMany.mockResolvedValue([safeUser]);

    await expect(
      service.list({ limit: 2, cursor: '00000000-0000-4000-8000-000000000000' }),
    ).resolves.toEqual({ items: [safeUser], nextCursor: null });
    expect(userFindMany).toHaveBeenCalledWith({
      take: 3,
      where: { id: { gt: '00000000-0000-4000-8000-000000000000' } },
      orderBy: { id: 'asc' },
      omit: { passwordHash: true },
    });
  });

  it('does not repeat or skip rows across pages', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    userFindMany.mockImplementation(
      async ({ where }: { where?: { id?: { gt?: string } } }) =>
        ids
          .filter((id) => !where?.id?.gt || id > where.id.gt)
          .slice(0, 3)
          .map((id) => ({ ...safeUser, id })),
    );

    const first = await service.list({ limit: 2 });
    const second = await service.list({ limit: 2, cursor: first.nextCursor ?? '' });

    expect(first.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(second.items.map((item) => item.id)).toEqual(['c', 'd']);
    expect(second.nextCursor).toBe('d');
  });

  it('updates a role without returning passwordHash', async () => {
    const admin = { ...safeUser, role: Role.ADMIN };
    userUpdate.mockResolvedValue(admin);

    const result = await service.updateRole('user-1', Role.ADMIN);

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: Role.ADMIN },
      omit: { passwordHash: true },
    });
    expect(result.role).toBe(Role.ADMIN);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('counts users by role', async () => {
    userCount.mockResolvedValue(2);

    await expect(service.countByRole(Role.ADMIN)).resolves.toBe(2);
    expect(userCount).toHaveBeenCalledWith({ where: { role: Role.ADMIN } });
  });

  it('allows only one of two concurrent last-admin demotions', async () => {
    const fake = createInMemoryPrisma();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const first = fake.seedUser({
      id: 'admin-1',
      email: 'first@example.com',
      passwordHash: 'hash',
      role: Role.ADMIN,
      createdAt: now,
      updatedAt: now,
    });
    const second = fake.seedUser({
      id: 'admin-2',
      email: 'second@example.com',
      passwordHash: 'hash',
      role: Role.ADMIN,
      createdAt: now,
      updatedAt: now,
    });
    const atomicService = new UsersService(fake.prisma, {} as PasswordService);

    // The fake serializes transactions, so each check sees the previous commit.
    // A real Serializable DB also detects conflicting reads/writes (P2034),
    // which this implementation retries. This test does not prove that conflict
    // behaviour; it proves the count and update share one serialized transaction.
    const results = await Promise.all([
      atomicService.updateRoleWithLastAdminGuard(first.id, Role.USER),
      atomicService.updateRoleWithLastAdminGuard(second.id, Role.USER),
    ]);

    expect(results.filter((result) => result.status === 'updated')).toHaveLength(
      1,
    );
    expect(
      results.filter((result) => result.status === 'last-admin'),
    ).toHaveLength(1);
    expect(
      [first, second].filter((admin) => admin.role === Role.USER),
    ).toHaveLength(1);
    expect(fake.transactionOptions).toContainEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('reports a missing target without touching the admin count', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const count = vi.fn();
    transaction.mockImplementation(async (fn) =>
      fn({ user: { findUnique, count } }),
    );

    await expect(
      service.updateRoleWithLastAdminGuard('missing', Role.USER),
    ).resolves.toEqual({ status: 'not-found' });
    expect(count).not.toHaveBeenCalled();
  });

  it('keeps the last admin and reports the genuine conflict', async () => {
    const findUnique = vi.fn().mockResolvedValue({ role: Role.ADMIN });
    const count = vi.fn().mockResolvedValue(1);
    transaction.mockImplementation(async (fn) =>
      fn({ user: { findUnique, count } }),
    );

    await expect(
      service.updateRoleWithLastAdminGuard('admin-1', Role.USER),
    ).resolves.toEqual({ status: 'last-admin' });
    expect(count).toHaveBeenCalledWith({ where: { role: Role.ADMIN } });
  });

  it('retries a serialization failure and succeeds on the next attempt', async () => {
    const update = vi.fn().mockResolvedValue({ ...safeUser, role: Role.ADMIN });
    transaction
      .mockRejectedValueOnce(serializationFailure())
      .mockImplementationOnce(async (fn) =>
        fn({
          user: {
            findUnique: vi.fn().mockResolvedValue({ role: Role.USER }),
            count: vi.fn().mockResolvedValue(2),
            update,
          },
        }),
      );

    await expect(
      service.updateRoleWithLastAdminGuard('user-1', Role.ADMIN),
    ).resolves.toEqual({
      status: 'updated',
      user: { ...safeUser, role: Role.ADMIN },
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce();
  });

  it('retries a driver-adapter serialization conflict too', async () => {
    const adapterError = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionWriteConflict' },
    });
    const update = vi.fn().mockResolvedValue(safeUser);
    transaction
      .mockRejectedValueOnce(adapterError)
      .mockImplementationOnce(async (fn) =>
        fn({
          user: {
            findUnique: vi.fn().mockResolvedValue({ role: Role.USER }),
            count: vi.fn().mockResolvedValue(2),
            update,
          },
        }),
      );

    await expect(
      service.updateRoleWithLastAdminGuard('user-1', Role.ADMIN),
    ).resolves.toEqual({ status: 'updated', user: safeUser });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('returns a distinct 409 when serialization retries are exhausted', async () => {
    transaction.mockRejectedValue(serializationFailure());

    const error = await service
      .updateRoleWithLastAdminGuard('admin-1', Role.USER)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toBe('Concurrent update, please retry');
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
