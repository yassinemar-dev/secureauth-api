import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseExceptionFilter } from '@nestjs/core';

const REDACT_WORDS =
  'password|passwd|token|secret|authorization|database_url|connectionstring';

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    // HttpExceptions (and all non-production detail) keep Nest's default behaviour.
    // Read the live environment: ConfigModule caches values at import time.
    const nodeEnv =
      process.env.NODE_ENV ?? this.config.get<string>('NODE_ENV') ?? 'development';
    if (exception instanceof HttpException || nodeEnv !== 'production') {
      super.catch(exception, host);
      return;
    }

    const response = host
      .switchToHttp()
      .getResponse<{ status(code: number): { json(body: unknown): void } }>();
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
    this.logger.error(this.sanitisedSummary(exception));
  }

  private sanitisedSummary(exception: unknown): string {
    const name =
      exception instanceof Error ? exception.constructor.name : 'UnknownError';
    const message =
      exception instanceof Error ? exception.message : 'non-error thrown value';
    const firstLine = message.split('\n', 1)[0] ?? '';
    const cleaned = firstLine
      // Query text and bind parameters are never useful in a production log line.
      .replace(
        /\b(select|insert|update|delete|from|where|values|drop|alter)\b[\s\S]*$/i,
        '<sql redacted>',
      )
      .replace(
        new RegExp(`\\b(${REDACT_WORDS})\\b\\s*[=:]\\s*\\S+`, 'gi'),
        '$1=<redacted>',
      )
      .replace(new RegExp(`\\b(${REDACT_WORDS})\\b`, 'gi'), '<redacted>');
    return `${name}: ${cleaned.slice(0, 120)}`;
  }
}
