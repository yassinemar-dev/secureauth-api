import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [UsersModule, AuthModule],
  controllers: [AdminController],
  providers: [JwtAuthGuard, RolesGuard],
})
export class AdminModule {}
