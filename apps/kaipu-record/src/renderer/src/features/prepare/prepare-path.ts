import { ROUTES } from "@shared/routes";
import type { DestinationId } from "./destinations";

/** The query parameter that preselects a destination: `/export/:assetId?to=youtube`. */
export const PREPARE_DESTINATION_PARAM = "to";

/**
 * The Export URL for a recording, optionally with a destination preselected. Named for the
 * screen it used to open (Prepare); every "export a copy" entry point calls it, so its name
 * and signature stay put while the screen is Export.
 */
export function preparePath(assetId: string, destination?: DestinationId): string {
  const base = ROUTES.export.replace(":assetId", encodeURIComponent(assetId));
  return destination ? `${base}?${PREPARE_DESTINATION_PARAM}=${destination}` : base;
}

/** Export with no recording yet, optionally keeping a destination selected. */
export function prepareNewPath(destination?: DestinationId | null): string {
  return destination
    ? `${ROUTES.exportNew}?${PREPARE_DESTINATION_PARAM}=${destination}`
    : ROUTES.exportNew;
}

/** The Export screen's names for the same two paths. */
export { preparePath as exportPath, prepareNewPath as exportNewPath };
