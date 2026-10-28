import { useCallback, useEffect, useState } from "react";
import type { RecordingSettings } from "@shared/types";

const DEFAULT: RecordingSettings = {
  selectedSource: null,
  selectedMicrophone: null,
  isMicrophoneEnabled: true,
  isSystemAudioEnabled: false,
  isCameraEnabled: false,
  area: null,
};

export interface RecordingSettingsStore extends RecordingSettings {
  /** False until main's settings have arrived: until then the values are the defaults. */
  loaded: boolean;
  update(patch: Partial<RecordingSettings>): void;
}

/**
 * Shared recording settings (source, capture toggles, mic) — the main process is
 * the single source of truth, so the Record page and Capture Panel stay in sync.
 * Queries on mount, subscribes to changes, and writes optimistically (the hub
 * broadcasts back the authoritative state and also drives the camera bubble).
 */
export function useRecordingSettings(): RecordingSettingsStore {
  const [settings, setSettings] = useState<RecordingSettings>(DEFAULT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const receive = (next: RecordingSettings): void => {
      setSettings(next);
      setLoaded(true);
    };
    void window.electronAPI.getRecordingSettings().then(receive);
    return window.electronAPI.onRecordingSettingsChanged(receive);
  }, []);

  const update = useCallback((patch: Partial<RecordingSettings>) => {
    setSettings((current) => ({ ...current, ...patch })); // optimistic; broadcast reconciles
    window.electronAPI.updateRecordingSettings(patch);
  }, []);

  return { ...settings, loaded, update };
}
