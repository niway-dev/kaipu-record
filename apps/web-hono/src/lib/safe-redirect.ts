/**
 * A `redirect` search param is attacker-controlled (anyone can craft a login link), so only
 * same-origin paths are followed: one leading slash, no scheme, no protocol-relative `//host`,
 * and no backslash that some browsers treat as a slash.
 */
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  // Control characters (tab, newline, ...) can smuggle a second slash past the checks above.
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) <= 0x1f) return undefined;
  }
  return value;
}
