import { useEffect } from "react";
import { setAnalyticsEnabled } from "./analytics-client";

/**
 * Run PostHog in the main window while diagnostics are enabled. Reads the persisted
 * deviceId (which the settings-store mints) and identifies with it, then follows the
 * Send diagnostics toggle without a restart. No-op without a key.
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
