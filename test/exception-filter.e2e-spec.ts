import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AppService } from '../src/app.service.js';
import { configureApp } from '../src/app.setup.js';

const SQL_ERROR =
  "SELECT * FROM users WHERE password = 'hunter2' -- internal query";

describe('Exception filter (e2e)', () => {
  let app: INestApplication<App> | undefined;
  const originalNodeEnv = process.env.NODE_ENV;

  const buildApp = async (): Promise<void> => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppService)
      .useValue({
        getHello: () => {
          throw new Error(SQL_ERROR);
        },
      })
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  };

  afterEach(async () => {
    await app?.close();
    app = undefined;
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('returns a generic 500 and logs no stack or query text in production', async () => {
    process.env.NODE_ENV = 'production';
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await buildApp();

    const response = await request(app!.getHttpServer()).get('/').expect(500);

    expect(response.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('Error');
    expect(logged).not.toContain('SELECT');
    expect(logged).not.toContain('password');
    expect(logged).not.toMatch(/\n\s+at /);
  });

  it('leaves HttpExceptions unchanged', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await buildApp();

    const response = await request(app!.getHttpServer())
      .get('/auth/me')
      .expect(401);

    expect(response.body).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    });
  });
});
