import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeIp, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { normalizeEmail } from '../users/users.service.js';
import { THROTTLER_NAMES } from './throttler.constants.js';

type RequestLike = Record<string, any>;

function isRoute(
  context: ExecutionContext,
  method: string,
  path: string,
): boolean {
  const request = context.switchToHttp().getRequest<RequestLike>();
  // Express matches paths case-insensitively and tolerates trailing slashes,
  // but req.path keeps the client's spelling. The matched route is canonical,
  // so casing/slash variants share one limiter bucket. The fallback covers
  // guards that run before route matching.
  const matchedPath =
    typeof request.route?.path === 'string'
      ? request.route.path
      : typeof request.path === 'string'
        ? request.path.replace(/\/+$/, '').toLowerCase()
        : '';
  return request.method === method && matchedPath === path;
}

function ipTracker(request: RequestLike): string {
  const ip =
    typeof request.ip === 'string' && request.ip
      ? normalizeIp(request.ip)
      : 'unknown';
  return ip || 'unknown';
}

function emailTracker(request: RequestLike): string {
  const email = request.body?.email;
  return typeof email === 'string' && email.trim()
    ? normalizeEmail(email)
    : ipTracker(request);
}

export function buildThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const defaultTtl = Number(config.getOrThrow('THROTTLE_TTL_MS'));
  const defaultLimit = Number(config.getOrThrow('THROTTLE_LIMIT'));

  return {
    errorMessage: 'Too Many Requests',
    throttlers: [
      { name: THROTTLER_NAMES.default, ttl: defaultTtl, limit: defaultLimit },
      {
        name: THROTTLER_NAMES.loginIp,
        ttl: 60_000,
        limit: 5,
        getTracker: ipTracker,
        // Named throttlers are global; skip them on every route except login.
        skipIf: (context) => !isRoute(context, 'POST', '/auth/login'),
      },
      {
        name: THROTTLER_NAMES.loginEmail,
        ttl: 900_000,
        limit: 10,
        getTracker: emailTracker,
        skipIf: (context) => !isRoute(context, 'POST', '/auth/login'),
      },
      {
        name: THROTTLER_NAMES.registerIp,
        ttl: 3_600_000,
        limit: 5,
        getTracker: ipTracker,
        skipIf: (context) => !isRoute(context, 'POST', '/auth/register'),
      },
      {
        name: THROTTLER_NAMES.refreshIp,
        ttl: 60_000,
        limit: 20,
        getTracker: ipTracker,
        skipIf: (context) => !isRoute(context, 'POST', '/auth/refresh'),
      },
    ],
  };
}
