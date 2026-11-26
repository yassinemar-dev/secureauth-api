import { Reflector } from '@nestjs/core';
import {
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard.js';

describe('AppThrottlerGuard', () => {
  const guard = new AppThrottlerGuard(
    {} as ThrottlerModuleOptions,
    {} as ThrottlerStorage,
    new Reflector(),
  );

  it('mirrors named Retry-After headers into the plain header', () => {
    const header = vi.fn();
    const response = { header };

    (guard as any).setResponseHeader(response, 'Retry-After-login-ip', '42');

    expect(header).toHaveBeenCalledWith('Retry-After-login-ip', '42');
    expect(header).toHaveBeenCalledWith('Retry-After', '42');
  });

  it('does not add Retry-After for unrelated rate-limit headers', () => {
    const header = vi.fn();
    const response = { header };

    (guard as any).setResponseHeader(response, 'X-RateLimit-Limit', '5');

    expect(header).toHaveBeenCalledExactlyOnceWith('X-RateLimit-Limit', '5');
  });
});
