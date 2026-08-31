import { relations } from "drizzle-orm";
import { bigint, index, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";

/**
 * A recording (or screenshot) uploaded to the user's cloud vault. The bytes live
 * in R2 at `storageKey`; this row is the account-scoped metadata. `status` is
 * `pending` until the presigned upload is confirmed, then `ready`.
 */
export const recordingTable = createTable(
  "recording",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    // bigint(number) — a single video can exceed the 32-bit integer range.
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    durationSeconds: integer("duration_seconds").default(0).notNull(),
    status: text("status").default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("recording_userId_idx").on(table.userId)],
);

export const recordingRelations = relations(recordingTable, ({ one }) => ({
  user: one(userTable, {
    fields: [recordingTable.userId],
    references: [userTable.id],
  }),
}));
