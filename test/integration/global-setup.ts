import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTestDatabaseUrl } from './test-db.js';

// Vitest runs this once before any integration file touches the database.
export function setup(): void {
  const url = getTestDatabaseUrl();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const prismaBin = path.join(root, 'node_modules', '.bin', 'prisma');
  const command = process.platform === 'win32' ? `${prismaBin}.cmd` : prismaBin;

  const result = spawnSync(command, ['migrate', 'deploy'], {
    cwd: root,
    // Override any developer DATABASE_URL before prisma.config.ts loads .env.
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed with exit code ${result.status}`,
    );
  }
}
