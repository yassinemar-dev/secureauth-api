import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    format: 'email',
    maxLength: 254,
    example: 'user@example.com',
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    format: 'password',
    minLength: 12,
    maxLength: 128,
    example: 'example-password-123',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
