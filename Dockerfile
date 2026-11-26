# syntax=docker/dockerfile:1

# The dependencies stage keeps the full toolchain: prisma generate runs in
# postinstall and the build needs TypeScript/Vite. argon2 ships N-API
# prebuilds; compilers are installed only here as a fallback, never in runtime.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ openssl \
 && rm -rf /var/lib/apt/lists/*
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json nest-cli.json tsconfig.json tsconfig.build.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build && test -d dist/generated/prisma

# Runtime has production dependencies only. --ignore-scripts is required
# because the postinstall prisma CLI is a devDependency; the generated client
# and the native argon2 addon are copied from the stages that built them.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=deps /app/node_modules/argon2 ./node_modules/argon2
COPY --from=build /app/dist ./dist
RUN test -d dist/generated/prisma
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/main.js"]

# Migrations need the Prisma CLI, which is deliberately absent from runtime.
# Run this target as a one-shot service that exits after `prisma migrate deploy`.
FROM build AS migrate
# npm ci ran as root; the CLI needs to write engine metadata as the non-root user.
RUN chown -R node:node /app/node_modules/@prisma/engines
USER node
CMD ["npm", "run", "prisma:deploy"]
