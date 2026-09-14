import type { Plan, SubscriptionBase } from "../schemas/subscription";

/**
 * Operator-only write side of the billing module: grants and revokes a plan by hand
 * (comps, testing). Used from a local command, never from the API, so no client can
 * reach it.
 */
export interface IManualPlanGrantRepository {
  /** The user's id for an email, or null when no account uses it. */
  findUserIdByEmail(email: string): Promise<string | null>;
  findByUserId(userId: string): Promise<SubscriptionBase | null>;
  /** Creates or replaces the user's row as an active, non-expiring manual grant. */
  upsertManualGrant(userId: string, plan: Plan): Promise<SubscriptionBase>;
  deleteByUserId(userId: string): Promise<void>;
}
