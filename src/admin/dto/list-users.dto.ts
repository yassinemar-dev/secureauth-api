import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListUsersDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '00000000-0000-4000-8000-000000000000',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
