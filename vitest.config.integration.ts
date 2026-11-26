import { defineConfig } from 'vitest/config';
import {
  getTestDatabaseUrl,
  integrationEnv,
} from './test/integration/test-db.js';

// Throws a clear error before any test starts if the URL is missing or unsafe.
const testDatabaseUrl = getTestDatabaseUrl();

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/integration/*.int-spec.ts'],
    env: integrationEnv(testDatabaseUrl),
    globalSetup: ['./test/integration/global-setup.ts'],
    // All files share one database and truncate it between tests.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
