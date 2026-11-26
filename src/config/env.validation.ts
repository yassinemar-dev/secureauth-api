import Joi from 'joi';

const jwtSecret = Joi.string().min(32).required();
const ttl = Joi.string().pattern(/^\d+[smhd]$/);

const TTL_TO_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

function ttlToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    return Number.NaN;
  }
  return Number(match[1]) * TTL_TO_MS[match[2] as keyof typeof TTL_TO_MS];
}

function isDevelopmentSecret(value: string): boolean {
  return value.includes('change_me') || value.startsWith('development_');
}

function hasEnoughDistinctCharacters(value: string): boolean {
  return new Set(value).size >= 12;
}

function usesLocalDevelopmentDatabase(value: string): boolean {
  try {
    const url = new URL(value);
    const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
      url.hostname,
    );
    return isLocal && url.password === 'secureauth';
  } catch {
    return false;
  }
}

// Wildcards would defeat the exact-origin allowlist.
const corsOrigins = Joi.string()
  .allow('')
  .custom((value: string, helpers) => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.some((origin) => origin.includes('*'))) {
      return helpers.error('any.invalid');
    }
    for (const origin of origins) {
      const { error } = Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .validate(origin);
      if (error) {
        return helpers.error('any.invalid');
      }
    }
    return origins.join(',');
  })
  .default('');

// Express accepts false or a hop count. "true" is intentionally excluded.
const trustProxy = Joi.alternatives()
  .try(Joi.string().valid('false'), Joi.string().pattern(/^[1-9]\d*$/))
  .default('false');

// Docs are useful locally but off by default in production: a smaller attack
// surface and no free API map for unauthenticated callers.
const enableDocs = Joi.string().valid('true', 'false');

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_ACCESS_SECRET: jwtSecret,
  JWT_REFRESH_SECRET: jwtSecret,
  JWT_ACCESS_TTL: ttl.default('15m'),
  JWT_REFRESH_TTL: ttl.default('7d'),
  MAX_SESSION_AGE: ttl.default('30d'),
  THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  CORS_ORIGINS: corsOrigins,
  TRUST_PROXY: trustProxy,
  ENABLE_DOCS: Joi.when('NODE_ENV', {
    is: 'production',
    // oxlint-disable-next-line unicorn/no-thenable -- Joi's conditional API requires a `then` key.
    then: enableDocs.default('false'),
    otherwise: enableDocs.default('true'),
  }),
})
  .custom((value, helpers) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      return helpers.error('auth.equalSecrets');
    }
    // An absolute session shorter than a single refresh token is contradictory.
    if (ttlToMs(value.MAX_SESSION_AGE) < ttlToMs(value.JWT_REFRESH_TTL)) {
      return helpers.error('auth.shortSession');
    }
    if (value.NODE_ENV === 'production') {
      if (
        isDevelopmentSecret(value.JWT_ACCESS_SECRET) ||
        isDevelopmentSecret(value.JWT_REFRESH_SECRET)
      ) {
        return helpers.error('auth.developmentSecret');
      }
      if (
        !hasEnoughDistinctCharacters(value.JWT_ACCESS_SECRET) ||
        !hasEnoughDistinctCharacters(value.JWT_REFRESH_SECRET)
      ) {
        return helpers.error('auth.weakSecret');
      }
      if (usesLocalDevelopmentDatabase(value.DATABASE_URL)) {
        return helpers.error('auth.developmentDatabase');
      }
    }
    return value;
  })
  .messages({
    'auth.equalSecrets':
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    'auth.shortSession':
      'MAX_SESSION_AGE must be greater than or equal to JWT_REFRESH_TTL',
    'auth.developmentSecret':
      'JWT secrets must not contain development placeholders in production',
    'auth.weakSecret':
      'JWT secrets must contain at least 12 distinct characters in production',
    'auth.developmentDatabase':
      'DATABASE_URL must not use the local development password in production',
  });
