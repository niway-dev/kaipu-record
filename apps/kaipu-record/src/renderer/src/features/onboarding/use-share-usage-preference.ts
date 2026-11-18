import { useCallback, useRef, useState } from "react";
import type { AppSettings } from "@shared/types";
import { updateSettings, useSettings } from "@renderer/features/settings/settings-store";

const pickEnabled = (settings: AppSettings): boolean => settings.diagnosticsEnabled ?? true;

/**
 * Settings → App → Share usage and crash reports, for the onboarding's privacy step and
 * notice: reads `AppSettings.diagnosticsEnabled` (on until the user turns it off) and writes
 * it through the same IPC as Settings, so both processes follow it without a restart.
 *
 * `enabled` is `null` until the window's settings store has its first read, and stays `null` if
 * that read fails: the control decides whether data leaves the Mac, so it must not show a value
 * main has not confirmed (a returning user who already turned sharing off would first see it On).
 */
export function useShareUsagePreference(): {
  enabled: boolean | null;
  setEnabled: (v: boolean) => void;
} {
  const saved = useSettings(pickEnabled);
  // What the switch shows while a write is out; cleared once main has answered, so the switch
  // then shows what the store holds (main's answer, or the old value after a failed write).
  const [pending, setPending] = useState<boolean | null>(null);
  const latestRequest = useRef(0);

  // The switch moves at once, then settles on what main saved: this control decides whether data
  // leaves the Mac, so a failed write must not leave it showing a value main does not hold.
  const setEnabled = useCallback((value: boolean) => {
    const request = ++latestRequest.current;
    setPending(value);
    updateSettings({ diagnosticsEnabled: value })
      .catch(() => undefined)
      .finally(() => {
        if (request === latestRequest.current) setPending(null);
      });
  }, []);

  return { enabled: pending ?? saved, setEnabled };
}
