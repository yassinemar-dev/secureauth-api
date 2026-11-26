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

Known trade-offs:

- Registering an existing email returns `409`, which reveals that the email is already registered.
- Tokens are returned in the JSON body instead of HttpOnly cookies, so clients must store them securely.
