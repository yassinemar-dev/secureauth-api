import { Injectable } from '@nestjs/common';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { Role } from '../generated/prisma/client.js';
import {
  normalizeEmail,
  UsersService,
  type SafeUser,
} from '../users/users.service.js';

// Only this error's message is safe to print from the CLI; other errors may
// contain environment or database details.
export class AdminPromoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminPromoteError';
  }
}

@Injectable()
export class AdminBootstrapService {
  constructor(
    private readonly users: UsersService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async promote(email: string): Promise<SafeUser> {
    const normalized = normalizeEmail(email);
    const user = await this.users.findByEmail(normalized);
    if (!user) {
      throw new AdminPromoteError(`No user found for ${normalized}`);
    }

    const promoted = await this.users.updateRole(user.id, Role.ADMIN);
    await this.refreshTokens.revokeAllForUser(user.id);
    return promoted;
  }
}
