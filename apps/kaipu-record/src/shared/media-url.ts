/**
 * The one place `kaipu-media://` URLs are built and read (NIW2-560). A vault id is a file
 * name derived from a title, so it can hold `#`, `?`, `%` or spaces: every id is
 * percent-encoded on the way in and decoded exactly once on the way out.
 *
 * Shared by main and the renderer; no value imports from workspace packages (this
 * directory is reachable from the preload bundle, see CLAUDE.md).
 */
export const MEDIA_SCHEME = "kaipu-media";

export type MediaKind = "recording" | "screenshot" | "thumb";

/** `kaipu-media://<kind>/<encoded id>[?v=<version>]`. */
export function mediaUrl(kind: MediaKind, id: string, version?: number): string {
  const base = `${MEDIA_SCHEME}://${kind}/${encodeURIComponent(id)}`;
  return version === undefined ? base : `${base}?v=${version}`;
}

/**
 * The kind and id a media URL addresses, or null when it cannot be read: not this scheme,
 * a malformed percent escape, or an id that is empty or reaches outside the vault (a
 * separator or `..` after decoding — `%2F` included).
 */
export function parseMediaUrl(url: string): { kind: string; id: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null;
  let id: string;
  try {
    id = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  if (id.length === 0 || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return { kind: parsed.hostname, id };
}
