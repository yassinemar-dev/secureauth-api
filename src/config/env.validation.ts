import Joi from 'joi';

const jwtSecret = Joi.string().min(32).required();
const ttl = Joi.string().pattern(/^\d+[smhd]$/);

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
})
  .custom((value, helpers) =>
    value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET
      ? helpers.error('any.custom')
      : value,
  )
  .messages({
    'any.custom': 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
  });
