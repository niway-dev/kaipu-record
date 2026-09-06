import type { ISubscriptionRepository } from "@kaipu/domain/repositories";
import type { SubscriptionBase } from "@kaipu/domain/schemas";
import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { mapSubscriptionToDomain } from "../mappers/subscription.mapper";
import { subscriptionTable } from "../schema";

export class SubscriptionRepository implements ISubscriptionRepository {
  constructor(private db: DatabaseClient) {}

  async findByUserId(userId: string): Promise<SubscriptionBase | null> {
    const results = await this.db
      .select()
      .from(subscriptionTable)
      .where(eq(subscriptionTable.userId, userId))
      .limit(1);
    return results[0] ? mapSubscriptionToDomain(results[0]) : null;
  }
}
