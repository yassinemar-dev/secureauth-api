import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { AuthService } from './auth/auth.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { UsersService } from './users/users.service.js';

describe('AppModule', () => {
  it('wires the application graph without connecting to a database', async () => {
    // No database: PrismaService is replaced before any connection is made.
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(module.get(UsersService)).toBeInstanceOf(UsersService);
    expect(module.get(AuthService)).toBeInstanceOf(AuthService);
    await module.close();
  });
});
