const TTL_TO_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) {
    throw new Error('Invalid JWT_ACCESS_TTL');
  }
  const [, amount, unit] = match;
  return Number(amount) * TTL_TO_SECONDS[unit as keyof typeof TTL_TO_SECONDS];
}
