import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({
    minLength: 20,
    maxLength: 512,
    example: 'fake.refresh.token.do.not.use.1234567890',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  refreshToken!: string;
}
