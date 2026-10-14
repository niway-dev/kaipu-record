import { createDatabaseClient } from "@kaipu/infra-db/client";
import {
  AccountDeletionRepository,
  CloudAssetRepository,
  CloudPurgeRepository,
} from "@kaipu/infra-db/repositories";
import { runCloudSweep } from "./cloud/run-cloud-sweep";
import { env } from "./env";
import { makeAccountDeletionNotifier } from "./lib/account-deletion-notifier";
import { logEvent } from "./lib/events";
import { tryGetStorage } from "./lib/storage";

/**
 * Worker `scheduled` handler, fired by `triggers.crons` in wrangler.jsonc. Locally:
 * `bun run dev:server-hono` (the dev script passes `--test-scheduled`), then
 * `curl "http://localhost:3000/__scheduled"` (the cron expression is documented in
 * backend/cloud-storage.md; it cannot appear in this comment because it contains "*" + "/").
 */
export function scheduled(
  _controller: ScheduledController,
  _env: unknown,
  ctx: ExecutionContext,
): void {
  const db = createDatabaseClient(env.DATABASE_URL);
  ctx.waitUntil(
    runCloudSweep({
      assets: new CloudAssetRepository(db),
      purge: new CloudPurgeRepository(db),
      deletions: new AccountDeletionRepository(db),
      notifier: makeAccountDeletionNotifier(),
      storage: tryGetStorage(),
      log: logEvent,
    }),
  );
}
