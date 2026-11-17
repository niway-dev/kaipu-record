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
    // A failed read keeps the default (on), which is also what main holds until the user turns it off.
    void window.electronAPI
      .getSettings()
      .then((settings) => {
        if (!cancelled) setEnabledState(settings.diagnosticsEnabled ?? true);
      })
      .catch(() => {});
    const stop = window.electronAPI.onSettingsChanged((settings) =>
      setEnabledState(settings.diagnosticsEnabled ?? true),
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  // The switch moves at once, then settles on what main saved: this control decides whether data
  // leaves the Mac, so a failed write must not leave it showing a value main does not hold.
  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    void window.electronAPI
      .updateSettings({ diagnosticsEnabled: value })
      .then((saved) => setEnabledState(saved.diagnosticsEnabled ?? true))
      .catch(() =>
        window.electronAPI.getSettings().then((s) => setEnabledState(s.diagnosticsEnabled ?? true)),
      )
      .catch(() => {});
  }, []);

  return { enabled, setEnabled };
}
