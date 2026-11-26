import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../../generated/prisma/client.js';
import type { AuthenticatedUser, JwtPayload } from '../auth.types.js';

const BEARER_HEADER = /^Bearer ([^\s]+)$/;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string }; user?: AuthenticatedUser }>();

    const match = BEARER_HEADER.exec(request.headers.authorization ?? '');
    if (!match) {
      throw new UnauthorizedException('Unauthorized');
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(match[1], {
        algorithms: ['HS256'],
      });
      if (!payload.sub || !Object.values(Role).includes(payload.role)) {
        throw new UnauthorizedException('Unauthorized');
      }

      request.user = { id: payload.sub, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException('Unauthorized');
    }
  }
}
