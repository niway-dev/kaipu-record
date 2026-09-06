import type { SubscriptionBase } from "../schemas/subscription";

/**
 * Read side of the billing module. Writes happen through whichever provider
 * owns the row (an operator by hand today, a webhook later), never through the API.
 */
export interface ISubscriptionRepository {
  /** The user's subscription, or null when they never had one (= free). */
  findByUserId(userId: string): Promise<SubscriptionBase | null>;
}
