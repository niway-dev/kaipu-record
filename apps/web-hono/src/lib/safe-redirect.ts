/**
 * A `redirect` search param is attacker-controlled (anyone can craft a login link), so only
 * same-origin paths are followed: one leading slash, no scheme, no protocol-relative `//host`,
 * and no backslash that some browsers treat as a slash.
 */
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  // Control characters can smuggle a second slash past the checks above.
  if (/[\u0000-\u001f]/.test(value)) return undefined;
  return value;
}
