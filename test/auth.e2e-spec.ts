import { ConflictException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { Role, type User } from '../src/generated/prisma/client.js';
import { PasswordService } from '../src/password/password.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  normalizeEmail,
  UsersService,
  type SafeUser,
} from '../src/users/users.service.js';
import { createInMemoryPrisma } from './in-memory-prisma.js';

function toSafeUser(user: User): SafeUser {
  const { id, email, role, createdAt, updatedAt } = user;
  return { id, email, role, createdAt, updatedAt };
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let users: Map<string, User>;
  let password: PasswordService;
  let fakePrisma: ReturnType<typeof createInMemoryPrisma>;

  const validPassword = 'correct horse battery staple';

  const loginUser = async (email = 'user@example.com') => {
    const server = app!.getHttpServer();
    const registered = await request(server)
      .post('/auth/register')
      .send({ email, password: validPassword })
      .expect(201);
    expect(registered.body).not.toHaveProperty('passwordHash');
    return request(server)
      .post('/auth/login')
      .send({ email: email.toUpperCase(), password: validPassword })
      .expect(200);
  };

  beforeAll(async () => {
    users = new Map<string, User>();
    password = new PasswordService();
    fakePrisma = createInMemoryPrisma();

    const fakeUsersService = {
      create: async ({
        email,
        password: plain,
      }: {
        email: string;
        password: string;
      }): Promise<SafeUser> => {
        const normalized = normalizeEmail(email);
        if ([...users.values()].some((user) => user.email === normalized)) {
          throw new ConflictException('Unable to create user');
        }
        const now = new Date();
        const user: User = {
          id: randomUUID(),
          email: normalized,
          passwordHash: await password.hash(plain),
          role: Role.USER,
          createdAt: now,
          updatedAt: now,
        };
        users.set(user.id, user);
        return toSafeUser(user);
      },
      findById: async (id: string): Promise<SafeUser | null> => {
        const user = users.get(id);
        return user ? toSafeUser(user) : null;
      },
      findByEmailWithHash: async (email: string): Promise<User | null> => {
        const normalized = normalizeEmail(email);
        return [...users.values()].find((user) => user.email === normalized) ?? null;
      },
      updatePasswordHash: async (
        id: string,
        passwordHash: string,
      ): Promise<SafeUser> => {
        const user = users.get(id);
        if (!user) {
          throw new ConflictException('Unable to update user');
        }
        user.passwordHash = passwordHash;
        user.updatedAt = new Date();
        return toSafeUser(user);
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

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    users.clear();
    fakePrisma.clear();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('register, login and /auth/me work without a database', async () => {
    const server = app!.getHttpServer();

    await request(server)
      .post('/auth/register')
      .send({
        email: 'extra@example.com',
        password: validPassword,
        role: 'ADMIN',
      })
      .expect(400);

    await request(server)
      .post('/auth/register')
      .send({ email: 'short@example.com', password: 'short' })
      .expect(400);

    const login = await loginUser();
    expect(login.body.accessToken).toEqual(expect.any(String));
    expect(login.body.refreshToken).toEqual(expect.any(String));
    expect(login.body.tokenType).toBe('Bearer');
    expect(login.body.expiresIn).toBe(900);

    await request(server)
      .post('/auth/register')
      .send({ email: 'user@example.com', password: validPassword })
      .expect(409);

    const wrongPassword = await request(server)
      .post('/auth/login')
      .send({ email: 'user@example.com', password: 'wrong-password-123' })
      .expect(401);
    const unknownEmail = await request(server)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password-123' })
      .expect(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.message).toBe('Invalid credentials');

    await request(server).get('/auth/me').expect(401);

    const me = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('user@example.com');
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('detects refresh reuse and revokes the newest token in the family', async () => {
    const server = app!.getHttpServer();
    const first = await loginUser();
    const rotated = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(first.body.refreshToken);

    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(401);

    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('revokes a family on logout and always returns 204', async () => {
    const server = app!.getHttpServer();
    const pair = await loginUser();

    await request(server)
      .post('/auth/logout')
      .send({ refreshToken: 'unknown-token-long-enough' })
      .expect(204);
    await request(server)
      .post('/auth/logout')
      .send({ refreshToken: pair.body.refreshToken })
      .expect(204);
    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: pair.body.refreshToken })
      .expect(401);
  });

  it('logout-all revokes every refresh token of the current user', async () => {
    const server = app!.getHttpServer();
    const pair = await loginUser();

    await request(server).post('/auth/logout-all').expect(401);
    await request(server)
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${pair.body.accessToken}`)
      .expect(204);
    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: pair.body.refreshToken })
      .expect(401);
  });

  it('refresh returns 401 when the user no longer exists', async () => {
    const server = app!.getHttpServer();
    const pair = await loginUser();
    users.clear();

    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: pair.body.refreshToken })
      .expect(401);
  });

  it('rejects invalid refresh DTOs with 400', async () => {
    const server = app!.getHttpServer();

    await request(server).post('/auth/refresh').send({ refreshToken: 'short' }).expect(400);
    await request(server).post('/auth/refresh').send({}).expect(400);
    await request(server)
      .post('/auth/logout')
      .send({ refreshToken: 'x'.repeat(40), extra: true })
      .expect(400);
  });
});
