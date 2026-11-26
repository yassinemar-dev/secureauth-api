import { ttlToSeconds } from './ttl.js';

describe('ttlToSeconds', () => {
  it.each([
    ['15s', 15],
    ['15m', 900],
    ['2h', 7200],
    ['7d', 604_800],
  ])('converts %s to %i seconds', (ttl, expected) => {
    expect(ttlToSeconds(ttl)).toBe(expected);
  });

  it('rejects malformed values', () => {
    expect(() => ttlToSeconds('15')).toThrow('Invalid JWT_ACCESS_TTL');
  });
});
