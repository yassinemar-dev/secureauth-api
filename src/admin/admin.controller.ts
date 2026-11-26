import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../docs/api-responses.js';
import { SafeUserDto } from '../docs/dto/safe-user.dto.js';
import { UserPageDto } from '../docs/dto/user-page.dto.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { Role } from '../generated/prisma/client.js';
import {
  UsersService,
  type SafeUser,
  type UserPage,
} from '../users/users.service.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';

@ApiTags('Admin')
@ApiBearerAuth('bearer')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  @Get('users')
  @ApiOperation({ summary: 'List users with keyset pagination (admin only)' })
  @ApiOkResponse({ type: UserPageDto })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  list(@Query() query: ListUsersDto): Promise<UserPage> {
    return this.users.list({ limit: query.limit ?? 20, cursor: query.cursor });
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Change a user role (admin only)' })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    example: '00000000-0000-4000-8000-000000000000',
    description: 'Target user id',
  })
  @ApiOkResponse({ type: SafeUserDto })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
    HttpStatus.CONFLICT,
    HttpStatus.TOO_MANY_REQUESTS,
  )
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
