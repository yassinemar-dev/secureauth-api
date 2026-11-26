export const THROTTLER_NAMES = {
  default: 'default',
  loginIp: 'login-ip',
  loginEmail: 'login-email',
  registerIp: 'register-ip',
  refreshIp: 'refresh-ip',
} as const;

export const SKIP_ALL_THROTTLERS: Record<string, boolean> = Object.fromEntries(
  Object.values(THROTTLER_NAMES).map((name) => [name, true]),
);
