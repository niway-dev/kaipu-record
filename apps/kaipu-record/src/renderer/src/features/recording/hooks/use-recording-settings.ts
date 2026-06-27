import { useCallback, useEffect, useState } from "react";
import type { RecordingSettings } from "@shared/types";

const DEFAULT: RecordingSettings = {
  selectedSource: null,
  selectedMicrophone: null,
  isMicrophoneEnabled: true,
  isSystemAudioEnabled: false,
  isCameraEnabled: false,
};

export interface RecordingSettingsStore extends RecordingSettings {
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

  useEffect(() => {
    void window.electronAPI.getRecordingSettings().then(setSettings);
    return window.electronAPI.onRecordingSettingsChanged(setSettings);
  }, []);

  const update = useCallback((patch: Partial<RecordingSettings>) => {
    setSettings((current) => ({ ...current, ...patch })); // optimistic; broadcast reconciles
    window.electronAPI.updateRecordingSettings(patch);
  }, []);

  return { ...settings, update };
}
