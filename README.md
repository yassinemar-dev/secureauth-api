# SecureAuth API

[![CI](https://github.com/yassinemar-dev/secureauth-api/actions/workflows/ci.yml/badge.svg)](https://github.com/yassinemar-dev/secureauth-api/actions/workflows/ci.yml)

A production-grade authentication boilerplate built with NestJS, TypeScript, PostgreSQL, Prisma and Docker.

## Quick start

```bash
cp .env.example .env
docker compose up -d
npm install
npm run prisma:deploy
npm run start:dev
```

## Security design

- Passwords are hashed with argon2id (`memoryCost: 65536`, `timeCost: 3`, `parallelism: 1`).
- Refresh tokens are opaque 32-byte random strings, not JWTs. Rotation keeps the family id; replaying a rotated token revokes the whole family.
- Only an HMAC-SHA256 hash of each refresh token is stored. `JWT_REFRESH_SECRET` is reused as the HMAC pepper, so the raw token never reaches the database.
- Authentication failures use generic messages; login returns `Invalid credentials`, and refresh failures return `Invalid refresh token`.
- RBAC is default deny: protected routes must explicitly declare `@Roles(...)` and use `@UseGuards(JwtAuthGuard, RolesGuard)`, in that order. If `RolesGuard` is used without `@Roles` metadata, it fails closed with `403 Forbidden`.
- Authorisation reads the user's current role from the database with `UsersService.findById`, not from the JWT. A deleted user returns `401`; a user whose current role is not allowed returns `403 Forbidden`.
- An admin cannot change their own role. The last-admin check and role update run in one Serializable transaction; serialization failures are retried and then become `409 Concurrent update, please retry`, which is deliberately distinct from the genuine `409 Unable to demote the last admin`. A successful role change revokes every refresh token of the target user.
- The first admin is bootstrapped with the `admin:promote` CLI. It normalises the email, requires an existing user, promotes that user to `ADMIN`, revokes their refresh tokens, and prints only safe status/error messages.

## Bootstrap the first admin

Build first, then run the CLI with the same environment/database configuration as the API:

```bash
npm run build
npm run admin:promote -- user@example.com
```

Run it only against a database you intend to modify. It never prints passwords, tokens, or hashes.

## Hardening

`configureApp()` in `src/app.setup.ts` is called by `main.ts` and by every e2e app, so production and tests share the same HTTP hardening. It applies Helmet, disables `x-powered-by`, sets a 100kb JSON/urlencoded body limit, configures an exact-origin CORS allowlist, and applies Express `trust proxy`. Rate limiting is global through `@nestjs/throttler`.

| Route | Limit |
| --- | --- |
| Default (all routes except `/health`) | `THROTTLE_LIMIT` per `THROTTLE_TTL_MS` per IP (defaults: 100 / 60s) |
| `POST /auth/login` | 5 per minute per IP **and** 10 per 15 minutes per normalized email |
| `POST /auth/register` | 5 per hour per IP |
| `POST /auth/refresh` | 20 per minute per IP |
| `GET /health` | Excluded from throttling |

Rejected requests return `429` with a generic body and a `Retry-After` header. Emails and tokens are never placed in rate-limit responses or logs.

- `CORS_ORIGINS` is a comma-separated list of exact origins; empty means no cross-origin requests. Wildcards such as `*` are rejected. Allowed methods are `GET`, `POST`, `PATCH` and `DELETE`; allowed request headers are `Content-Type` and `Authorization`; credentials are disabled.
- `TRUST_PROXY=false` ignores `X-Forwarded-For`. A positive integer trusts that many proxy hops, so `X-Forwarded-For` can affect `req.ip` and IP-based limits. The string `true` is intentionally rejected because it trusts arbitrary client-supplied headers.
- Helmet adds security headers such as `X-Content-Type-Options` and `Strict-Transport-Security`.

Known trade-offs:

- Registering an existing email returns `409`, which reveals that the email is already registered.
- Tokens are returned in the JSON body instead of HttpOnly cookies, so clients must store them securely.
- Each admin request performs one extra DB query so roles are checked against current data.
- Refresh sessions slide with no absolute session cap yet.
- `purgeExpired()` is not scheduled, so expired rows accumulate until something calls it.
- Changing `JWT_REFRESH_SECRET` invalidates all existing refresh tokens at once.
- The throttler store is in-memory; multiple API instances need a shared store such as Redis.
- Per-email login limiting allows a targeted lockout/DoS of one known account.
- Rate limits are per instance, so effective limits scale with the number of instances until a shared store is added.

## Testing

| Command | Needs `.env`? | Needs Postgres? | What it covers |
| --- | --- | --- | --- |
| `npm test` | No | No | Unit tests with fakes |
| `npm run test:cov` | No | No | The same unit tests plus thresholds: lines 80%, functions 80%, branches 70%, statements 80% |
| `npm run test:e2e` | No | No | HTTP behaviour with in-memory fakes (including hardening and RBAC) |
| `npm run test:integration` | No | **Yes** | Real Postgres, real PrismaService and real services |

Unit, coverage and e2e suites get their configuration from `test/env.ts`; a local `.env` is never read. The fake-based suites do **not** prove real unique-constraint behaviour, real transaction isolation, real cascades or adapter-specific serialization errors. The integration suite exists to cover those.

### Integration database

Integration tests only read `TEST_DATABASE_URL` and refuse to start unless its database name contains `test`. They never read `DATABASE_URL` from `.env`. Create a separate database in the existing compose Postgres container (this does not touch the `dupdb` container):

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE secureauth_test;"'
```

Then run the suite, using the host port from your `.env` (`POSTGRES_PORT`, default `5432`):

```bash
TEST_DATABASE_URL='postgresql://secureauth:secureauth@localhost:5432/secureauth_test?schema=public' npm run test:integration
```

The suite applies migrations with `prisma migrate deploy` before any test and truncates tables between tests. Because all integration files share one database, they run serially. The concurrent rotation test repeats 20 times and the concurrent last-admin demotion test repeats 10 times to reduce scheduling flakiness; a real Serializable conflict can still surface as a pg `DriverAdapterError`, which the retry logic recognises alongside Prisma `P2034`.

CI uses a throwaway `postgres:16-alpine` service with the database `secureauth_test` and inline credentials; no repository secrets are used.
