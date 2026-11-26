import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../../src/app.setup.js';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createPrisma, resetDb } from './fixtures.js';

describe('Full HTTP flow against Postgres', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await createPrisma();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    // app.close() calls onModuleDestroy() on the overridden PrismaService.
    await app.close();
  });

  it('register -> login -> me -> refresh -> reuse returns 401', async () => {
    const server = app.getHttpServer();
    const email = 'flow@example.com';
    const password = 'correct horse battery staple';

    const registered = await request(server)
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    expect(registered.body.email).toBe(email);
    expect(registered.body).not.toHaveProperty('passwordHash');

    const login = await request(server)
      .post('/auth/login')
      .send({ email: 'FLOW@Example.COM', password })
      .expect(200);
    const accessToken = login.body.accessToken as string;
    const refreshToken = login.body.refreshToken as string;
    expect(accessToken).toBeTypeOf('string');
    expect(refreshToken).toBeTypeOf('string');

    const me = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(email);
    expect(me.body).not.toHaveProperty('passwordHash');

    const refreshed = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).toBeTypeOf('string');
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);

    const reuse = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expect(reuse.body.message).toBe('Invalid refresh token');

    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
    expect(
      await prisma.refreshToken.count({
        where: { userId: registered.body.id, revokedAt: null },
      }),
    ).toBe(0);
  });
});
