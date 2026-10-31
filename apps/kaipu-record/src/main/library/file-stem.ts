/**
 * From a free-text title to a file stem every common file system accepts (NIW2-560,
 * ADR 0035). The title stays in the sidecar exactly as typed; the stem is a projection.
 *
 * Budget: a 255-byte name component minus the longest companion suffix
 * (`.assets/<uuid>.png`, or an atomic write's `.json.<pid>.<uuid>.tmp`, ~53 bytes) leaves
 * ~202; 180 keeps room for a ` (99)` collision tail. A vault at the default location on
 * Windows stays under MAX_PATH with it.
 */
export const STEM_MAX_CODE_POINTS = 100;
export const STEM_MAX_UTF8_BYTES = 180;

/** `< > : " / \ | ?  *`, C0 controls and DEL. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Stem tails that would make a stem's sidecar another stem's companion: `Demo.edit` +
 * `.json` is `Demo`'s edit session, `Demo.cursor` + `.json` its cursor track,
 * `Demo.edit.meta` + `.json` its session metadata. Longest first.
 */
const COMPANION_TAILS = [".edit.meta", ".edit", ".cursor"];
/** `.kaipu/<name>.json` files the vault itself owns (the tag registry). */
const VAULT_OWNED = new Set(["tags"]);

/**
 * The comparison key a case-insensitive filesystem may use for a name: compatibility
 * characters folded (`ſ` → `s`, fullwidth → ASCII), then case folded lower → upper → lower
 * (`ı` and `I` both reach `i`; `ß` and `ẞ` both reach `ss`). Stricter than APFS or NTFS on purpose: a false "same name" only
 * costs a ` (2)`, a missed one merges two items.
 */
export function fsFold(value: string): string {
  // lower → upper → lower: `ẞ` lowers to `ß`, which uppers to `SS`, so both reach `ss`
  // (upper first would leave `ẞ` as `ß`). Idempotent: fsFold(fsFold(x)) === fsFold(x).
  return value.normalize("NFKC").toLowerCase().toUpperCase().toLowerCase().normalize("NFKC");
}

/** The companion tail `stem` ends with, under `fsFold`, if any. */
function companionTail(stem: string): string | undefined {
  return COMPANION_TAILS.find((tail) => fsFold(stem.slice(-tail.length)) === tail);
}

/**
 * True when `stem` must never name an item: its companion paths would overlap another
 * stem's (`*.edit`, `*.cursor`, `*.edit.meta`) or a file the vault owns (`tags`), under
 * any case or compatibility fold a filesystem may apply (`tagſ` aliases `tags`).
 */
export function isReservedStem(stem: string): boolean {
  return VAULT_OWNED.has(fsFold(stem)) || companionTail(stem) !== undefined;
}

/** `Demo.edit` → `Demo edit`, `tags` → `Kaipu tags`: the nearest stem that is not reserved. */
function unreserve(stem: string): string {
  if (VAULT_OWNED.has(fsFold(stem))) return `Kaipu ${stem}`;
  const tail = companionTail(stem);
  if (!tail) return stem;
  const dot = stem.length - tail.length + tail.lastIndexOf(".");
  return `${stem.slice(0, dot)} ${stem.slice(dot + 1)}`;
}

function trimEdges(value: string): string {
  return value.replace(/^[\s.]+|[\s.]+$/g, "");
}

/** Windows device names (`CON`, `nul`, `com1`, `Con.v2` …), checked before the first dot. */
export function isReservedWindowsName(stem: string): boolean {
  return RESERVED.test(stem.split(".")[0]!.trim());
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** The longest prefix of `value` within both caps, never splitting a surrogate pair. */
function capLength(value: string): string {
  const points = Array.from(value).slice(0, STEM_MAX_CODE_POINTS);
  while (points.length > 0 && utf8Length(points.join("")) > STEM_MAX_UTF8_BYTES) points.pop();
  return points.join("");
}

/**
 * The file stem a title projects to, or null when nothing printable survives (the caller
 * falls back to the default capture name). The result never contains a path separator or
 * `..`, never starts with a dot, never ends with a dot or a space, and is never a reserved
 * stem (`isReservedStem`).
 */
export function fileStemFromTitle(title: string): string | null {
  // NFKC, not just NFC: a compatibility character (`ſ`, fullwidth letters, `‥`) is an
  // alias of plain ASCII on case-insensitive filesystems, so the file name never holds
  // one — and fullwidth `／` or `：` become the forbidden ASCII they stand for.
  let stem = title.normalize("NFKC").replace(FORBIDDEN, " ").replace(/\s+/g, " ");
  stem = trimEdges(stem.replace(/\.{2,}/g, "."));
  if (isReservedWindowsName(stem)) stem = `Kaipu ${stem}`;
  stem = trimEdges(capLength(stem));
  // After the cap, which could cut a stem down to a reserved tail.
  stem = trimEdges(unreserve(stem));
  return stem.length > 0 ? stem : null;
}
