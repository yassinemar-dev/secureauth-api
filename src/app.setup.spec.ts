import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { configureApp } from './app.setup.js';

type CorsOptions = {
  origin: string[] | false;
  methods: string[];
  allowedHeaders: string[];
  credentials: boolean;
};

function makeApp(values: Record<string, string>) {
  const use = vi.fn();
  const disable = vi.fn();
  const set = vi.fn();
  const enableCors = vi.fn();
  const app = {
    get: () => new ConfigService(values),
    getHttpAdapter: () => ({ getInstance: () => ({ disable, set }) }),
    use,
    enableCors,
  } as unknown as INestApplication;
  return { app, use, disable, set, enableCors };
}

describe('configureApp', () => {
  it('applies helmet, body limits, exact CORS and a disabled trust proxy', () => {
    const { app, use, disable, set, enableCors } = makeApp({
      CORS_ORIGINS: 'https://app.example.com',
      TRUST_PROXY: 'false',
    });

    configureApp(app);

    expect(use).toHaveBeenCalledTimes(3);
    expect(disable).toHaveBeenCalledWith('x-powered-by');
    expect(set).toHaveBeenCalledWith('trust proxy', false);
    expect(enableCors).toHaveBeenCalledWith({
      origin: ['https://app.example.com'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: false,
    } satisfies CorsOptions);
  });

  it('parses multiple origins and a numeric proxy hop count', () => {
    const { app, enableCors, set } = makeApp({
      CORS_ORIGINS: 'https://one.example.com, https://two.example.com',
      TRUST_PROXY: '2',
    });

    configureApp(app);

    expect(enableCors).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: ['https://one.example.com', 'https://two.example.com'],
      }),
    );
    expect(set).toHaveBeenCalledWith('trust proxy', 2);
  });

  it('defaults to no cross-origin requests and no trusted proxy', () => {
    const { app, enableCors, set } = makeApp({
      CORS_ORIGINS: '',
      TRUST_PROXY: 'false',
    });

    configureApp(app);

    expect(enableCors).toHaveBeenCalledWith(
      expect.objectContaining({ origin: false }),
    );
    expect(set).toHaveBeenCalledWith('trust proxy', false);
  });
});
