import { testEnv } from '../../test/env.js';
import { envValidationSchema } from './env.validation.js';

function validate(overrides: Record<string, string>) {
  return envValidationSchema.validate({ ...testEnv, ...overrides });
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
});
