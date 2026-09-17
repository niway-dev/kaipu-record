/**
 * Pure link builders — kept free of `../env` (which imports `cloudflare:workers`)
 * so they can be unit-tested under plain Vitest without a Workers polyfill.
 */
export function buildVerifyUrl(web: string, token: string): string {
  const base = web.replace(/\/$/, "");
  const callback = encodeURIComponent(`${base}/auth/email-verified`);
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${callback}`;
}

export function buildResetUrl(web: string, token: string): string {
  return `${web.replace(/\/$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}`;
}
