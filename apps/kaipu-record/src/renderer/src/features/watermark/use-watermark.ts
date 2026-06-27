import { useMemo } from "react";
import {
  DEFAULT_WATERMARK_CONFIG,
  resolveWatermarkEnabled,
  type WatermarkConfig,
} from "./watermark";

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
 * (entitlement) and a feature flag (PostHog) plug in HERE and nowhere else.
 */
export function useWatermark(): WatermarkState {
  return useMemo(() => {
    // TODO(backend): real entitlement from the user's plan. Free → watermark on.
    const isPaid = false;
    // TODO(flags): PostHog flag. Defaults on so the watermark ships even offline.
    const flagOn = true;

    const enabled = resolveWatermarkEnabled({ flagOn, isPaid, devForce: devForceEntitlement() });
    return { enabled, config: DEFAULT_WATERMARK_CONFIG };
  }, []);
}

/**
 * DEV-ONLY override: `VITE_WATERMARK_FORCE=free|paid` flips the watermark while
 * developing (free → on, paid → off). The `import.meta.env.DEV` guard is replaced
 * with a literal at build time, so in a production build this whole branch — and
 * the env read itself — is eliminated by dead-code removal. It can never reach prod.
 */
function devForceEntitlement(): "free" | "paid" | null {
  if (!import.meta.env.DEV) return null;
  const forced = import.meta.env.VITE_WATERMARK_FORCE;
  return forced === "free" || forced === "paid" ? forced : null;
}
