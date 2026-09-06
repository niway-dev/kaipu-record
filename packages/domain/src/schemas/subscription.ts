import { z } from "zod";

/**
 * Commercial state, kept apart from identity on purpose: Better Auth owns `user`
 * and `session`; this module owns what the user has paid for. Nothing here is
 * read by the auth layer, and the auth layer is never read by this.
 */

/** The plan is a *name* (shown in Settings). Permissions come from `features`, never from this. */
export const planSchema = z.enum(["free", "pro"]);
export type Plan = z.infer<typeof planSchema>;

export const subscriptionStatusSchema = z.enum(["active", "canceled", "past_due"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/**
 * Who wrote the row. `manual` is a first-class value — an operator granting a
 * plan by hand (comps, testing) — so it coexists with rows a billing provider
 * later syncs, rather than being a hack that gets overwritten.
 */
export const subscriptionProviderSchema = z.enum(["manual", "stripe", "autumn"]);
export type SubscriptionProvider = z.infer<typeof subscriptionProviderSchema>;

export const subscriptionBaseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  plan: planSchema,
  status: subscriptionStatusSchema,
  /** `null` = does not expire (manual grants). A provider fills this and the grant lapses on its own. */
  currentPeriodEnd: z.date().nullable(),
  provider: subscriptionProviderSchema,
  /** The provider's own id (`sub_…`), when there is one. */
  providerRef: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SubscriptionBase = z.infer<typeof subscriptionBaseSchema>;

/**
 * What a client is allowed to do — derived, never stored. `features` is a map so
 * a future metered feature (a balance) is an added key, not a redesign.
 */
export const entitlementsSchema = z.object({
  plan: planSchema,
  status: subscriptionStatusSchema,
  currentPeriodEnd: z.date().nullable(),
  features: z.object({
    watermarkRemoval: z.boolean(),
  }),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

// --- Pure rules (no I/O) ---------------------------------------------------

export const FREE_ENTITLEMENTS: Entitlements = {
  plan: "free",
  status: "active",
  currentPeriodEnd: null,
  features: { watermarkRemoval: false },
};

/** A subscription grants its features only while active and inside its period. */
export function isSubscriptionInForce(sub: SubscriptionBase, now: Date): boolean {
  if (sub.status !== "active") return false;
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * The single place the plan → permissions rule lives. No row means free. A row
 * that is not in force keeps reporting its plan name (so the UI can say "your
 * Pro plan lapsed") but grants nothing.
 */
export function deriveEntitlements(sub: SubscriptionBase | null, now: Date): Entitlements {
  if (!sub) return FREE_ENTITLEMENTS;
  const inForce = isSubscriptionInForce(sub, now);
  return {
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    features: {
      watermarkRemoval: inForce && sub.plan === "pro",
    },
  };
}
