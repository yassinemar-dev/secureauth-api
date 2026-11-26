import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('GET /health', () => {
    it('returns { status: "ok" }', () => {
      expect(appController.getHealth()).toEqual({ status: 'ok' });
    });
  });

  it('exposes the service greeting', () => {
    expect(appController.getHello()).toBe(
      'Hello World!',
    );
  });
});
