import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from './dto/error-response.dto.js';

const DESCRIPTIONS: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Validation failed',
  [HttpStatus.UNAUTHORIZED]: 'Authentication failed',
  [HttpStatus.FORBIDDEN]: 'Not allowed for this account',
  [HttpStatus.NOT_FOUND]: 'Resource not found',
  [HttpStatus.CONFLICT]: 'Conflict with the current state',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Rate limit exceeded',
};

export function ApiErrorResponses(...statuses: HttpStatus[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: DESCRIPTIONS[status] ?? 'Error',
        type: ErrorResponseDto,
        ...(status === HttpStatus.TOO_MANY_REQUESTS
          ? {
              headers: {
                'Retry-After': {
                  description: 'Seconds until the rate-limit window resets',
                  schema: { type: 'integer' },
                },
              },
            }
          : {}),
      }),
    ),
  );
}
