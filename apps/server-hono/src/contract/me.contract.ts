import { entitlementsSchema, storageUsageSchema } from "@kaipu/domain/schemas";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { apiResponseSchema } from "./shared.contract";

/** Same bounds as the sign-up form and Better Auth's defaults (min 8, max 128). */
export const setPasswordInputSchema = z.object({ newPassword: z.string().min(8).max(128) });

/** The signed-in user's own account surface. Billing reaches clients only through here. */
export const meContract = {
  entitlements: oc
    .route({ method: "GET", path: "/me/entitlements" })
    .output(apiResponseSchema(entitlementsSchema)),
  storage: oc
    .route({ method: "GET", path: "/me/storage" })
    .output(apiResponseSchema(storageUsageSchema)),
  /** A Google-only user adds a password (NIW2-219, FR10). 409 when one already exists. */
  setPassword: oc
    .route({ method: "POST", path: "/me/password" })
    .input(setPasswordInputSchema)
    .output(apiResponseSchema(z.object({ status: z.literal(true) }))),
  /**
   * One-time notices, read once: answering also clears them. Today only `credentialDropped`
   * (the pre-hijack guard removed a password set before the email was verified, NIW2-219 Q3).
   */
  takeNotices: oc
    .route({ method: "POST", path: "/me/notices/take" })
    .output(apiResponseSchema(z.object({ credentialDropped: z.boolean() }))),
};
