import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service.js';
import { SKIP_ALL_THROTTLERS } from './throttler/throttler.constants.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @SkipThrottle(SKIP_ALL_THROTTLERS)
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
