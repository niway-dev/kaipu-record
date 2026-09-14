import type { CloudControl, ICloudAccessRepository } from "@kaipu/domain/repositories";
import { eq } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { userTable } from "../schema/auth";
import { cloudControlTable } from "../schema/cloud";

export class CloudAccessRepository implements ICloudAccessRepository {
  constructor(private db: DatabaseClient) {}

  /** Cloud Free is automatic for a verified email (Task 0 #8); there is no allowlist. */
  async hasAccess(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ emailVerified: userTable.emailVerified })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    return row?.emailVerified === true;
  }

  /** Admin only (`cloud:uploads`, Task 11). Upserts the single global row. */
  async setUploadsEnabled(enabled: boolean): Promise<CloudControl> {
    await this.db
      .insert(cloudControlTable)
      .values({ id: "global", uploadsEnabled: enabled })
      .onConflictDoUpdate({ target: cloudControlTable.id, set: { uploadsEnabled: enabled } });
    return { uploadsEnabled: enabled };
  }

  /** Missing row = uploads enabled: the switch is for stopping, not for starting. */
  async getControl(): Promise<CloudControl> {
    const [row] = await this.db
      .select()
      .from(cloudControlTable)
      .where(eq(cloudControlTable.id, "global"))
      .limit(1);
    return { uploadsEnabled: row?.uploadsEnabled ?? true };
  }
}
