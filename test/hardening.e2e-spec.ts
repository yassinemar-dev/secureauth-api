import { ConflictException, INestApplication } from '@nestjs/common';
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
  normalizeEmail,
  UsersService,
  type SafeUser,
} from '../src/users/users.service.js';
import { createInMemoryPrisma } from './in-memory-prisma.js';
import { createThrottlerResetter } from './throttler-storage.js';

function toSafeUser(user: User): SafeUser {
  const { id, email, role, createdAt, updatedAt } = user;
  return { id, email, role, createdAt, updatedAt };
}

describe('Hardening (e2e)', () => {
  let app: INestApplication<App> | undefined;
  let users: Map<string, User>;
  let password: PasswordService;
  let fakePrisma: ReturnType<typeof createInMemoryPrisma>;
  let resetThrottler: () => void;

  const validPassword = 'correct horse battery staple';

  const addUser = async (email: string): Promise<User> => {
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      email: normalizeEmail(email),
      passwordHash: await password.hash(validPassword),
      role: Role.USER,
      createdAt: now,
      updatedAt: now,
    };
    users.set(user.id, user);
    return user;
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
      findByEmailWithHash: async (email: string): Promise<User | null> => {
        return (
          [...users.values()].find(
            (user) => user.email === normalizeEmail(email),
          ) ?? null
        );
      },
      updatePasswordHash: async (
        id: string,
        passwordHash: string,
      ): Promise<SafeUser> => {
        const user = users.get(id)!;
        user.passwordHash = passwordHash;
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

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    resetThrottler = createThrottlerResetter(app);
    await app.init();
  });

  beforeEach(() => {
    users.clear();
    fakePrisma.clear();
    resetThrottler();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('blocks the sixth login from the same IP with Retry-After', async () => {
    const server = app!.getHttpServer();
    const user = await addUser('login@example.com');

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await request(server)
        .post('/auth/login')
        .send({ email: user.email, password: validPassword })
        .expect(200);
    }

    const blocked = await request(server)
      .post('/auth/login')
      .send({ email: user.email, password: validPassword })
      .expect(429);

    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.body.statusCode).toBe(429);
    expect(blocked.body.message).toBe('Too Many Requests');
    expect(JSON.stringify(blocked.body)).not.toContain(user.email);
    expect(JSON.stringify(blocked.body)).not.toContain(validPassword);
  });

  it('counts failed logins as well as successful ones', async () => {
    const server = app!.getHttpServer();
    const user = await addUser('mixed@example.com');

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await request(server)
        .post('/auth/login')
        .send({ email: user.email, password: validPassword })
        .expect(200);
    }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await request(server)
        .post('/auth/login')
        .send({ email: user.email, password: 'wrong-password-123' })
        .expect(401);
    }

    await request(server)
      .post('/auth/login')
      .send({ email: user.email, password: validPassword })
      .expect(429);
  });

  it('limits by normalized email even across distinct forwarded IPs', async () => {
    const server = app!.getHttpServer();
    const email = 'shared@example.com';

    // TRUST_PROXY=1 in test/env.ts makes these different req.ip values.
    // The email tracker ignores IP, so all attempts share one email bucket.
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', `203.0.113.${attempt}`)
        .send({
          email: attempt % 2 === 0 ? email.toUpperCase() : email,
          password: 'wrong-password-123',
        })
        .expect(401);
    }

    const blocked = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.200')
      .send({ email, password: 'wrong-password-123' })
      .expect(429);

    expect(blocked.headers['retry-after']).toBeDefined();
    expect(JSON.stringify(blocked.body)).not.toContain(email);
  });

  it('blocks the sixth registration from the same IP', async () => {
    const server = app!.getHttpServer();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await request(server)
        .post('/auth/register')
        .send({
          email: `register${attempt}@example.com`,
          password: validPassword,
        })
        .expect(201);
    }

    await request(server)
      .post('/auth/register')
      .send({ email: 'register6@example.com', password: validPassword })
      .expect(429);
  });

  it('never throttles /health', async () => {
    const server = app!.getHttpServer();

    for (let attempt = 1; attempt <= 150; attempt += 1) {
      await request(server).get('/health').expect(200);
    }
  });

  it('applies helmet headers and hides x-powered-by', async () => {
    const response = await request(app!.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows only exact CORS origins and supports preflight', async () => {
    const server = app!.getHttpServer();

    const allowed = await request(server)
      .get('/health')
      .set('Origin', 'https://app.example.com')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );

    const denied = await request(server)
      .get('/health')
      .set('Origin', 'https://evil.example.com')
      .expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const preflight = await request(server)
      .options('/auth/login')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
    expect(
      String(preflight.headers['access-control-allow-headers']).toLowerCase(),
    ).toContain('authorization');
  });

  it('rejects bodies larger than 100kb', async () => {
    await request(app!.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'large@example.com',
        password: 'x'.repeat(110 * 1024),
      })
      .expect(413);
  });
});
