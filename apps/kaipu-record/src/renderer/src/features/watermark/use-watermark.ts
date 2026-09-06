import { useMemo } from "react";
import {
  DEFAULT_WATERMARK_CONFIG,
  resolveWatermarkEnabled,
  type WatermarkConfig,
} from "./watermark";
import { readDevSimulatePaid } from "./dev-override";
import { useFlag } from "@renderer/features/analytics/use-flag";
import { useAuthStatus } from "@renderer/features/auth/use-auth-status";
import { isWatermarkRemovalGranted } from "@shared/entitlements";

export interface WatermarkState {
  enabled: boolean;
  config: WatermarkConfig;
}

/**
 * THE single source of truth for the watermark decision. Everything that wants to
 * know "do we burn the watermark, and how does it look?" reads this hook — the
 * engine never sees plans or flags.
 *
 * The paid input is the account's entitlements as the auth status carries them
 * (signed-in: fresh from the server; `unknown`: the last copy cached on disk, so
 * going offline keeps the plan). Until the first status round-trip resolves the
 * hook reports free — the watermark is on by default, never off by accident.
 * The dev-only Settings toggle (`readDevSimulatePaid`) is read at render, so
 * flipping it and navigating to the Record page (a remount) takes effect without
 * a restart.
 */
export function useWatermark(): WatermarkState {
  const { status } = useAuthStatus();
  const isPaid = isWatermarkRemovalGranted(status, new Date());
  // Remote kill-switch for prod testing. Defaults on (offline/unresolved) so the
  // watermark still ships — see FLAG_DEFAULTS.
  const flagOn = useFlag("watermark-enabled");
  const devForce = readDevSimulatePaid() ? "paid" : null;

  const enabled = resolveWatermarkEnabled({ flagOn, isPaid, devForce });
  return useMemo(() => ({ enabled, config: DEFAULT_WATERMARK_CONFIG }), [enabled]);
}
