import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  // Named throttlers get a suffixed header; clients should also see plain Retry-After.
  protected override setResponseHeader(
    res: Record<string, any>,
    name: string,
    value: string | number,
  ): void {
    super.setResponseHeader(res, name, value);
    if (name.startsWith('Retry-After')) {
      super.setResponseHeader(res, 'Retry-After', value);
    }
  }
}
