import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildThrottlerOptions } from './throttler.config.js';
import { THROTTLER_NAMES } from './throttler.constants.js';

type NamedThrottler = {
  name: string;
  ttl: number;
  limit: number;
  skipIf?: (context: ExecutionContext) => boolean;
  getTracker?: (request: Record<string, any>) => string | Promise<string>;
};

function throttlers(): NamedThrottler[] {
  const options = buildThrottlerOptions(
    new ConfigService({ THROTTLE_TTL_MS: 45_000, THROTTLE_LIMIT: 7 }),
  ) as { throttlers: NamedThrottler[] };
  return options.throttlers;
}

function contextFor(method: string, path: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, path }) }),
  } as unknown as ExecutionContext;
}

function find(name: string): NamedThrottler {
  const throttler = throttlers().find((item) => item.name === name);
  if (!throttler) throw new Error(`Missing throttler ${name}`);
  return throttler;
}

describe('buildThrottlerOptions', () => {
  it('reads the configurable default window and limit', () => {
    expect(throttlers().find((item) => item.name === THROTTLER_NAMES.default)).toMatchObject({
      ttl: 45_000,
      limit: 7,
    });
  });

  it.each([
    [THROTTLER_NAMES.loginIp, '/auth/login'],
    [THROTTLER_NAMES.loginEmail, '/auth/login'],
    [THROTTLER_NAMES.registerIp, '/auth/register'],
    [THROTTLER_NAMES.refreshIp, '/auth/refresh'],
  ])('applies %s only to %s', (name, path) => {
    const throttler = find(name);

    expect(throttler.skipIf!(contextFor('POST', path))).toBe(false);
    expect(throttler.skipIf!(contextFor('POST', '/health'))).toBe(true);
    expect(throttler.skipIf!(contextFor('GET', path))).toBe(true);
  });

  it('tracks IP addresses and falls back for missing IPs', () => {
    const tracker = find(THROTTLER_NAMES.loginIp).getTracker!;

    expect(tracker({ ip: '203.0.113.10' })).toBe('203.0.113.10');
    expect(tracker({})).toBe('unknown');
  });

  it('tracks normalized email and falls back to IP without an email', () => {
    const tracker = find(THROTTLER_NAMES.loginEmail).getTracker!;

    expect(
      tracker({ ip: '203.0.113.10', body: { email: '  User@Example.COM  ' } }),
    ).toBe('user@example.com');
    expect(tracker({ ip: '203.0.113.10', body: {} })).toBe('203.0.113.10');
    expect(tracker({ ip: '203.0.113.10', body: { email: '   ' } })).toBe(
      '203.0.113.10',
    );
  });
});
