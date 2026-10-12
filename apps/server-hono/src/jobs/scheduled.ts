import { createDatabaseClient } from "@kaipu/infra-db/client";
import { CloudAssetRepository, CloudPurgeRepository } from "@kaipu/infra-db/repositories";
import { env } from "../env";
import { tryGetStorage } from "../lib/storage";
import { runScheduledJobs } from "./run-scheduled-jobs";

/** Worker `scheduled` handler: wires real adapters into the job runner. Cron lives in wrangler.jsonc. */
export async function scheduled(
  _controller: ScheduledController,
  _env: unknown,
  ctx: ExecutionContext,
): Promise<void> {
  const db = createDatabaseClient(env.DATABASE_URL);
  ctx.waitUntil(
    runScheduledJobs({
      assets: new CloudAssetRepository(db),
      purge: new CloudPurgeRepository(db),
      storage: tryGetStorage(),
      now: new Date(),
    }),
  );
}
