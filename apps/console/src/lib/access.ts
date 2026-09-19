/** Identity is an immutable user ID, not a client field or an email address. */
export function isConsoleAdmin(userId: string | undefined, allowlist: string): boolean {
  return (
    !!userId &&
    allowlist
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(userId)
  );
}
