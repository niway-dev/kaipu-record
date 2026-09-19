import { createDatabaseClient } from "@kaipu/infra-db/client";
import {
  userTable,
  subscriptionTable,
  cloudStorageAccountTable,
  cloudControlTable,
} from "@kaipu/infra-db/schemas";
import { deriveEntitlements, subscriptionBaseSchema } from "@kaipu/domain/schemas";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { consoleConfig } from "./backend.server";

export async function queryUsers(input: { search: string; page: number }) {
  const { databaseUrl } = consoleConfig();
  if (!databaseUrl) throw new Error("Console database is not configured.");
  const db = createDatabaseClient(databaseUrl);
  const pattern = `%${input.search.replace(/[\\%_]/g, "\\$&")}%`;
  const filter = input.search
    ? or(ilike(userTable.email, pattern), ilike(userTable.name, pattern))
    : undefined;
  const pageSize = 25;
  const [rows, totals, control] = await Promise.all([
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        emailVerified: userTable.emailVerified,
        createdAt: userTable.createdAt,
        subscription: subscriptionTable,
        usedBytes: cloudStorageAccountTable.usedBytes,
        reservedBytes: cloudStorageAccountTable.reservedBytes,
        pendingUploads: cloudStorageAccountTable.pendingUploads,
      })
      .from(userTable)
      .leftJoin(subscriptionTable, eq(subscriptionTable.userId, userTable.id))
      .leftJoin(cloudStorageAccountTable, eq(cloudStorageAccountTable.userId, userTable.id))
      .where(filter)
      .orderBy(desc(userTable.createdAt), desc(userTable.id))
      .limit(pageSize)
      .offset((input.page - 1) * pageSize),
    db.select({ total: count() }).from(userTable).where(filter),
    db
      .select({ uploadsEnabled: cloudControlTable.uploadsEnabled })
      .from(cloudControlTable)
      .where(eq(cloudControlTable.id, "global"))
      .limit(1),
  ]);
  return {
    page: input.page,
    pageSize,
    total: totals[0]?.total ?? 0,
    uploadsEnabled: control[0]?.uploadsEnabled ?? true,
    users: rows.map(
      ({ subscription, createdAt, usedBytes, reservedBytes, pendingUploads, ...user }) => {
        const entitlements = deriveEntitlements(
          subscription ? subscriptionBaseSchema.parse(subscription) : null,
          new Date(),
          { cloudAccess: user.emailVerified },
        );
        return {
          ...user,
          createdAt: createdAt.toISOString(),
          plan: entitlements.plan,
          status: subscription?.status ?? "active",
          provider: subscription?.provider ?? null,
          expiresAt: subscription?.currentPeriodEnd?.toISOString() ?? null,
          capacityBytes: entitlements.features.cloudStorageBytes,
          usedBytes: usedBytes ?? 0,
          reservedBytes: reservedBytes ?? 0,
          pendingUploads: pendingUploads ?? 0,
        };
      },
    ),
  };
}
