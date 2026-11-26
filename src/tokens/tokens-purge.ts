import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { pathToFileURL } from 'node:url';
import { RefreshTokenService } from '../auth/refresh-token.service.js';

export async function printPurgeCount(
  tokens: Pick<RefreshTokenService, 'purgeExpired'>,
  print: (count: number) => void,
): Promise<void> {
  const deleted = await tokens.purgeExpired();
  print(deleted);
}

async function main(): Promise<void> {
  let app: INestApplicationContext | undefined;
  try {
    // ConfigModule validates env at import time, as in admin:promote.
    const { AdminCliModule } = await import('../admin/admin-cli.module.js');
    app = await NestFactory.createApplicationContext(AdminCliModule, {
      logger: false,
    });
    await printPurgeCount(app.get(RefreshTokenService), (count) =>
      console.log(String(count)),
    );
  } catch {
    // Never leak connection details or secrets from a scheduled job's logs.
    console.error('Failed to purge expired tokens');
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

// Keep the module importable by unit tests without starting an app context.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
