import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/client.js';
import { UsersService } from '../../users/users.service.js';
import type { AuthenticatedUser } from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Default deny is achieved by decorating protected routes. A route with no
    // @Roles metadata is not an admin route; JwtAuthGuard handles authentication.
    if (!requiredRoles) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new UnauthorizedException('Unauthorized');
    }

    // Never trust the role in the access token: roles can change after issuance.
    const user = await this.users.findById(request.user.id);
    if (!user) {
      throw new UnauthorizedException('Unauthorized');
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Forbidden');
    }

    return true;
  }
}
