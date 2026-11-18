import { useCallback, useEffect, useState } from "react";

/**
 * Settings → App → Share usage and crash reports, for the onboarding's privacy step and
 * notice: reads `AppSettings.diagnosticsEnabled` (on until the user turns it off) and writes
 * it through the same IPC as Settings, so both processes follow it without a restart.
 *
 * `enabled` is `null` until the first read settles, and stays `null` if that read fails: the
 * control decides whether data leaves the Mac, so it must not show a value main has not
 * confirmed (a returning user who already turned sharing off would first see it On).
 */
export function useShareUsagePreference(): {
  enabled: boolean | null;
  setEnabled: (v: boolean) => void;
} {
  const [enabled, setEnabledState] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A failed read leaves the value unknown (the control stays disabled); a later settings
    // change from main still fills it in.
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
