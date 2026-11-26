import { ApiProperty } from '@nestjs/swagger';
import { SafeUserDto } from './safe-user.dto.js';

export class UserPageDto {
  @ApiProperty({ type: [SafeUserDto] })
  items!: SafeUserDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    example: '00000000-0000-4000-8000-000000000000',
  })
  nextCursor!: string | null;
}
