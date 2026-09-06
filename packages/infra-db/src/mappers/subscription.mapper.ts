import type { SubscriptionBase } from "@kaipu/domain/schemas";
import type { subscriptionTable } from "../schema/subscription";

type SubscriptionRow = typeof subscriptionTable.$inferSelect;

export function mapSubscriptionToDomain(row: SubscriptionRow): SubscriptionBase {
  return {
    id: row.id,
    userId: row.userId,
    plan: row.plan as SubscriptionBase["plan"],
    status: row.status as SubscriptionBase["status"],
    currentPeriodEnd: row.currentPeriodEnd,
    provider: row.provider as SubscriptionBase["provider"],
    providerRef: row.providerRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
