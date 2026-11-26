import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service.js';
import { HealthResponseDto } from './docs/dto/health-response.dto.js';
import { SKIP_ALL_THROTTLERS } from './throttler/throttler.constants.js';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Root service information' })
  @ApiOkResponse({ type: String, example: 'Hello World!' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  @SkipThrottle(SKIP_ALL_THROTTLERS)
  @ApiOperation({ summary: 'Liveness probe (not rate-limited)' })
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
