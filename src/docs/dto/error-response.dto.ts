import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Mirrors Nest's standard HTTP error body; no internal details are documented.
export class ErrorResponseDto {
  @ApiProperty({ example: 400, description: 'HTTP status code' })
  statusCode!: number;

  @ApiProperty({
    description: 'Nest error message(s)',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Bad Request',
  })
  message!: string | string[];

  @ApiPropertyOptional({
    description: 'HTTP reason phrase, when provided by Nest',
    example: 'Bad Request',
  })
  error?: string;
}
