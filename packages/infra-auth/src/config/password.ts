import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for Better Auth's `emailAndPassword.password` hooks.
 *
 * Stored format is `hexSalt:hexKey` (16-byte salt, 64-byte key, Node's default scrypt
 * cost). It predates this module and must not change: every stored hash keeps verifying.
 * Kept apart from base-config.ts so it can be unit-tested without a database client.
 */

const SALT_BYTES = 16;
const KEY_BYTES = 64;

const scryptAsync = (password: string, salt: string, keylen: number): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key))),
  );

/** Async scrypt: hashing a password does not block the isolate. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const hash = await scryptAsync(password, salt, KEY_BYTES);
  return `${salt}:${hash.toString("hex")}`;
}

/**
 * Constant-time compare (audit F-10). A malformed stored value never throws: it is simply
 * not a match.
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;

  const keyBuffer = Buffer.from(key, "hex");
  const hashBuffer = await scryptAsync(password, salt, KEY_BYTES);
  if (keyBuffer.length !== hashBuffer.length) return false;
  return timingSafeEqual(keyBuffer, hashBuffer);
}
