import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import {
  UsersService,
  type SafeUser,
  type UserPage,
} from '../users/users.service.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  @Get('users')
  list(@Query() query: ListUsersDto): Promise<UserPage> {
    return this.users.list({ limit: query.limit ?? 20, cursor: query.cursor });
  }

  @Patch('users/:id/role')
  async updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() current: AuthenticatedUser,
  ): Promise<SafeUser> {
    if (id === current.id) {
      throw new ForbiddenException('Forbidden');
    }

    const result = await this.users.updateRoleWithLastAdminGuard(id, dto.role);
    if (result.status === 'not-found') {
      throw new NotFoundException('User not found');
    }
    if (result.status === 'last-admin') {
      throw new ConflictException('Unable to demote the last admin');
    }

    await this.refreshTokens.revokeAllForUser(id);
    return result.user;
  }
}
