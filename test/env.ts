// Test-only values shared by the unit and e2e Vitest configs.
// They satisfy the Joi schema so tests never need a developer's .env file.
export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://test_user:test_password@localhost:5432/secureauth_test',
  JWT_ACCESS_SECRET: 'test_only_access_secret_do_not_use_1234567890',
  JWT_REFRESH_SECRET: 'test_only_refresh_secret_do_not_use_0987654321',
};
