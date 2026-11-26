import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role, type User } from '../generated/prisma/client.js';
import { PasswordService } from '../password/password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type SafeUser = Omit<User, 'passwordHash'>;

export interface CreateUserInput {
  email: string;
  password: string;
}

export interface ListUsersInput {
  limit?: number;
  cursor?: string;
}

export interface UserPage {
  items: SafeUser[];
  nextCursor: string | null;
}

export type RoleUpdateResult =
  | { status: 'updated'; user: SafeUser }
  | { status: 'not-found' }
  | { status: 'last-admin' };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
  ) {}

  async create({ email, password }: CreateUserInput): Promise<SafeUser> {
    const passwordHash = await this.password.hash(password);

    try {
      return await this.prisma.user.create({
        data: {
          email: normalizeEmail(email),
          passwordHash,
          role: Role.USER,
        },
        omit: { passwordHash: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Keep the message generic: the email is already known to the caller.
        throw new ConflictException('Unable to create user');
      }
      throw error;
    }
  }

  findById(id: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      omit: { passwordHash: true },
    });
  }

  findByEmail(email: string): Promise<SafeUser | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      omit: { passwordHash: true },
    });
  }

  // Only the auth module should use this: it returns the password hash.
  findByEmailWithHash(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  updatePasswordHash(id: string, passwordHash: string): Promise<SafeUser> {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash },
      omit: { passwordHash: true },
    });
  }

  async list({ limit = 20, cursor }: ListUsersInput): Promise<UserPage> {
    const rows = await this.prisma.user.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      omit: { passwordHash: true },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  updateRole(id: string, role: Role): Promise<SafeUser> {
    return this.prisma.user.update({
      where: { id },
      data: { role },
      omit: { passwordHash: true },
    });
  }

  countByRole(role: Role): Promise<number> {
    return this.prisma.user.count({ where: { role } });
  }

  private isSerializationFailure(error: unknown): boolean {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    ) {
      return true;
    }
    // With a driver adapter (pg), Serializable conflicts surface as a
    // DriverAdapterError rather than Prisma's P2034.
    const adapterError = error as {
      name?: string;
      cause?: { kind?: string };
    } | null;
    return (
      adapterError?.name === 'DriverAdapterError' &&
      adapterError.cause?.kind === 'TransactionWriteConflict'
    );
  }

  // Count and update share one Serializable transaction so the last-admin
  // decision is made against a committed snapshot. P2034 is retried; if it
  // persists, callers get a distinct 409 so it is not confused with a real
  // last-admin conflict.
  async updateRoleWithLastAdminGuard(
    id: string,
    role: Role,
  ): Promise<RoleUpdateResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const target = await tx.user.findUnique({
              where: { id },
              select: { role: true },
            });
            if (!target) {
              return { status: 'not-found' } as const;
            }

            if (target.role === Role.ADMIN && role !== Role.ADMIN) {
              const admins = await tx.user.count({
                where: { role: Role.ADMIN },
              });
              if (admins <= 1) {
                return { status: 'last-admin' } as const;
              }
            }

            const user = await tx.user.update({
              where: { id },
              data: { role },
              omit: { passwordHash: true },
            });
            return { status: 'updated', user } as const;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!this.isSerializationFailure(error)) {
          throw error;
        }
        if (attempt < 3) {
          continue;
        }
        throw new ConflictException('Concurrent update, please retry');
      }
    }

    throw new ConflictException('Concurrent update, please retry');
  }
}
