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
});
