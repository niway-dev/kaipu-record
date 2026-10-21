import { useMemo } from "react";
import { DEFAULT_WATERMARK_CONFIG, type WatermarkConfig } from "./watermark";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";

export interface WatermarkState {
  enabled: boolean;
  config: WatermarkConfig;
}

/**
 * THE single source of truth for the watermark decision. Everything that wants to
 * know "do we burn the mark, and how does it look?" reads this hook — the engine
 * never sees settings.
 *
 * The mark is the user's opt-in "Made with Kaipu" badge (`AppSettings.showBrandBadge`),
 * not a plan gate: the free app ships without a watermark
 * (backlog/free-tier-no-watermark). Until the settings round-trip resolves the hook
 * reports off — a badge is never burned in by accident.
 */
export function useWatermark(): WatermarkState {
  const { settings } = useAppSettings();
  const enabled = settings?.showBrandBadge === true;
  return useMemo(() => ({ enabled, config: DEFAULT_WATERMARK_CONFIG }), [enabled]);
}
