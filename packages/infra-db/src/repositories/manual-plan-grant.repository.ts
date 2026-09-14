import type { IManualPlanGrantRepository } from "@kaipu/domain/repositories";
import type { Plan, SubscriptionBase } from "@kaipu/domain/schemas";
import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { mapSubscriptionToDomain } from "../mappers/subscription.mapper";
import { subscriptionTable, userTable } from "../schema";

export class ManualPlanGrantRepository implements IManualPlanGrantRepository {
  constructor(private db: DatabaseClient) {}

  async findUserIdByEmail(email: string): Promise<string | null> {
    const results = await this.db
      .select({ id: userTable.id })
      .from(userTable)
      .where(eq(userTable.email, email))
      .limit(1);
    return results[0]?.id ?? null;
  }

  async findByUserId(userId: string): Promise<SubscriptionBase | null> {
    const results = await this.db
      .select()
      .from(subscriptionTable)
      .where(eq(subscriptionTable.userId, userId))
      .limit(1);
    return results[0] ? mapSubscriptionToDomain(results[0]) : null;
  }

  async upsertManualGrant(userId: string, plan: Plan): Promise<SubscriptionBase> {
    const grant = {
      plan,
      status: "active",
      currentPeriodEnd: null,
      provider: "manual",
      providerRef: null,
      updatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(subscriptionTable)
      .values({ userId, ...grant })
      .onConflictDoUpdate({ target: subscriptionTable.userId, set: grant })
      .returning();
    if (!row) throw new Error("Upserting the manual grant returned no row.");
    return mapSubscriptionToDomain(row);
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.delete(subscriptionTable).where(eq(subscriptionTable.userId, userId));
  }
}
