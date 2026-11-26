import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PasswordService } from '../password/password.service.js';
import { UsersService, type SafeUser } from '../users/users.service.js';
import type { JwtPayload, LoginResponse } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { JWT_AUDIENCE, JWT_ISSUER } from './jwt-claims.js';
import { RegisterDto } from './dto/register.dto.js';
import {
  INVALID_REFRESH_TOKEN,
  RefreshTokenService,
} from './refresh-token.service.js';
import { ttlToSeconds } from './ttl.js';

const DUMMY_HASH_PASSWORD = 'timing-equalizer-not-a-user-password';

@Injectable()
export class AuthService {
  private readonly dummyHash: Promise<string>;
  private readonly expiresIn: number;

  constructor(
    private readonly users: UsersService,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    config: ConfigService,
  ) {
    this.expiresIn = ttlToSeconds(config.getOrThrow<string>('JWT_ACCESS_TTL'));
    this.dummyHash = this.password.hash(DUMMY_HASH_PASSWORD);
  }

  private async signAccessToken(user: SafeUser): Promise<string> {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    return this.jwt.signAsync(payload, {
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  register(dto: RegisterDto): Promise<SafeUser> {
    return this.users.create({ email: dto.email, password: dto.password });
  }

  async login(dto: LoginDto): Promise<LoginResponse> {
    const user = await this.users.findByEmailWithHash(dto.email);
    const storedHash = user?.passwordHash ?? (await this.dummyHash);
    const passwordMatches = await this.password.verify(storedHash, dto.password);

    // Missing users still pay for one verify so the response time is similar.
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (this.password.needsRehash(user.passwordHash)) {
      const rehashed = await this.password.hash(dto.password);
      await this.users.updatePasswordHash(user.id, rehashed);
    }

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: await this.refreshTokens.issue(user.id),
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
    };
  }

  async refresh(rawToken: string): Promise<LoginResponse> {
    const rotated = await this.refreshTokens.rotate(rawToken);
    // Reload the user so the access token carries the current DB role.
    const user = await this.users.findById(rotated.userId);
    if (!user) {
      await this.refreshTokens.revokeAllForUser(rotated.userId);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken: rotated.token,
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
    };
  }

  async logout(rawToken: string): Promise<void> {
    await this.refreshTokens.revokeFamily(rawToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }

  async me(id: string): Promise<SafeUser> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }
    return user;
  }
}
