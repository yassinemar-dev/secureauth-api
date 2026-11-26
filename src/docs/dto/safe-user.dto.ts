import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client.js';

// Intentionally omits passwordHash: it is never returned by any endpoint.
export class SafeUserDto {
  @ApiProperty({
    format: 'uuid',
    example: '00000000-0000-4000-8000-000000000000',
  })
  id!: string;

  @ApiProperty({ format: 'email', example: 'user@example.com' })
  email!: string;

  @ApiProperty({ enum: Role, example: Role.USER })
  role!: Role;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-01T00:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-01T00:00:00.000Z',
  })
  updatedAt!: Date;
}
