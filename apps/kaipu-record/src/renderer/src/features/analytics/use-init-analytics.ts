import { useEffect } from "react";
import { initAnalytics } from "./analytics-client";

/**
 * Initialize PostHog once for the main window. Reads the persisted deviceId (which
 * the settings-store mints) and identifies with it. No-op without a key.
 */
export function useInitAnalytics(): void {
  useEffect(() => {
    void window.electronAPI.getSettings().then((settings) => {
      initAnalytics(settings.deviceId);
    });
  }, []);
}
