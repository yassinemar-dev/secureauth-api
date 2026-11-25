import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

export const ARGON2ID_PARAMS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const HASH_PARAMS = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2ID_PARAMS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed stored hash is a failed verification, not a crash.
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    const match = HASH_PARAMS.exec(hash);
    if (!match) {
      return true;
    }

    const [, memoryCost, timeCost, parallelism] = match;
    return (
      Number(memoryCost) !== ARGON2ID_PARAMS.memoryCost ||
      Number(timeCost) !== ARGON2ID_PARAMS.timeCost ||
      Number(parallelism) !== ARGON2ID_PARAMS.parallelism
    );
  }
}
