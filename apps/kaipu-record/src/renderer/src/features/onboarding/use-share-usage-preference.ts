import { useCallback, useRef, useState } from "react";
import type { AppSettings } from "@shared/types";
import {
  getSettingsRevision,
  updateSettings,
  useSettings,
} from "@renderer/features/settings/settings-store";

const pickSource = (settings: AppSettings): AppSettings => settings;
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
  const source = useSettings(pickSource);
  // What the switch shows while a write is out, and after a write whose outcome nobody could
  // confirm. It applies only to the store value it was set against: once the store takes a new
  // one (a broadcast, main's answer, or the re-read after a rejected write), the switch shows
  // that instead.
  const [pending, setPending] = useState<{ value: boolean; source: AppSettings | null } | null>(
    null,
  );
  const latestRequest = useRef(0);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // The switch moves at once, then settles on what main saved: this control decides whether data
  // leaves the Mac, so a failed write must not leave it showing a value main does not hold.
  // When the write fails and the re-read fails too, main may have stored the new value before it
  // threw, so the switch keeps the requested one rather than going back to a value that may be
  // stale.
  const setEnabled = useCallback((value: boolean) => {
    const request = ++latestRequest.current;
    const revisionAtRequest = getSettingsRevision();
    setPending({ value, source: sourceRef.current });
    updateSettings({ diagnosticsEnabled: value }).then(
      () => {
        if (request === latestRequest.current) setPending(null);
      },
      () => {
        if (request !== latestRequest.current) return;
        if (getSettingsRevision() !== revisionAtRequest) setPending(null);
      },
    );
  }, []);

  const shown = pending && pending.source === source ? pending.value : saved;
  return { enabled: shown, setEnabled };
}
