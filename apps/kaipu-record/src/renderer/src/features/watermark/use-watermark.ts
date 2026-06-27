import { useMemo } from "react";
import {
  DEFAULT_WATERMARK_CONFIG,
  resolveWatermarkEnabled,
  type WatermarkConfig,
} from "./watermark";
import { readDevSimulatePaid } from "./dev-override";

export interface WatermarkState {
  enabled: boolean;
  config: WatermarkConfig;
}

/**
 * THE single source of truth for the watermark decision. Everything that wants to
 * know "do we burn the watermark, and how does it look?" reads this hook — the
 * engine never sees plans or flags.
 *
 * Today the inputs are local stubs; the seams are marked so a real backend
 * (entitlement) and a feature flag (PostHog) plug in HERE and nowhere else. The
 * dev-only Settings toggle (`readDevSimulatePaid`) is read at render, so flipping
 * it and navigating to the Record page (a remount) takes effect without a restart.
 */
export function useWatermark(): WatermarkState {
  // TODO(backend): real entitlement from the user's plan. Free → watermark on.
  const isPaid = false;
  // TODO(flags): PostHog flag. Defaults on so the watermark ships even offline.
  const flagOn = true;
  const devForce = readDevSimulatePaid() ? "paid" : null;

  const enabled = resolveWatermarkEnabled({ flagOn, isPaid, devForce });
  return useMemo(() => ({ enabled, config: DEFAULT_WATERMARK_CONFIG }), [enabled]);
}
