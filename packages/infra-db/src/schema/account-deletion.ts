import { index, text, timestamp } from "drizzle-orm/pg-core";
import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";

/**
 * Pending account deletions (soft delete, decision 2026-10-10 / NIW2-214). A row means the account
 * is deactivated until `scheduled_at`; the cron then hard-deletes the user, and the cascade removes
 * this row too. Restoring deletes the row. A separate table rather than columns on Better Auth's
 * `user` table, so the auth schema stays exactly what Better Auth expects.
 */
export const accountDeletionTable = createTable(
  "account_deletion",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => userTable.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at").notNull(),
    scheduledAt: timestamp("scheduled_at").notNull(),
    locale: text("locale").default("en").notNull(),
  },
  (table) => [index("account_deletion_scheduled_at_idx").on(table.scheduledAt)],
);
