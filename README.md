# SecureAuth API

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
- RBAC is default deny: protected routes must explicitly declare `@Roles(...)` and use `@UseGuards(JwtAuthGuard, RolesGuard)`, in that order. A route with no `@Roles` metadata is allowed by `RolesGuard` but is still authenticated by `JwtAuthGuard`; it never grants admin-only behaviour.
- Authorisation reads the user's current role from the database with `UsersService.findById`, not from the JWT. A deleted user returns `401`; a user whose current role is not allowed returns `403 Forbidden`.
- An admin cannot change their own role. Demoting the last remaining admin is refused with `409`. A successful role change revokes every refresh token of the target user.
- The first admin is bootstrapped with the `admin:promote` CLI. It normalises the email, requires an existing user, promotes that user to `ADMIN`, revokes their refresh tokens, and prints only safe status/error messages.

## Bootstrap the first admin

Build first, then run the CLI with the same environment/database configuration as the API:

```bash
npm run build
npm run admin:promote -- user@example.com
```

Run it only against a database you intend to modify. It never prints passwords, tokens, or hashes.

Known trade-offs:

- Registering an existing email returns `409`, which reveals that the email is already registered.
- Tokens are returned in the JSON body instead of HttpOnly cookies, so clients must store them securely.
- Each admin request performs one extra DB query so roles are checked against current data.
- Refresh sessions slide with no absolute session cap yet.
- `purgeExpired()` is not scheduled, so expired rows accumulate until something calls it.
- Changing `JWT_REFRESH_SECRET` invalidates all existing refresh tokens at once.
