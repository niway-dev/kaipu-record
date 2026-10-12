import { resolve, sep } from "node:path";

/**
 * Identifiers that reach the filesystem (recording ids, screenshot ids, session
 * ids, slide asset ids) are used as file NAMES inside the vault. The rule here is
 * the single definition of "safe to use as a file name": it is shared by the
 * `kaipu-media://` protocol handler and every IPC handler that takes an id.
 *
 * An id is accepted when it starts with a letter or digit (so no hidden files and
 * no `.kaipu`), then contains only letters, digits, spaces and `_ - . ( )`.
 * Unicode letters are allowed because vault ids are the real file names and
 * hand-imported clips carry them. Separators, `..`, NUL and control characters
 * can never match.
 */
const SAFE_ID = /^[\p{L}\p{N}][\p{L}\p{N} _.()-]*$/u;
const MAX_ID_LENGTH = 200;

export function isSafeId(id: unknown): id is string {
  return (
    typeof id === "string" && id.length <= MAX_ID_LENGTH && !id.includes("..") && SAFE_ID.test(id)
  );
}

export function assertSafeId(id: unknown, label = "id"): asserts id is string {
  if (!isSafeId(id)) throw new Error(`Invalid ${label}`);
}

/** True when `target` is `root` itself or lies inside it (after resolving `..`). */
export function isInside(root: string, target: string): boolean {
  const base = resolve(root);
  const full = resolve(target);
  return full === base || full.startsWith(base.endsWith(sep) ? base : base + sep);
}

/**
 * Resolve `segments` under `root` and refuse anything that escapes it. Use this
 * for every path built from an id: validating the id is the first line of
 * defence, this containment check is the second.
 */
export function resolveInside(root: string, ...segments: string[]): string {
  const full = resolve(root, ...segments);
  const base = resolve(root);
  if (full === base || !isInside(base, full)) throw new Error("Path escapes its directory");
  return full;
}
