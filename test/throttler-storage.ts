import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

type ThrottlerStorageState = {
  _storage?: Map<unknown, unknown>;
  hitExpirations?: Map<unknown, unknown>;
};

// Each Nest app owns its storage; this returns a reset function for test isolation.
export function createThrottlerResetter(app: INestApplication): () => void {
  const storage = app.get<ThrottlerStorageService>(ThrottlerStorage);
  return () => {
    // The built-in store keeps hit timestamps separately from the visible map.
    const state = storage as unknown as ThrottlerStorageState;
    state._storage?.clear();
    state.hitExpirations?.clear();
  };
}
