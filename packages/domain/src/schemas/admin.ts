import { z } from "zod";
import { entitlementsSchema } from "./subscription";

/**
 * What GET /me/entitlements answers: the account's entitlements plus who it is and
 * whether it may use the desktop's Admin mode (ADR 0067). Kept apart from
 * `entitlementsSchema`, which `getEntitlements` and storage also use.
 */
export const meEntitlementsSchema = entitlementsSchema.extend({
  userId: z.string(),
  admin: z.boolean(),
});
export type MeEntitlements = z.infer<typeof meEntitlementsSchema>;

// --- Pure rules (no I/O) ---------------------------------------------------

/** Parses the comma-separated `ADMIN_USER_IDS` value: trims, drops empties. Missing means nobody. */
export function parseAdminUserIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** True only when `userId` is in the allowlist. An empty id or an empty list never matches. */
export function isAdminUser(userId: string, raw: string | undefined): boolean {
  return userId !== "" && parseAdminUserIds(raw).includes(userId);
}
