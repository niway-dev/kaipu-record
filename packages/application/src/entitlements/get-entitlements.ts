import type { ICloudAccessRepository, ISubscriptionRepository } from "@kaipu/domain/repositories";
import { deriveEntitlements, type Entitlements } from "@kaipu/domain/schemas";

/**
 * What the caller may do right now. Billing and cloud access (verified email) are read
 * here and nowhere else; the API route and the desktop never see either row.
 */
export async function getEntitlements(params: {
  repo: ISubscriptionRepository;
  cloudAccessRepo: ICloudAccessRepository;
  userId: string;
  /** Injectable so lapse rules are testable; defaults to wall-clock time. */
  now?: Date;
}): Promise<Entitlements> {
  const [subscription, cloudAccess] = await Promise.all([
    params.repo.findByUserId(params.userId),
    params.cloudAccessRepo.hasAccess(params.userId),
  ]);
  return deriveEntitlements(subscription, params.now ?? new Date(), { cloudAccess });
}
