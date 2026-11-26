import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ArgumentsHost } from '@nestjs/common';
import { afterEach, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

describe('AllExceptionsFilter', () => {
  const config = { get: vi.fn() } as unknown as ConfigService;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  function hostWithResponse() {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    return { host, json, status };
  }

  it('returns a generic 500 and a sanitised log line in production', () => {
    process.env.NODE_ENV = 'production';
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host, json, status } = hostWithResponse();

    new AllExceptionsFilter(config).catch(
      new Error("SELECT * FROM users WHERE password = 'hunter2'"),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    });
    const logged = String(errorSpy.mock.calls[0]?.[0]);
    expect(logged).toContain('Error:');
    expect(logged).not.toContain('SELECT');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toMatch(/\n\s+at /);
  });

  it('redacts secret-looking assignments without leaking their values', () => {
    process.env.NODE_ENV = 'production';
    const errorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host } = hostWithResponse();

    new AllExceptionsFilter(config).catch(
      new Error('DATABASE_URL=postgres://user:secret@db failed'),
      host,
    );

    const logged = String(errorSpy.mock.calls[0]?.[0]);
    expect(logged).not.toContain('postgres://');
    expect(logged).not.toContain('secret');
  });
});
