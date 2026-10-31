import { ROUTES } from "@shared/routes";
import type { DestinationId } from "./destinations";

/** The query parameter that preselects a destination: `/prepare/:assetId?to=youtube`. */
export const PREPARE_DESTINATION_PARAM = "to";

/** The Prepare URL for a recording, optionally with a destination preselected. */
export function preparePath(assetId: string, destination?: DestinationId): string {
  const base = ROUTES.prepare.replace(":assetId", encodeURIComponent(assetId));
  return destination ? `${base}?${PREPARE_DESTINATION_PARAM}=${destination}` : base;
}
