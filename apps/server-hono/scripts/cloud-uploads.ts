/**
 * Operator command: read or flip the global cloud upload switch (`cloud_control.uploads_enabled`).
 *
 *   bun run cloud:uploads status
 *   bun run cloud:uploads off
 *   bun run cloud:uploads on
 *
 * Run from the repo root: the root script goes through scripts/with-env.sh (Infisical,
 * `db-scripts` tag) and so targets the DEV database unless DATABASE_URL is passed explicitly.
 * Prints the database host, never the URL.
 */
import { createDatabaseClient } from "@kaipu/infra-db/client";
import { CloudAccessRepository } from "@kaipu/infra-db/repositories";
import { runCloudUploadsCommand } from "../src/cloud/cloud-uploads-command";

function hostOf(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).hostname || "(unknown host)";
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
console.log(`database: ${hostOf(url)}`);
const repo = new CloudAccessRepository(createDatabaseClient(url));
process.exit(await runCloudUploadsCommand(process.argv[2], repo, (line) => console.log(line)));
