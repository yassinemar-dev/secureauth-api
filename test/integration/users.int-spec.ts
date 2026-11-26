import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PasswordService } from '../../src/password/password.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { UsersService } from '../../src/users/users.service.js';
import { createPrisma, resetDb } from './fixtures.js';

describe('UsersService against Postgres', () => {
  let prisma: PrismaService;
  let users: UsersService;
  const password = 'correct horse battery staple';

  beforeAll(async () => {
    prisma = await createPrisma();
    users = new UsersService(prisma, new PasswordService());
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('stores a lowercase email and never returns the password hash', async () => {
    const created = await users.create({
      email: '  MiXeD@Example.COM  ',
      password,
    });

    expect(created.email).toBe('mixed@example.com');
    expect(created).not.toHaveProperty('passwordHash');

    const row = await prisma.user.findUnique({
      where: { email: 'mixed@example.com' },
    });
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);

    const byId = await users.findById(created.id);
    const page = await users.list({ limit: 10 });
    expect(byId).not.toHaveProperty('passwordHash');
    expect(page.items[0]).not.toHaveProperty('passwordHash');
  });

  it('maps a real P2002 for a case-only duplicate to a generic 409', async () => {
    await users.create({ email: 'Dup@Example.com', password });

    const error = await users
      .create({ email: 'dup@example.com', password })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as Error).message).toBe('Unable to create user');
    expect(await prisma.user.count()).toBe(1);
  });
});
