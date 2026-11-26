import { vi } from 'vitest';
import { printPurgeCount } from './tokens-purge.js';

describe('tokens:purge', () => {
  it('prints only the number of deleted rows', async () => {
    const tokens = { purgeExpired: vi.fn().mockResolvedValue(7) };
    const print = vi.fn();

    await printPurgeCount(tokens, print);

    expect(tokens.purgeExpired).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('propagates a purge failure so the CLI can exit non-zero', async () => {
    const tokens = { purgeExpired: vi.fn().mockRejectedValue(new Error('db down')) };
    const print = vi.fn();

    await expect(printPurgeCount(tokens, print)).rejects.toThrow('db down');
    expect(print).not.toHaveBeenCalled();
  });
});
