import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from '../config/env.validation.js';
import { PasswordModule } from '../password/password.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { UsersModule } from '../users/users.module.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    PasswordModule,
    UsersModule,
  ],
  providers: [RefreshTokenService, AdminBootstrapService],
})
export class AdminCliModule {}
