/**
 * Operator command: grant or revoke a plan by hand (comps, testing).
 *
 *   bun run plan grant <email> [pro]
 *   bun run plan revoke <email>
 *   bun run plan show <email>
 *
 * Uses DATABASE_URL from the environment (the root script loads apps/server-hono/.env,
 * which never overrides a value already set, so a production URL can be passed inline).
 */
import { grantManualPlan, ManualPlanGrantError, revokeManualPlan } from "@kaipu/application";
import { planSchema } from "@kaipu/domain/schemas";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import { ManualPlanGrantRepository } from "@kaipu/infra-db/repositories";

const USAGE = "Usage: bun run plan <grant|revoke|show> <email> [plan]";

async function main(): Promise<number> {
  const [command, email, planArg = "pro"] = process.argv.slice(2);
  if (!command || !email) {
    console.error(USAGE);
    return 1;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    return 1;
  }
  const repo = new ManualPlanGrantRepository(createDatabaseClient(databaseUrl));

  switch (command) {
    case "grant": {
      const plan = planSchema.safeParse(planArg);
      if (!plan.success) {
        console.error(
          `Unknown plan "${planArg}". Expected one of: ${planSchema.options.join(", ")}.`,
        );
        return 1;
      }
      const row = await grantManualPlan({ repo, email, plan: plan.data });
      console.log(`Granted ${row.plan} to ${email} (manual, no expiry).`);
      break;
    }
    case "revoke": {
      const removed = await revokeManualPlan({ repo, email });
      console.log(
        removed
          ? `Revoked the plan for ${email}; it is free now.`
          : `${email} had no plan; nothing changed.`,
      );
      break;
    }
    case "show": {
      const userId = await repo.findUserIdByEmail(email.trim().toLowerCase());
      if (userId === null) {
        console.error(`No account uses the email ${email}.`);
        return 1;
      }
      const row = await repo.findByUserId(userId);
      console.log(
        row ? `${email}: ${row.plan} (${row.status}, ${row.provider})` : `${email}: free (no row)`,
      );
      break;
    }
    default:
      console.error(USAGE);
      return 1;
  }
  console.log("Restart the desktop app (or sign out and in) to pick up the change.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof ManualPlanGrantError ? error.message : error);
    process.exit(1);
  },
);
