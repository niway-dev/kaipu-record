import {
  accountDeletionStatusSchema,
  entitlementsSchema,
  storageUsageSchema,
} from "@kaipu/domain/schemas";
import { oc } from "@orpc/contract";
import { apiResponseSchema } from "./shared.contract";

/** The signed-in user's own account surface. Billing reaches clients only through here. */
export const meContract = {
  entitlements: oc
    .route({ method: "GET", path: "/me/entitlements" })
    .output(apiResponseSchema(entitlementsSchema)),
  storage: oc
    .route({ method: "GET", path: "/me/storage" })
    .output(apiResponseSchema(storageUsageSchema)),
  // Account deletion = soft delete with a 7-day grace period (NIW2-214, decision 2026-10-10).
  // These three routes also accept an account that is scheduled for deletion; every other
  // authenticated route answers it FORBIDDEN { kind: "account-deletion-scheduled" }.
  accountDeletionStatus: oc
    .route({ method: "GET", path: "/me/account-deletion" })
    .output(apiResponseSchema(accountDeletionStatusSchema)),
  requestAccountDeletion: oc
    .route({ method: "POST", path: "/me/account-deletion" })
    .output(apiResponseSchema(accountDeletionStatusSchema)),
  restoreAccount: oc
    .route({ method: "POST", path: "/me/account-deletion/restore" })
    .output(apiResponseSchema(accountDeletionStatusSchema)),
};
