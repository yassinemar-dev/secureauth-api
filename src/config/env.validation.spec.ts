import { testEnv } from '../../test/env.js';
import { envValidationSchema } from './env.validation.js';

function validate(overrides: Record<string, string | undefined>) {
  const input: Record<string, string | undefined> = { ...testEnv, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete input[key];
    }
  }
  return envValidationSchema.validate(input);
}

describe('envValidationSchema', () => {
  it('rejects a wildcard CORS origin', () => {
    expect(validate({ CORS_ORIGINS: '*' }).error).toBeDefined();
    expect(
      validate({ CORS_ORIGINS: 'https://app.example.com,*' }).error,
    ).toBeDefined();
  });

  it('accepts an empty or exact-origin CORS allowlist', () => {
    expect(validate({ CORS_ORIGINS: '' }).error).toBeUndefined();
    expect(
      validate({ CORS_ORIGINS: 'https://one.example.com, https://two.example.com' })
        .error,
    ).toBeUndefined();
  });

  it('rejects a malformed CORS origin', () => {
    expect(validate({ CORS_ORIGINS: 'not-an-origin' }).error).toBeDefined();
  });

  it('rejects TRUST_PROXY=true', () => {
    expect(validate({ TRUST_PROXY: 'true' }).error).toBeDefined();
  });

  it('accepts TRUST_PROXY=false or a positive hop count', () => {
    expect(validate({ TRUST_PROXY: 'false' }).error).toBeUndefined();
    expect(validate({ TRUST_PROXY: '1' }).error).toBeUndefined();
    expect(validate({ TRUST_PROXY: '2' }).error).toBeUndefined();
  });

  it('defaults MAX_SESSION_AGE to 30d and accepts a longer value', () => {
    expect(validate({}).value.MAX_SESSION_AGE).toBe('30d');
    expect(validate({ MAX_SESSION_AGE: '90d' }).error).toBeUndefined();
  });

  it('rejects an absolute session shorter than the refresh TTL', () => {
    expect(validate({ MAX_SESSION_AGE: '1d' }).error?.message).toContain(
      'MAX_SESSION_AGE must be greater than or equal to JWT_REFRESH_TTL',
    );
    expect(validate({ JWT_REFRESH_TTL: '30d', MAX_SESSION_AGE: '7d' }).error).toBeDefined();
  });

  it('rejects placeholder JWT secrets in production', () => {
    expect(
      validate({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'development_access_secret_1234567890abcdef',
      }).error?.message,
    ).toContain('development placeholders');
    expect(
      validate({
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: 'production_refresh_secret_change_me_123456',
      }).error?.message,
    ).toContain('development placeholders');
  });

  it('rejects low-diversity JWT secrets in production', () => {
    expect(
      validate({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'a'.repeat(40),
      }).error?.message,
    ).toContain('12 distinct characters');
    expect(
      validate({
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: 'ab'.repeat(20),
      }).error?.message,
    ).toContain('12 distinct characters');
  });

  it('rejects the local development database password in production', () => {
    expect(
      validate({
        NODE_ENV: 'production',
        DATABASE_URL:
          'postgresql://secureauth:secureauth@localhost:5432/secureauth?schema=public',
      }).error?.message,
    ).toContain('local development password');
    expect(
      validate({
        NODE_ENV: 'production',
        DATABASE_URL:
          'postgresql://secureauth:secureauth@127.0.0.1:5432/secureauth?schema=public',
      }).error,
    ).toBeDefined();
  });

  it('accepts strong production settings and applies the guard only in production', () => {
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL:
        'postgresql://app:strong-password@db.example.com:5432/app?schema=public',
      JWT_ACCESS_SECRET: 'prod_access_secret_9f8e7d6c5b4a3210',
      JWT_REFRESH_SECRET: 'prod_refresh_secret_0a1b2c3d4e5f6789',
    };
    expect(validate(production).error).toBeUndefined();
    expect(
      validate({
        ...production,
        NODE_ENV: 'development',
        JWT_ACCESS_SECRET: 'development_access_secret_change_me_123456',
        DATABASE_URL:
          'postgresql://secureauth:secureauth@localhost:5432/secureauth?schema=public',
      }).error,
    ).toBeUndefined();
  });

  it('defaults ENABLE_DOCS to true outside production', () => {
    expect(validate({ ENABLE_DOCS: undefined }).value.ENABLE_DOCS).toBe('true');
    expect(
      validate({ NODE_ENV: 'development', ENABLE_DOCS: undefined }).value
        .ENABLE_DOCS,
    ).toBe('true');
    expect(
      validate({ NODE_ENV: 'test', ENABLE_DOCS: undefined }).value.ENABLE_DOCS,
    ).toBe('true');
  });

  it('defaults ENABLE_DOCS to false in production', () => {
    expect(
      validate({ NODE_ENV: 'production', ENABLE_DOCS: undefined }).value
        .ENABLE_DOCS,
    ).toBe('false');
  });

  it('honours an explicit ENABLE_DOCS value in production', () => {
    expect(
      validate({ NODE_ENV: 'production', ENABLE_DOCS: 'true' }).value
        .ENABLE_DOCS,
    ).toBe('true');
    expect(
      validate({ NODE_ENV: 'production', ENABLE_DOCS: 'false' }).value
        .ENABLE_DOCS,
    ).toBe('false');
  });

  it('rejects an invalid ENABLE_DOCS value', () => {
    expect(validate({ ENABLE_DOCS: 'yes' }).error).toBeDefined();
    expect(validate({ ENABLE_DOCS: 'TRUE' }).error).toBeDefined();
  });
});
