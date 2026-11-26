import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  it('connects on module init and disconnects on module destroy', async () => {
    // Bypass the generated client constructor: no driver, no database.
    const prisma = Object.create(PrismaService.prototype) as PrismaService;
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn().mockResolvedValue(undefined);
    prisma.$connect = connect;
    prisma.$disconnect = disconnect;

    const module: TestingModule = await Test.createTestingModule({
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();

    const service = module.get(PrismaService);
    await service.onModuleInit();
    expect(connect).toHaveBeenCalledOnce();

    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('builds a pg adapter from DATABASE_URL without connecting', async () => {
    const config = new ConfigService({
      DATABASE_URL: 'postgresql://test_user:test_password@localhost:5432/secureauth_test',
    });

    // Constructing the client is safe; queries and $connect need a real database.
    const prisma = new PrismaService(config);
    const connect = vi.spyOn(prisma, '$connect').mockResolvedValue();
    const disconnect = vi.spyOn(prisma, '$disconnect').mockResolvedValue();

    await prisma.onModuleInit();
    await prisma.onModuleDestroy();

    expect(connect).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
