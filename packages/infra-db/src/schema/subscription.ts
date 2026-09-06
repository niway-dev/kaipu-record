import { relations } from "drizzle-orm";
import { index, text, timestamp } from "drizzle-orm/pg-core";
import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";

/**
 * Commercial state — deliberately its own table, not columns on `user`, so the
 * auth layer never carries billing data. One row per user for now (`user_id`
 * unique); dropping that constraint is how history gets added later. No row
 * means the free plan. `plan`/`status`/`provider` are text validated by the
 * domain enums.
 */
export const subscriptionTable = createTable(
  "subscription",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => userTable.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(),
    status: text("status").default("active").notNull(),
    // null = never lapses (a manual grant); a provider fills it in.
    currentPeriodEnd: timestamp("current_period_end"),
    provider: text("provider").default("manual").notNull(),
    providerRef: text("provider_ref"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("subscription_userId_idx").on(table.userId)],
);

export const subscriptionRelations = relations(subscriptionTable, ({ one }) => ({
  user: one(userTable, {
    fields: [subscriptionTable.userId],
    references: [userTable.id],
  }),
}));
