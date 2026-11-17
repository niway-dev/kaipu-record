import { useCallback, useEffect, useState } from "react";

/**
 * Settings → App → Share usage and crash reports, for the onboarding's privacy step and
 * notice: reads `AppSettings.diagnosticsEnabled` (on until the user turns it off) and writes
 * it through the same IPC as Settings, so both processes follow it without a restart.
 */
export function useShareUsagePreference(): { enabled: boolean; setEnabled: (v: boolean) => void } {
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.getSettings().then((settings) => {
      if (!cancelled) setEnabledState(settings.diagnosticsEnabled ?? true);
    });
    const stop = window.electronAPI.onSettingsChanged((settings) =>
      setEnabledState(settings.diagnosticsEnabled ?? true),
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    void window.electronAPI.updateSettings({ diagnosticsEnabled: value });
  }, []);

  return { enabled, setEnabled };
}
