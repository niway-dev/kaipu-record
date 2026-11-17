import { useEffect } from "react";
import { setAnalyticsEnabled } from "./analytics-client";

/**
 * Start PostHog in the main window and follow the Share usage and crash reports toggle
 * without a restart. Reads the persisted deviceId (which the settings-store mints) and gives
 * it to the SDK on every launch: with the toggle off the SDK still loads feature flags for
 * that id, and sends no event or crash report. No-op without a key.
 */
export function useInitAnalytics(): void {
  useEffect(() => {
    void window.electronAPI.getSettings().then((settings) => {
      setAnalyticsEnabled(settings.diagnosticsEnabled, settings.deviceId);
    });
    return window.electronAPI.onSettingsChanged((settings) => {
      setAnalyticsEnabled(settings.diagnosticsEnabled, settings.deviceId);
    });
  }, []);
}
