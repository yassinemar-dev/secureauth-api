import { ApiProperty } from '@nestjs/swagger';

// Values are obviously fake; no real token is ever placed in the spec.
export class LoginResponseDto {
  @ApiProperty({ example: 'fake.access.token.do.not.use' })
  accessToken!: string;

  @ApiProperty({ example: 'fake.refresh.token.do.not.use.1234567890' })
  refreshToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ example: 900, description: 'Access-token lifetime in seconds' })
  expiresIn!: number;
}
