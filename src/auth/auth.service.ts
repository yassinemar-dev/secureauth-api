import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PasswordService } from '../password/password.service.js';
import { UsersService, type SafeUser } from '../users/users.service.js';
import type { JwtPayload, LoginResponse } from './auth.types.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
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
    config: ConfigService,
  ) {
    this.expiresIn = ttlToSeconds(config.getOrThrow<string>('JWT_ACCESS_TTL'));
    this.dummyHash = this.password.hash(DUMMY_HASH_PASSWORD);
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

    const payload: JwtPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      algorithm: 'HS256',
    });

    return { accessToken, tokenType: 'Bearer', expiresIn: this.expiresIn };
  }

  async me(id: string): Promise<SafeUser> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }
    return user;
  }
}
