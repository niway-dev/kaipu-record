import { entitlementsSchema } from "@kaipu/domain/schemas";
import { oc } from "@orpc/contract";
import { apiResponseSchema } from "./shared.contract";

/** The signed-in user's own account surface. Billing reaches clients only through here. */
export const meContract = {
  entitlements: oc
    .route({ method: "GET", path: "/me/entitlements" })
    .output(apiResponseSchema(entitlementsSchema)),
};
