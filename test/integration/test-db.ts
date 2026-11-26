import { testEnv } from '../env.js';

/**
 * Integration tests must never read DATABASE_URL: that belongs to the developer's
 * database. This is the single entry point for the throwaway test database URL.
 */
export function getTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests. Point it at a throwaway database whose name contains "test" (for example secureauth_test).',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must use postgres:// or postgresql://.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database.toLowerCase().includes('test')) {
    throw new Error(
      `Refusing to run integration tests against "${database}": the database name must contain "test".`,
    );
  }
  return value;
}

// DATABASE_URL here is derived from the validated TEST_DATABASE_URL, so the
// real PrismaService and ConfigModule can only ever see the throwaway database.
export function integrationEnv(testDatabaseUrl: string): Record<string, string> {
  return {
    ...testEnv,
    DATABASE_URL: testDatabaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
  };
}
