import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { configureApp } from '../src/app.setup.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { testEnv } from './env.js';

type Operation = {
  tags?: string[];
  summary?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{
    name: string;
    schema?: { minimum?: number; maximum?: number; example?: unknown };
  }>;
  responses: Record<
    string,
    { headers?: Record<string, { description?: string; schema?: unknown }> }
  >;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, Operation>>;
  components?: {
    schemas?: Record<
      string,
      {
        properties: Record<
          string,
          {
            minLength?: number;
            maxLength?: number;
            minimum?: number;
            maximum?: number;
            example?: unknown;
          }
        >;
      }
    >;
    securitySchemes?: Record<
      string,
      { type?: string; scheme?: string; bearerFormat?: string }
    >;
  };
};

const noopPrisma = {
  $connect: async () => undefined,
  $disconnect: async () => undefined,
};

// ConfigModule snapshots process.env when AppModule is imported, so the
// per-case value is supplied through a ConfigService override instead.
function configFor(overrides: Record<string, string | undefined>): ConfigService {
  const values: Record<string, string> = { ...testEnv };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete values[key];
    } else {
      values[key] = value;
    }
  }
  if (values.ENABLE_DOCS === undefined) {
    values.ENABLE_DOCS = values.NODE_ENV === 'production' ? 'false' : 'true';
  }
  return new ConfigService(values);
}

async function withEnv(
  overrides: Record<string, string | undefined>,
  run: (app: INestApplication<App>) => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  let app: INestApplication<App> | undefined;
  try {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(noopPrisma)
      .overrideProvider(ConfigService)
      .useValue(configFor(overrides))
      .compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    await run(app as INestApplication<App>);
  } finally {
    await app?.close();
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function expectBearer(operation: Operation): void {
  expect(operation.security).toEqual([{ bearer: [] }]);
}

describe('OpenAPI docs (e2e)', () => {
  it('serves /docs and a complete /docs-json when ENABLE_DOCS=true', async () => {
    await withEnv({ ENABLE_DOCS: 'true', NODE_ENV: 'development' }, async (app) => {
      const server = app.getHttpServer();

      await request(server).get('/docs').expect(200).expect('Content-Type', /html/);

      const response = await request(server).get('/docs-json').expect(200);
      const doc = response.body as OpenApiDocument;

      expect(doc.paths).toHaveProperty('/auth/login');
      expect(doc.paths).toHaveProperty('/auth/refresh');
      expect(doc.paths).toHaveProperty('/admin/users');
      expect(doc.components?.securitySchemes?.bearer).toMatchObject({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      });

      const schemas = doc.components?.schemas;
      const registerSchema = schemas?.RegisterDto;
      expect(registerSchema?.properties.email.maxLength).toBe(254);
      expect(registerSchema?.properties.password.minLength).toBe(12);
      expect(registerSchema?.properties.password.maxLength).toBe(128);
      expect(registerSchema?.properties.password.example).toBe(
        'example-password-123',
      );
      const refreshSchema = schemas?.RefreshTokenDto;
      expect(refreshSchema?.properties.refreshToken.minLength).toBe(20);
      expect(refreshSchema?.properties.refreshToken.maxLength).toBe(512);
      expect(registerSchema?.properties.email.example).toBe('user@example.com');

      const register = doc.paths['/auth/register'].post;
      expect(register.tags).toContain('Auth');
      expect(register.summary).toBeDefined();
      for (const status of ['201', '400', '409', '429']) {
        expect(register.responses).toHaveProperty(status);
      }
      expect(register.responses['429'].headers).toHaveProperty('Retry-After');

      const login = doc.paths['/auth/login'].post;
      expect(login.tags).toContain('Auth');
      for (const status of ['200', '400', '401', '429']) {
        expect(login.responses).toHaveProperty(status);
      }
      expect(login.responses['429'].headers).toHaveProperty('Retry-After');

      const refresh = doc.paths['/auth/refresh'].post;
      for (const status of ['200', '400', '401', '429']) {
        expect(refresh.responses).toHaveProperty(status);
      }

      const logout = doc.paths['/auth/logout'].post;
      for (const status of ['204', '400', '429']) {
        expect(logout.responses).toHaveProperty(status);
      }

      const logoutAll = doc.paths['/auth/logout-all'].post;
      for (const status of ['204', '401', '429']) {
        expect(logoutAll.responses).toHaveProperty(status);
      }
      expectBearer(logoutAll);

      const me = doc.paths['/auth/me'].get;
      for (const status of ['200', '401', '429']) {
        expect(me.responses).toHaveProperty(status);
      }
      expectBearer(me);

      const list = doc.paths['/admin/users'].get;
      expect(list.tags).toContain('Admin');
      expect(list.parameters).toHaveLength(2);
      const limitParam = list.parameters?.find((param) => param.name === 'limit');
      expect(limitParam?.schema?.minimum).toBe(1);
      expect(limitParam?.schema?.maximum).toBe(100);
      for (const status of ['200', '400', '401', '403', '429']) {
        expect(list.responses).toHaveProperty(status);
      }
      expectBearer(list);

      const updateRole = doc.paths['/admin/users/{id}/role'].patch;
      for (const status of ['200', '400', '401', '403', '404', '409', '429']) {
        expect(updateRole.responses).toHaveProperty(status);
      }
      expectBearer(updateRole);

      const health = doc.paths['/health'].get;
      expect(health.tags).toContain('Health');
      expect(health.responses).toHaveProperty('200');

      const raw = JSON.stringify(doc);
      expect(raw).not.toContain('passwordHash');
      expect(raw).not.toContain(testEnv.JWT_ACCESS_SECRET);
      expect(raw).not.toContain(testEnv.JWT_REFRESH_SECRET);
      expect(raw).not.toContain(testEnv.DATABASE_URL);
    });
  });

  it('returns 404 for both doc routes when ENABLE_DOCS=false', async () => {
    await withEnv({ ENABLE_DOCS: 'false', NODE_ENV: 'development' }, async (app) => {
      const server = app.getHttpServer();
      await request(server).get('/docs').expect(404);
      await request(server).get('/docs-json').expect(404);
    });
  });

  it('defaults to disabled in production and honours an explicit opt-in', async () => {
    await withEnv({ ENABLE_DOCS: undefined, NODE_ENV: 'production' }, async (app) => {
      const server = app.getHttpServer();
      await request(server).get('/docs').expect(404);
      await request(server).get('/docs-json').expect(404);
    });

    await withEnv({ ENABLE_DOCS: 'true', NODE_ENV: 'production' }, async (app) => {
      const server = app.getHttpServer();
      await request(server).get('/docs').expect(200);
      await request(server).get('/docs-json').expect(200);
    });
  });
});
