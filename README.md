# SecureAuth API

[![CI](https://github.com/yassinemar-dev/secureauth-api/actions/workflows/ci.yml/badge.svg)](https://github.com/yassinemar-dev/secureauth-api/actions/workflows/ci.yml)

A small NestJS authentication service: email/password registration, HS256 access tokens, rotating opaque refresh tokens, database-backed RBAC and a deliberately minimal HTTP surface. It is a boilerplate, not a complete identity provider.

## Features

- Argon2id password hashing with per-password salts and an equalising dummy hash for unknown emails.
- Short-lived access JWTs; opaque, HMAC-hashed refresh tokens with family rotation and reuse detection.
- Absolute refresh-session cap (`MAX_SESSION_AGE`) in addition to the sliding refresh TTL.
- Fail-closed RBAC: roles come from the database on every request, never from the JWT.
- Atomic last-admin demotion guard with retry on real Serializable conflicts.
- Helmet, exact-origin CORS, body limits, explicit proxy trust and named in-memory rate limits.
- Production env guard that rejects placeholder secrets and the local development database password.
- Separate unit, e2e (do not use the database) and integration (real Postgres) suites, plus CLI utilities.

## Architecture

Modules under `src/`:

| Module | Responsibility |
| --- | --- |
| `AppModule` | Composition root; global config, Prisma, throttler and hardening. |
| `AuthModule` | Register/login/refresh/logout/me, JWT signing and refresh-token rotation. |
| `UsersModule` | User CRUD, safe user projection, pagination and atomic role changes. |
| `AdminModule` | Admin-only user listing and role updates. |
| `PrismaModule` | Global `PrismaService` using the pg driver adapter. |
| `PasswordModule` | Argon2id hashing/verification and rehash detection. |
| `ThrottlerModule` config | Named IP/email/route limiters and `Retry-After` mirroring. |
| CLI entries | `admin:promote` bootstrap and `tokens:purge` cleanup. |

Request flow:

```mermaid
flowchart LR
  C[Client] --> H[Helmet + body limits + CORS + throttler]
  H --> G[JwtAuthGuard / RolesGuard]
  G --> S[Controller]
  S --> U[UsersService / AuthService]
  U --> P[(Postgres via Prisma)]
  S --> R[JSON response]
```

An access token carries `sub`, `role`, `iss` (`secureauth-api`) and `aud` (`secureauth-client`), and verification checks all four. The `role` claim can be stale for up to `JWT_ACCESS_TTL` (15m by default), but it is never used for an authorisation decision: admin routes re-read the role from Postgres on every request. A deleted or demoted user therefore loses privileged access even while an old JWT is still unexpired; `/auth/me` and `/auth/logout-all` only use the token's `sub`.

## Quick start (development)

Requires Node.js >= 22 and npm. PostgreSQL is provided by `docker compose`.

```bash
cp .env.example .env       # generate each JWT secret with: openssl rand -hex 32
docker compose up -d db
npm ci
npm run prisma:deploy
npm run start:dev
```

Verify with `curl http://localhost:3000/health`. Build and lint with `npm run build` and `npm run lint`.

Bootstrap the first admin after registering a user:

```bash
npm run build
npm run admin:promote -- user@example.com
```

## Quick start (Docker production demo)

This uses throwaway secrets and a host port of **3100**, so it does not touch your dev database or port 3000. The database is internal to the compose network; `-v` removes its volume on teardown.

```bash
DB_PASSWORD="$(openssl rand -hex 24)"
ACCESS_SECRET="$(openssl rand -hex 32)"
REFRESH_SECRET="$(openssl rand -hex 32)"
cat > .env.prod <<EOF
POSTGRES_USER=secureauth
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=secureauth_prod
DATABASE_URL=postgresql://secureauth:${DB_PASSWORD}@db:5432/secureauth_prod?schema=public
JWT_ACCESS_SECRET=${ACCESS_SECRET}
JWT_REFRESH_SECRET=${REFRESH_SECRET}
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
MAX_SESSION_AGE=30d
EOF
unset DB_PASSWORD ACCESS_SECRET REFRESH_SECRET

docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d --wait
curl -i http://localhost:3100/health
curl -i -X POST http://localhost:3100/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"correct horse battery staple"}'
curl -i -X POST http://localhost:3100/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"correct horse battery staple"}'
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v
```

`.env.prod` is gitignored. The runtime image installs production dependencies only; the separate `migrate` build target has the Prisma CLI and runs once before the API starts. `node:22-bookworm-slim` is used because argon2 publishes glibc N-API prebuilds; a toolchain exists in the builder stages only. The generated Prisma client is built into `dist/generated/prisma` and verified during the image build.

## API reference

All bodies are JSON. Errors use Nest's standard shape (`statusCode`, `message`, optional `error`) and generic messages.

| Method | Path | Auth | Role | Rate limit | Success | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/health` | none | – | exempt | 200 `{"status":"ok"}` | – |
| GET | `/` | none | – | default | 200 text | 429 |
| POST | `/auth/register` | none | – | 5/h per IP + default | 201 `SafeUser` | 400, 409, 429 |
| POST | `/auth/login` | none | – | 5/min per IP, 10/15min per email + default | 200 `LoginResponse` | 400, 401 `Invalid credentials`, 429 |
| POST | `/auth/refresh` | refresh token in body | – | 20/min per IP + default | 200 `LoginResponse` | 400, 401 `Invalid refresh token`, 429 |
| POST | `/auth/logout` | refresh token in body | – | default | 204 | 400, 429 |
| POST | `/auth/logout-all` | Bearer JWT | any | default | 204 | 401, 429 |
| GET | `/auth/me` | Bearer JWT | any | default | 200 `SafeUser` | 401 `Unauthorized`, 429 |
| GET | `/admin/users?limit=&cursor=` | Bearer JWT | ADMIN | default | 200 `{items,nextCursor}` | 401, 403, 400, 429 |
| PATCH | `/admin/users/:id/role` | Bearer JWT | ADMIN | default | 200 `SafeUser` | 400, 401, 403, 404, 409 |

`role` in the register body is rejected (400). Duplicate registration returns a generic `Unable to create user` (409). Role changes by an admin on themselves return 403; demoting the last admin returns 409 `Unable to demote the last admin`, while an exhausted Serializable retry returns 409 `Concurrent update, please retry`. A successful role change revokes all of that user's refresh tokens.

## Security design

- **Passwords:** Argon2id, `memoryCost: 65536`, `timeCost: 3`, `parallelism: 1`, random salt per hash. Unknown emails still verify against a precomputed dummy hash to reduce user-enumeration timing differences. The plaintext password is never logged or persisted.
- **Access tokens:** HS256 JWTs containing `sub`, `role`, `iss` (`secureauth-api`) and `aud` (`secureauth-client`), with a 15m default TTL (`JWT_ACCESS_TTL`). Tokens with a missing or wrong issuer/audience are rejected. They are bearer tokens; TLS is the deployment's responsibility.
- **Refresh tokens:** 32 random bytes in base64url, stored only as HMAC-SHA256 using `JWT_REFRESH_SECRET` as the pepper. Checks in `rotate()` run in this order: an unknown token gets 401; a token with `revokedAt` set (even if expired) is treated as reuse, revokes the whole family and gets 401; a session past `MAX_SESSION_AGE` revokes the family and gets 401; an unrevoked expired token gets 401 **without** family revocation. A successful rotation revokes the previous token and preserves the family. `MAX_SESSION_AGE` (default 30d, must be >= `JWT_REFRESH_TTL`) is recorded as `sessionStartedAt` at login and copied on rotation; `expiresAt` is capped at `sessionStartedAt + MAX_SESSION_AGE`, so the normal expiry also enforces the cap.
- **Generic errors:** login always says `Invalid credentials`; refresh failures always say `Invalid refresh token`; a missing user on `/auth/me` says `Unauthorized`.
- **RBAC:** `RolesGuard` fails closed when no `@Roles(...)` metadata is present. `JwtAuthGuard` runs first; role checks reload the current user from Postgres, so stale token roles cannot grant access.
- **HTTP hardening:** Helmet, `x-powered-by` disabled, 100kb JSON/urlencoded bodies, exact-origin CORS allowlist (no wildcards, credentials disabled), a sanitised production exception filter (generic 500; no stacks, query text or parameters in logs), explicit `TRUST_PROXY` (never `true`), and named throttlers keyed by IP, email and canonical route with a generic 429 and `Retry-After`. When `TRUST_PROXY` is a hop count, the API port must be reachable only from the trusted proxy: otherwise a client can forge `X-Forwarded-For` and bypass the IP limits. The shipped prod demo keeps `TRUST_PROXY=false`.
- **Production env guard:** with `NODE_ENV=production`, Joi rejects JWT secrets containing `change_me` or starting with `development_`, JWT secrets with fewer than 12 distinct characters, and a `DATABASE_URL` using `localhost`/`127.0.0.1`/`::1` with password `secureauth`. Generate each secret with `openssl rand -hex 32` (64 distinct hex characters). It also refuses a `MAX_SESSION_AGE` shorter than `JWT_REFRESH_TTL` and identical JWT secrets in every environment.

## Threat model

**Assets:** password hashes, refresh tokens, access-token signing keys, user identities/roles, and database availability.

**Actors:** unauthenticated clients, authenticated low-privilege users, stolen-token attackers, and operators with env-file access.

| Threat | Mitigation |
| --- | --- |
| Password database leak | Argon2id with costly parameters and per-password salts. |
| Credential stuffing / online guessing | Per-IP and per-email login limits; generic responses. |
| User enumeration via timing or messages | Dummy hash verification and identical error bodies. |
| Stolen refresh token | HMAC-only storage, family rotation, reuse detection and absolute session cap. |
| Privilege escalation via stale JWT role | Current role re-read from Postgres on each protected request. |
| Last admin removed | Atomic Serializable guard with retry and distinct 409 responses. |
| XSS-adjacent header abuse / clickjacking | Helmet security headers and exact-origin CORS. |
| Resource exhaustion | Body limits and in-memory throttlers. |
| Accidental dev configuration in production | Joi production guard on secrets and database URL. |

**Out of scope / not protected against:** no MFA, no email verification, no password reset flow, no account lockout notification, in-memory throttler state (per-instance, lost on restart), no audit logging, no HttpOnly-cookie option (tokens are returned in JSON), no TLS termination, no shared rate-limit store, and no protection against an attacker who already holds a valid access token or the signing secrets.

## Known trade-offs

- Registering an existing email returns 409, which reveals that the address is registered.
- JWTs are stateless until the DB role lookup; role changes revoke refresh tokens but do not blacklist existing access tokens before their short TTL. The access-token `role` claim can be stale for up to `JWT_ACCESS_TTL` (15m default) but is never used for authorisation decisions: admin routes read the role from Postgres.
- If a refresh rotation succeeds but its response is lost, a client retry presents the now-revoked token and strict reuse detection revokes the whole family, including the successor token the client never received. Clients must treat a 401 on refresh as "log in again".
- Every admin request performs an extra DB query.
- Refresh expiry slides, but only up to the absolute session deadline. A revoked token replayed after its own expiry still revokes the family; an unrevoked expired token does not.
- `purgeExpired()` is invoked by a CLI, not by a timer; expired rows accumulate until the job runs.
- Changing `JWT_REFRESH_SECRET` invalidates all refresh tokens at once (and their hashes).
- Per-email login limiting can be abused to slow down a known account.
- Rate limits are per instance until a shared store is introduced. With `TRUST_PROXY` set, only the trusted proxy may reach the API port; otherwise `X-Forwarded-For` can be forged to bypass IP limits.

## CLI maintenance

```bash
npm run build
npm run admin:promote -- user@example.com   # prints a safe status line
npm run tokens:purge                        # prints only the deleted row count
```

Run `tokens:purge` from an external scheduler (cron, systemd timer or a platform job). There is no built-in cron: this app is stateless and may run many replicas, so an in-process timer would run N times, has no durable schedule or failure tracking, and would need a shared store to coordinate. Keeping it as a one-shot command makes the deletion count observable and the job easy to run with the same validated production environment.

## Testing

| Command | Needs `.env`? | Needs Postgres? | What it covers |
| --- | --- | --- | --- |
| `npm test` | No | No | Unit tests with fakes |
| `npm run test:cov` | No | No | Unit tests plus thresholds: lines 80%, functions 80%, branches 70%, statements 80% |
| `npm run test:e2e` | No | No | HTTP behaviour with in-memory fakes |
| `npm run test:integration` | No | **Yes** | Real Postgres, real `PrismaService`, real services |

Unit, coverage and e2e suites use `test/env.ts`; a developer's `.env` is never read. Fakes do **not** prove real unique constraints, transaction isolation, cascades or adapter-specific errors — the integration suite does. CI runs the unit/e2e suites on Node 22 and 24; they do not use the database, although the workflow provisions a throwaway `postgres:16-alpine` service for the integration step.

Integration tests read only `TEST_DATABASE_URL` and refuse a database name without `test`. Create one in the existing compose Postgres container (the `dupdb` container is unrelated):

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE secureauth_test;"'
TEST_DATABASE_URL='postgresql://secureauth:secureauth@localhost:5432/secureauth_test?schema=public' npm run test:integration
```

Migrations are deployed before the suite and tables are truncated between tests; files run serially because they share one database.

## Project structure

```text
src/
  admin/       admin HTTP controller, bootstrap CLI and promotion service
  auth/        JWT/refresh logic, guards, decorators and DTOs
  config/      Joi environment validation
  password/    Argon2id service
  prisma/      PrismaService and global module
  throttler/   named limiter config and Retry-After guard
  tokens/      tokens:purge CLI
  generated/   generated Prisma client (gitignored)
test/
  e2e specs, in-memory Prisma fake, integration specs and test env
prisma/        schema and migrations
.github/       CI matrix and Dependabot
```

See `SECURITY.md` for vulnerability reporting.
