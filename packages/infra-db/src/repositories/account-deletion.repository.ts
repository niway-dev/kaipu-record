import type {
  AccountDeletion,
  DueAccountDeletion,
  IAccountDeletionRepository,
} from "@kaipu/domain/repositories";
import { and, asc, eq, exists, lte, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { accountDeletionTable } from "../schema/account-deletion";
import { sessionTable, userTable } from "../schema/auth";
import { cloudPurgeTable } from "../schema/cloud";

export class AccountDeletionRepository implements IAccountDeletionRepository {
  constructor(private readonly db: DatabaseClient) {}

  async find(userId: string): Promise<AccountDeletion | null> {
    const [row] = await this.db
      .select()
      .from(accountDeletionTable)
      .where(eq(accountDeletionTable.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async schedule(data: AccountDeletion): Promise<AccountDeletion> {
    // ON CONFLICT DO NOTHING keeps the first schedule: repeating the request never moves the date.
    await this.db.insert(accountDeletionTable).values(data).onConflictDoNothing();
    const row = await this.find(data.userId);
    if (!row) throw new Error("account deletion was not recorded");
    return row;
  }

  async cancel(userId: string): Promise<boolean> {
    const rows = await this.db
      .delete(accountDeletionTable)
      .where(eq(accountDeletionTable.userId, userId))
      .returning({ userId: accountDeletionTable.userId });
    return rows.length > 0;
  }

  async revokeSessions(userId: string): Promise<number> {
    // Better Auth keeps web cookie sessions and desktop bearer tokens in the same table.
    const rows = await this.db
      .delete(sessionTable)
      .where(eq(sessionTable.userId, userId))
      .returning({ id: sessionTable.id });
    return rows.length;
  }

  async listDue(now: Date, limit: number): Promise<DueAccountDeletion[]> {
    return this.db
      .select({
        userId: accountDeletionTable.userId,
        requestedAt: accountDeletionTable.requestedAt,
        scheduledAt: accountDeletionTable.scheduledAt,
        locale: accountDeletionTable.locale,
        email: userTable.email,
      })
      .from(accountDeletionTable)
      .innerJoin(userTable, eq(userTable.id, accountDeletionTable.userId))
      .where(lte(accountDeletionTable.scheduledAt, now))
      .orderBy(asc(accountDeletionTable.scheduledAt))
      .limit(limit);
  }

  async finalize(userId: string, now: Date): Promise<boolean> {
    const due = and(
      eq(accountDeletionTable.userId, userId),
      lte(accountDeletionTable.scheduledAt, now),
    );
    // One batch = one transaction over Neon HTTP. Both statements re-check that the deletion is
    // still scheduled and due, so a restore that lands first makes this a no-op, and the purge
    // job can never exist without the user row being gone (or vice versa).
    const [, deleted] = await this.db.batch([
      this.db.insert(cloudPurgeTable).select(
        this.db
          // Insert-select must list every column, in table order.
          .select({
            id: sql<string>`gen_random_uuid()::text`.as("id"),
            userId: accountDeletionTable.userId,
            attempts: sql<number>`0`.as("attempts"),
            lastError: sql<string | null>`null`.as("last_error"),
            doneAt: sql<Date | null>`null`.as("done_at"),
            createdAt: sql<Date>`now()`.as("created_at"),
          })
          .from(accountDeletionTable)
          .where(due),
      ),
      this.db
        .delete(userTable)
        .where(
          and(
            eq(userTable.id, userId),
            exists(this.db.select({ one: sql`1` }).from(accountDeletionTable).where(due)),
          ),
        )
        .returning({ id: userTable.id }),
    ]);
    return deleted.length > 0;
  }
}
