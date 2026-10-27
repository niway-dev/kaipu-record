import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "@shared/types";
import {
  DEFAULT_AUDIO_SETTINGS,
  sanitizeAudioSettings,
  type AudioSettings,
} from "@shared/audio-settings";

export interface AudioSettingsStore {
  audio: AudioSettings;
  /** Applies at once on screen; persisting is throttled so a slider drag is not a disk write per pixel. */
  update(patch: Partial<AudioSettings>): void;
}

/** How often a burst of changes (slider drag, held arrow key) reaches main. */
const PERSIST_EVERY_MS = 60;

/**
 * The audio settings (persisted in `AppSettings.audio` by main). Query on mount +
 * subscribe, like every cross-window setting. The whole `audio` object is what main
 * replaces, so every write spreads the current value.
 *
 * Same throttle and early-change rules as `useCameraSettings`: a change made before the
 * saved value has loaded is merged over it, never over the defaults, and a change still
 * throttled when the settings close is sent, not lost.
 */
export function useAudioSettings(): AudioSettingsStore {
  const [audio, setAudio] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const latest = useRef(audio);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(0);
  const loaded = useRef(false);
  const early = useRef<Partial<AudioSettings> | null>(null);

  const send = useCallback((): void => {
    timer.current = null;
    lastSent.current = Date.now();
    void window.electronAPI.updateSettings({ audio: latest.current });
  }, []);

  useEffect(() => {
    const accept = (settings: AppSettings): void => {
      // A change of ours still waiting to be sent wins over the echo of an older one.
      if (timer.current) return;
      const patch = early.current;
      early.current = null;
      loaded.current = true;
      const saved = sanitizeAudioSettings(settings.audio);
      const next = patch ? { ...saved, ...patch } : saved;
      latest.current = next;
      setAudio(next);
      if (patch) send();
    };
    void window.electronAPI.getSettings().then(accept);
    const unsubscribe = window.electronAPI.onSettingsChanged(accept);
    return () => {
      unsubscribe();
      if (timer.current) {
        clearTimeout(timer.current);
        send();
      }
    };
  }, [send]);

  const update = useCallback(
    (patch: Partial<AudioSettings>): void => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setAudio(next);
      if (!loaded.current) {
        early.current = { ...early.current, ...patch };
        return;
      }
      if (timer.current) return;
      const wait = PERSIST_EVERY_MS - (Date.now() - lastSent.current);
      if (wait <= 0) send();
      else timer.current = setTimeout(send, wait);
    },
    [send],
  );

  return { audio, update };
}
