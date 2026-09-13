import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";

/**
 * One row per logical library item the account has ever uploaded. The id is minted
 * by the client (the desktop sidecar) so a re-upload after "remove local download"
 * lands on the same asset. Primary key is (user, asset) so a stranger claiming a
 * known id only collides inside their own account.
 */
export const cloudAssetTable = createTable(
  "cloud_asset",
  {
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    /** The ready revision clients download; null until the first confirm. */
    currentRevisionId: text("current_revision_id"),
    durationSeconds: integer("duration_seconds").default(0).notNull(),
    derivedFromAssetId: text("derived_from_asset_id"),
    /** Set when the user deletes the cloud copy; automatic upload must skip it until re-upload. */
    autoUploadExcluded: boolean("auto_upload_excluded").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.assetId] }),
    index("cloud_asset_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** Immutable bytes. Status transitions are the whole lifecycle — see domain `REVISION_STATUSES`. */
export const cloudRevisionTable = createTable(
  "cloud_revision",
  {
    revisionId: text("revision_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    /** Client idempotency key; unique per account. */
    intentKey: text("intent_key").notNull(),
    status: text("status").default("reserved").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    thumbnailKey: text("thumbnail_key"),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    thumbnailBytes: integer("thumbnail_bytes").default(0).notNull(),
    contentSha256: text("content_sha256").notNull(),
    reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
    ticketExpiresAt: timestamp("ticket_expires_at").notNull(),
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("cloud_revision_user_intent_idx").on(t.userId, t.intentKey),
    index("cloud_revision_user_asset_idx").on(t.userId, t.assetId),
    index("cloud_revision_status_ticket_idx").on(t.status, t.ticketExpiresAt),
  ],
);

/**
 * Per-account accounting. Quota is enforced with ONE conditional UPDATE on this row
 * (`used + reserved + new <= capacity`), which Postgres serialises through the row
 * lock — no interactive transaction needed on the HTTP driver. Revision rows remain
 * the source of truth; `reconcile()` rebuilds these counters from them.
 */
export const cloudStorageAccountTable = createTable("cloud_storage_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => userTable.id, { onDelete: "cascade" }),
  usedBytes: bigint("used_bytes", { mode: "number" }).default(0).notNull(),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).default(0).notNull(),
  pendingUploads: integer("pending_uploads").default(0).notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/** Single-row operator switches. `id` is always "global". Flipped by `cloud:uploads` (Task 11). */
export const cloudControlTable = createTable("cloud_control", {
  id: text("id").primaryKey(),
  uploadsEnabled: boolean("uploads_enabled").default(true).notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * Account purge queue. No FK: the user row is already gone when the sweep runs.
 * Holds the user id only — the prefixes are derived by `accountPrefixes(userId)`.
 */
export const cloudPurgeTable = createTable("cloud_purge", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  doneAt: timestamp("done_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cloudAssetRelations = relations(cloudAssetTable, ({ one }) => ({
  user: one(userTable, { fields: [cloudAssetTable.userId], references: [userTable.id] }),
}));
