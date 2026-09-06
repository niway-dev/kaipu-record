import type { ISubscriptionRepository } from "@kaipu/domain/repositories";
import { deriveEntitlements, type Entitlements } from "@kaipu/domain/schemas";

/**
 * What the caller may do right now. The only read path into billing from the
 * outside — the API route and the desktop never see a subscription row.
 */
export async function getEntitlements(params: {
  repo: ISubscriptionRepository;
  userId: string;
  /** Injectable so lapse rules are testable; defaults to wall-clock time. */
  now?: Date;
}): Promise<Entitlements> {
  const subscription = await params.repo.findByUserId(params.userId);
  return deriveEntitlements(subscription, params.now ?? new Date());
}
