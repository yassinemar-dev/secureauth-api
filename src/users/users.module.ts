import { Module } from '@nestjs/common';
import { PasswordModule } from '../password/password.module.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [PasswordModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
