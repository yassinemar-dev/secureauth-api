import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const DOCS_PATH = 'docs';

export function configureDocs(app: INestApplication): void {
  const config = app.get(ConfigService);
  // Production defaults to false: fewer reachable endpoints and no free API map.
  if (config.get<string>('ENABLE_DOCS') !== 'true') {
    return;
  }

  const document = new DocumentBuilder()
    .setTitle('SecureAuth API')
    .setDescription(
      'Email/password auth with rotating refresh tokens and database-backed RBAC. ' +
        'All example values are fake; use example.com addresses only.',
    )
    .setVersion('0.0.1')
    .addTag('Auth', 'Registration, login, refresh, logout and current user')
    .addTag('Admin', 'Admin-only user listing and role changes')
    .addTag('Health', 'Liveness and root service information')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
        description: 'Access token returned by /auth/login or /auth/refresh',
      },
      'bearer',
    )
    .build();

  SwaggerModule.setup(DOCS_PATH, app, SwaggerModule.createDocument(app, document), {
    ui: true,
    // Only /docs-json is exposed; no /docs-yaml endpoint.
    raw: ['json'],
    customSiteTitle: 'SecureAuth API docs',
  });
}
