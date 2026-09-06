import type { AuthStatus } from "./types/auth";

/**
 * What the account is allowed to do, as the API reports it from
 * `GET /api/v1/me/entitlements`. Mirrors `entitlementsSchema` in `@kaipu/domain`
 * on the wire (dates arrive as ISO strings). Pure type + rules — safe for main
 * and renderer.
 *
 * `plan` is a name for display. Permissions are read from `features`, never by
 * comparing `plan` — that is what keeps a future tier or metered feature from
 * touching every call site.
 */
export interface Entitlements {
  plan: "free" | "pro";
  status: "active" | "canceled" | "past_due";
  /** ISO timestamp, or null when the grant does not lapse on its own. */
  currentPeriodEnd: string | null;
  features: {
    watermarkRemoval: boolean;
  };
}

/** The account before anyone paid — and what an unreachable server falls back to on first run. */
export const FREE_ENTITLEMENTS: Entitlements = {
  plan: "free",
  status: "active",
  currentPeriodEnd: null,
  features: { watermarkRemoval: false },
};

/** The entitlements a status carries, if any: signed-in always, `unknown` when cached, signed-out never. */
export function entitlementsFromStatus(status: AuthStatus): Entitlements | null {
  if (status.kind === "signed-out") return null;
  return status.entitlements ?? null;
}

/**
 * Whether to skip burning the watermark. Reads the server-derived feature, with
 * one local check on top: a cached period end that has already passed revokes it,
 * so an offline app cannot ride a stale `true` past the day the plan lapsed.
 */
export function isWatermarkRemovalGranted(status: AuthStatus, now: Date): boolean {
  const entitlements = entitlementsFromStatus(status);
  if (!entitlements?.features.watermarkRemoval) return false;
  if (entitlements.currentPeriodEnd === null) return true;
  return Date.parse(entitlements.currentPeriodEnd) > now.getTime();
}
