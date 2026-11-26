import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import helmet from 'helmet';

const BODY_LIMIT = '100kb';
const CORS_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];
const CORS_HEADERS = ['Content-Type', 'Authorization'];

function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseTrustProxy(value: string): false | number {
  return value === 'false' ? false : Number(value);
}

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const instance = app.getHttpAdapter().getInstance() as {
    disable(name: string): void;
    set(name: string, value: unknown): void;
  };

  app.use(helmet());
  instance.disable('x-powered-by');
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));

  const origins = parseOrigins(config.get<string>('CORS_ORIGINS') ?? '');
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    methods: CORS_METHODS,
    allowedHeaders: CORS_HEADERS,
    credentials: false,
  });

  instance.set(
    'trust proxy',
    parseTrustProxy(config.get<string>('TRUST_PROXY') ?? 'false'),
  );
}
