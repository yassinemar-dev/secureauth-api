import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  AdminBootstrapService,
  AdminPromoteError,
} from './admin-bootstrap.service.js';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run admin:promote -- <email>');
    process.exitCode = 1;
    return;
  }

  let app: INestApplicationContext | undefined;
  try {
    // Imported only after argument validation: ConfigModule validates env at import time.
    const { AdminCliModule } = await import('./admin-cli.module.js');
    app = await NestFactory.createApplicationContext(AdminCliModule, {
      logger: false,
    });
    const promoted = await app.get(AdminBootstrapService).promote(email);
    console.log(`Promoted ${promoted.email} to ADMIN`);
  } catch (error) {
    console.error(
      error instanceof AdminPromoteError
        ? error.message
        : 'Failed to promote user',
    );
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

void main();
