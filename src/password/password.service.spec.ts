import argon2 from 'argon2';
import { PasswordService, ARGON2ID_PARAMS } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces an argon2id hash that differs from the plain password', async () => {
    const plain = 'CorrectHorseBatteryStaple';
    const hash = await service.hash(plain);

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toBe(plain);
  });

  it('uses a fresh salt so two hashes of the same password differ', async () => {
    const [first, second] = await Promise.all([
      service.hash('same-password'),
      service.hash('same-password'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies a correct password and rejects an incorrect one', async () => {
    const hash = await service.hash('correct-password');

    await expect(service.verify(hash, 'correct-password')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });

  it('recognizes current parameters and detects stale ones', async () => {
    const current = await service.hash('password');
    const weaker = await argon2.hash('password', {
      ...ARGON2ID_PARAMS,
      memoryCost: 32768,
      timeCost: 2,
    });

    expect(service.needsRehash(current)).toBe(false);
    expect(service.needsRehash(weaker)).toBe(true);
    expect(service.needsRehash('not-a-hash')).toBe(true);
  });
});
