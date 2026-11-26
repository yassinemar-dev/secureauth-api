import Joi from 'joi';

const jwtSecret = Joi.string().min(32).required();
const ttl = Joi.string().pattern(/^\d+[smhd]$/);

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

// Cross-field rule: the two JWT secrets must never be the same value.
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
  THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  CORS_ORIGINS: corsOrigins,
  TRUST_PROXY: trustProxy,
})
  .custom((value, helpers) =>
    value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET
      ? helpers.error('any.custom')
      : value,
  )
  .messages({
    'any.custom': 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
  });
