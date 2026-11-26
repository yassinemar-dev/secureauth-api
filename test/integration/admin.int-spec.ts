import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Role } from '../../src/generated/prisma/client.js';
import { PasswordService } from '../../src/password/password.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { UsersService } from '../../src/users/users.service.js';
import { createPrisma, resetDb } from './fixtures.js';

describe('Last-admin demotion against Postgres', () => {
  let prisma: PrismaService;
  let users: UsersService;

  const addAdmin = async (email: string): Promise<string> => {
    const row = await prisma.user.create({
      data: {
        email,
        passwordHash: 'not-used-by-these-tests',
        role: Role.ADMIN,
      },
    });
    return row.id;
  };

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

  it('allows at most one of two concurrent demotions and keeps an admin', async () => {
    // Repeat to expose a race that one lucky scheduling order could hide.
    for (let iteration = 0; iteration < 10; iteration += 1) {
      await resetDb(prisma);
      const first = await addAdmin(`first-${iteration}@example.com`);
      const second = await addAdmin(`second-${iteration}@example.com`);

      const results = await Promise.all([
        users.updateRoleWithLastAdminGuard(first, Role.USER),
        users.updateRoleWithLastAdminGuard(second, Role.USER),
      ]);
      const demoted = results.filter((result) => result.status === 'updated');
      const refused = results.filter((result) => result.status === 'last-admin');

      expect(demoted, `iteration ${iteration}`).toHaveLength(1);
      expect(refused, `iteration ${iteration}`).toHaveLength(1);
      expect(
        await prisma.user.count({ where: { role: Role.ADMIN } }),
        `iteration ${iteration}`,
      ).toBe(1);
    }
  });

  it('refuses to demote the only admin', async () => {
    const only = await addAdmin('only@example.com');

    await expect(
      users.updateRoleWithLastAdminGuard(only, Role.USER),
    ).resolves.toEqual({ status: 'last-admin' });
    expect(await prisma.user.count({ where: { role: Role.ADMIN } })).toBe(1);
  });
});
