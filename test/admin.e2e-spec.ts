import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { configureApp } from '../src/app.setup.js';
import { AppModule } from '../src/app.module.js';
import { Role, type User } from '../src/generated/prisma/client.js';
import { PasswordService } from '../src/password/password.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  UsersService,
  type ListUsersInput,
  type RoleUpdateResult,
  type SafeUser,
  type UserPage,
} from '../src/users/users.service.js';
import { createInMemoryPrisma } from './in-memory-prisma.js';
import { createThrottlerResetter } from './throttler-storage.js';

function toSafeUser(user: User): SafeUser {
  const { id, email, role, createdAt, updatedAt } = user;
  return { id, email, role, createdAt, updatedAt };
}

describe('Admin (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let users: Map<string, User>;
  let password: PasswordService;
  let fakePrisma: ReturnType<typeof createInMemoryPrisma>;
  let adminCountOverride: number | null;
  let resetThrottler: () => void;

  const validPassword = 'correct horse battery staple';

  const addUser = async (email: string, role: Role): Promise<User> => {
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email,
      passwordHash: await password.hash(validPassword),
      role,
      createdAt: now,
      updatedAt: now,
    };
    users.set(user.id, user);
    return user;
  };

  const login = async (email: string) => {
    return request(app!.getHttpServer())
      .post('/auth/login')
      .send({ email, password: validPassword })
      .expect(200);
  };

  beforeAll(async () => {
    users = new Map<string, User>();
    password = new PasswordService();
    fakePrisma = createInMemoryPrisma();

    const fakeUsersService = {
      findById: async (id: string): Promise<SafeUser | null> => {
        const user = users.get(id);
        return user ? toSafeUser(user) : null;
      },
      findByEmail: async (email: string): Promise<SafeUser | null> => {
        const user = [...users.values()].find((item) => item.email === email);
        return user ? toSafeUser(user) : null;
      },
      findByEmailWithHash: async (email: string): Promise<User | null> => {
        return [...users.values()].find((item) => item.email === email) ?? null;
      },
      updatePasswordHash: async (
        id: string,
        passwordHash: string,
      ): Promise<SafeUser> => {
        const user = users.get(id)!;
        user.passwordHash = passwordHash;
        return toSafeUser(user);
      },
      updateRole: async (id: string, role: Role): Promise<SafeUser> => {
        const user = users.get(id)!;
        user.role = role;
        user.updatedAt = new Date();
        return toSafeUser(user);
      },
      countByRole: async (role: Role): Promise<number> => {
        if (adminCountOverride !== null && role === Role.ADMIN) {
          return adminCountOverride;
        }
        return [...users.values()].filter((user) => user.role === role).length;
      },
      updateRoleWithLastAdminGuard: async (
        id: string,
        role: Role,
      ): Promise<RoleUpdateResult> => {
        const user = users.get(id);
        if (!user) return { status: 'not-found' };
        const isDemotion = user.role === Role.ADMIN && role !== Role.ADMIN;
        if (isDemotion) {
          const admins =
            adminCountOverride ??
            [...users.values()].filter((item) => item.role === Role.ADMIN)
              .length;
          if (admins <= 1) return { status: 'last-admin' };
        }
        user.role = role;
        user.updatedAt = new Date();
        return { status: 'updated', user: toSafeUser(user) };
      },
      list: async ({ limit = 20, cursor }: ListUsersInput): Promise<UserPage> => {
        const sorted = [...users.values()].sort((a, b) =>
          a.id.localeCompare(b.id),
        );
        const start = cursor
          ? sorted.findIndex((user) => user.id === cursor) + 1
          : 0;
        const slice = sorted.slice(start, start + limit + 1);
        const hasMore = slice.length > limit;
        const items = (hasMore ? slice.slice(0, limit) : slice).map(toSafeUser);
        return {
          items,
          nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
        };
      },
    };

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma.prisma)
      .overrideProvider(UsersService)
      .useValue(fakeUsersService)
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    resetThrottler = createThrottlerResetter(app);
    await app.init();
  });

  beforeEach(() => {
    users.clear();
    fakePrisma.clear();
    adminCountOverride = null;
    resetThrottler();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires an ADMIN token and supports paginated user listing', async () => {
    const server = app!.getHttpServer();
    const admin = await addUser('admin@example.com', Role.ADMIN);
    const regular = await addUser('user@example.com', Role.USER);
    await addUser('second@example.com', Role.USER);
    await addUser('third@example.com', Role.USER);
    const adminLogin = await login(admin.email);
    const userLogin = await login(regular.email);

    await request(server).get('/admin/users').expect(401);
    await request(server)
      .get('/admin/users')
      .set('Authorization', `Bearer ${userLogin.body.accessToken}`)
      .expect(403);

    const firstPage = await request(server)
      .get('/admin/users?limit=2')
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .expect(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));
    expect(firstPage.body.items.every((item: SafeUser) => !('passwordHash' in item))).toBe(true);

    const secondPage = await request(server)
      .get(`/admin/users?limit=2&cursor=${firstPage.body.nextCursor}`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .expect(200);
    expect(secondPage.body.items).toHaveLength(2);
    const firstIds = firstPage.body.items.map((item: SafeUser) => item.id);
    const secondIds = secondPage.body.items.map((item: SafeUser) => item.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);

    await request(server)
      .get('/admin/users?limit=101')
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .expect(400);
  });

  it('changes another user role and revokes that user refresh tokens', async () => {
    const server = app!.getHttpServer();
    const admin = await addUser('admin@example.com', Role.ADMIN);
    const target = await addUser('target@example.com', Role.USER);
    const adminLogin = await login(admin.email);
    const targetLogin = await login(target.email);

    const response = await request(server)
      .patch(`/admin/users/${target.id}/role`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .send({ role: Role.ADMIN })
      .expect(200);
    expect(response.body.role).toBe(Role.ADMIN);
    expect(response.body).not.toHaveProperty('passwordHash');

    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: targetLogin.body.refreshToken })
      .expect(401);
  });

  it('forbids an admin from changing their own role', async () => {
    const server = app!.getHttpServer();
    const admin = await addUser('admin@example.com', Role.ADMIN);
    const adminLogin = await login(admin.email);

    await request(server)
      .patch(`/admin/users/${admin.id}/role`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .send({ role: Role.USER })
      .expect(403);
  });

  it('refuses to demote the last remaining admin', async () => {
    const server = app!.getHttpServer();
    const admin = await addUser('admin@example.com', Role.ADMIN);
    const target = await addUser('target@example.com', Role.ADMIN);
    const adminLogin = await login(admin.email);
    adminCountOverride = 1;

    await request(server)
      .patch(`/admin/users/${target.id}/role`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .send({ role: Role.USER })
      .expect(409);
  });

  it('denies a demoted admin immediately with their old access token', async () => {
    const server = app!.getHttpServer();
    const admin = await addUser('admin@example.com', Role.ADMIN);
    const other = await addUser('other@example.com', Role.ADMIN);
    const adminLogin = await login(admin.email);
    const otherLogin = await login(other.email);

    await request(server)
      .patch(`/admin/users/${admin.id}/role`)
      .set('Authorization', `Bearer ${otherLogin.body.accessToken}`)
      .send({ role: Role.USER })
      .expect(200);

    await request(server)
      .get('/admin/users')
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .expect(403);
  });

  it('rejects invalid role, invalid uuid and unknown user', async () => {
    const server = app!.getHttpServer();
    const admin = await addUser('admin@example.com', Role.ADMIN);
    const target = await addUser('target@example.com', Role.USER);
    const adminLogin = await login(admin.email);
    const token = adminLogin.body.accessToken;

    await request(server)
      .patch(`/admin/users/${target.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'SUPER_ADMIN' })
      .expect(400);

    await request(server)
      .patch('/admin/users/not-a-uuid/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: Role.USER })
      .expect(400);

    await request(server)
      .patch(`/admin/users/${randomUUID()}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: Role.USER })
      .expect(404);
  });
});
