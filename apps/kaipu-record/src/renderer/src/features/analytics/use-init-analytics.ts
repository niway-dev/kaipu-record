import { useEffect } from "react";
import type { AppSettings } from "@shared/types";
import { watchSettings } from "@renderer/features/settings/settings-store";
import { setAnalyticsEnabled } from "./analytics-client";

/**
 * Start PostHog in the main window and follow the Share usage and crash reports toggle
 * without a restart. Reads the persisted deviceId (which the settings-store mints) and gives
 * it to the SDK on every launch: with the toggle off the SDK still loads feature flags for
 * that id, and sends no event or crash report. No-op without a key.
 */
export function useInitAnalytics(): void {
  useEffect(() => {
    const apply = (settings: AppSettings): void =>
      setAnalyticsEnabled(settings.diagnosticsEnabled, settings.deviceId);
    return watchSettings(apply);
  }, []);
}
