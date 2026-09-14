import type { IManualPlanGrantRepository } from "@kaipu/domain/repositories";
import type { Plan, SubscriptionBase } from "@kaipu/domain/schemas";

export class ManualPlanGrantError extends Error {
  constructor(
    readonly code: "user-not-found" | "provider-owned",
    message: string,
  ) {
    super(message);
    this.name = "ManualPlanGrantError";
  }
}

async function resolveUserId(repo: IManualPlanGrantRepository, email: string): Promise<string> {
  const userId = await repo.findUserIdByEmail(email.trim().toLowerCase());
  if (userId === null) {
    throw new ManualPlanGrantError("user-not-found", `No account uses the email ${email}.`);
  }
  return userId;
}

/** A row a billing provider wrote is theirs to change; a manual command must not clobber it. */
function assertNotProviderOwned(row: SubscriptionBase | null, email: string): void {
  if (row !== null && row.provider !== "manual") {
    throw new ManualPlanGrantError(
      "provider-owned",
      `The subscription for ${email} is managed by ${row.provider}; change it there.`,
    );
  }
}

/** Grants `plan` to the account with this email as an active, non-expiring manual row. */
export async function grantManualPlan(params: {
  repo: IManualPlanGrantRepository;
  email: string;
  plan: Plan;
}): Promise<SubscriptionBase> {
  const userId = await resolveUserId(params.repo, params.email);
  assertNotProviderOwned(await params.repo.findByUserId(userId), params.email);
  return params.repo.upsertManualGrant(userId, params.plan);
}

/** Removes a manual grant so the account reverts to free. Returns false when there was none. */
export async function revokeManualPlan(params: {
  repo: IManualPlanGrantRepository;
  email: string;
}): Promise<boolean> {
  const userId = await resolveUserId(params.repo, params.email);
  const row = await params.repo.findByUserId(userId);
  if (row === null) return false;
  assertNotProviderOwned(row, params.email);
  await params.repo.deleteByUserId(userId);
  return true;
}
