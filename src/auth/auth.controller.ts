import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../docs/api-responses.js';
import { LoginResponseDto } from '../docs/dto/login-response.dto.js';
import { SafeUserDto } from '../docs/dto/safe-user.dto.js';
import type { AuthenticatedUser, LoginResponse } from './auth.types.js';
import type { SafeUser } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new account' })
  @ApiCreatedResponse({
    type: SafeUserDto,
    description: 'Account created; the password hash is never returned',
  })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.CONFLICT,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  register(@Body() dto: RegisterDto): Promise<SafeUser> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token and issue a new access token' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiErrorResponses(
    HttpStatus.BAD_REQUEST,
    HttpStatus.UNAUTHORIZED,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  refresh(@Body() dto: RefreshTokenDto): Promise<LoginResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the refresh-token family (idempotent)' })
  @ApiNoContentResponse({ description: 'Family revoked, or token unknown' })
  @ApiErrorResponses(HttpStatus.BAD_REQUEST, HttpStatus.TOO_MANY_REQUESTS)
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Revoke every refresh session for the current user' })
  @ApiBearerAuth('bearer')
  @ApiNoContentResponse({ description: 'All sessions revoked' })
  @ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  logoutAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.auth.logoutAll(user.id);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Return the current user profile' })
  @ApiBearerAuth('bearer')
  @ApiOkResponse({ type: SafeUserDto })
  @ApiErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  me(@CurrentUser() user: AuthenticatedUser): Promise<SafeUser> {
    return this.auth.me(user.id);
  }
}
