import {
  BYTES_PER_GB,
  BYTES_PER_MB,
  MAX_SCREENSHOT_BYTES,
  MAX_VIDEO_BYTES,
  formatDecimalBytes,
} from "./cloud-limits";

/**
 * THE plan table. Every number Kaipu states or enforces about a plan comes from here:
 * the server's `deriveEntitlements`, the desktop Cloud page, the web sign-up promotion and
 * the es/en copy (which interpolates `planCopyValues()` instead of hard-coding sizes).
 * Canonical prose: apps/documentation/src/content/docs/features/plans.md.
 *
 * Decimal bytes only (1 GB = 1,000,000,000) — see cloud-limits.ts.
 */

/** Free (registered + verified email) — the sign-up incentive. Decision NIW2-232 (2026-10-10). */
export const FREE_CLOUD_CAPACITY_BYTES = 250 * BYTES_PER_MB;
/** Pro — spec 2026-09-15-cloud-trial-and-approval, Decision 4 (15 GB, down from the historical 25 GB). */
export const PRO_CLOUD_CAPACITY_BYTES = 15 * BYTES_PER_GB;
/**
 * Owner-approved beta expansion for a Free account (same spec, Decision 1): 1 GB TOTAL, not
 * 1 GB extra. Stated in the copy; NOT enforced yet — the request/approval flow is a separate
 * ticket, so `deriveEntitlements` never returns it today.
 */
export const BETA_EXPANSION_CAPACITY_BYTES = 1 * BYTES_PER_GB;

export const PLAN_IDS = ["free", "pro"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDefinition {
  id: PlanId;
  /** Display name key in the `storageCloud` i18n namespace. */
  nameKey: "planFree" | "planPro";
  /** Total occupied cloud space (media + persisted thumbnails), decimal bytes. */
  cloudStorageBytes: number;
  /** Per-file caps — identical on every plan today. */
  maxVideoBytes: number;
  maxScreenshotBytes: number;
  /** Cloud uploads need a verified email on every plan; unverified accounts get no cloud. */
  requiresVerifiedEmail: true;
}

export const PLANS: Readonly<Record<PlanId, Readonly<PlanDefinition>>> = {
  free: {
    id: "free",
    nameKey: "planFree",
    cloudStorageBytes: FREE_CLOUD_CAPACITY_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
    maxScreenshotBytes: MAX_SCREENSHOT_BYTES,
    requiresVerifiedEmail: true,
  },
  pro: {
    id: "pro",
    nameKey: "planPro",
    cloudStorageBytes: PRO_CLOUD_CAPACITY_BYTES,
    maxVideoBytes: MAX_VIDEO_BYTES,
    maxScreenshotBytes: MAX_SCREENSHOT_BYTES,
    requiresVerifiedEmail: true,
  },
};

/**
 * The ICU values every plan-related message may use (`{freeCapacity}`, `{proCapacity}`,
 * `{expansionCapacity}`, `{perVideo}`, `{perScreenshot}`). Pass the whole object to `t(...)`:
 * extra values are ignored, so call sites never pick numbers themselves.
 */
export function planCopyValues(): {
  freeCapacity: string;
  proCapacity: string;
  expansionCapacity: string;
  perVideo: string;
  perScreenshot: string;
} {
  return {
    freeCapacity: formatDecimalBytes(PLANS.free.cloudStorageBytes),
    proCapacity: formatDecimalBytes(PLANS.pro.cloudStorageBytes),
    expansionCapacity: formatDecimalBytes(BETA_EXPANSION_CAPACITY_BYTES),
    perVideo: formatDecimalBytes(MAX_VIDEO_BYTES),
    perScreenshot: formatDecimalBytes(MAX_SCREENSHOT_BYTES),
  };
}
