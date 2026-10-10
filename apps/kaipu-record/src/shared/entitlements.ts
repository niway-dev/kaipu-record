import type { PlanId } from "@kaipu/domain/constants";
import type { AuthStatus } from "./types/auth";

/**
 * What the account is allowed to do, as the API reports it from
 * `GET /api/v1/me/entitlements`. Mirrors `entitlementsSchema` in `@kaipu/domain`
 * on the wire (dates arrive as ISO strings), once the server emits the cloud
 * fields; missing fields are defaulted in auth-client. Pure type + rules — safe
 * for main and renderer.
 *
 * `plan` is a name for display. Permissions are read from `features`, never by
 * comparing `plan` — that is what keeps a future tier or metered feature from
 * touching every call site.
 */
export interface Entitlements {
  plan: PlanId;
  status: "active" | "canceled" | "past_due";
  /** ISO timestamp, or null when the grant does not lapse on its own. */
  currentPeriodEnd: string | null;
  features: {
    /**
     * Legacy: the desktop no longer gates anything on it — the free app ships
     * without a watermark (backlog/free-tier-no-watermark). Still on the wire
     * until the server drops it.
     */
    watermarkRemoval: boolean;
    /** Whether the account can upload recordings to cloud storage. */
    cloudUploads: boolean;
    /** The account's cloud storage quota, in bytes. */
    cloudStorageBytes: number;
  };
}

/**
 * The account before anyone paid — and what an unreachable server falls back to on first run.
 * `cloudStorageBytes` is a LITERAL copy of `PLANS.free.cloudStorageBytes` (250 MB): this file is
 * reachable from the preload bundle, which cannot take value imports from workspace packages
 * (CLAUDE.md). entitlements.test.ts pins it to the domain plan table.
 */
export const FREE_ENTITLEMENTS: Entitlements = {
  plan: "free",
  status: "active",
  currentPeriodEnd: null,
  features: { watermarkRemoval: false, cloudUploads: false, cloudStorageBytes: 250_000_000 },
};

/** The entitlements a status carries, if any: signed-in always, `unknown` when cached, signed-out never. */
export function entitlementsFromStatus(status: AuthStatus): Entitlements | null {
  if (status.kind === "signed-out") return null;
  return status.entitlements ?? null;
}
