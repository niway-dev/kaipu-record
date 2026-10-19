/** Better Auth's default minimum, mirrored so the form answers before a round trip. */
export const MIN_PASSWORD = 8;
export const MIN_NAME = 2;

/** A shape check only; the server is the authority on what an email is. */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
