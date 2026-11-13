import { useCallback, useEffect, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type { RecordingSettings } from "@shared/types/ipc";
import { useCameras } from "@renderer/features/camera-settings/use-camera-settings";
import { useMicrophones } from "@renderer/features/recording/hooks/use-microphones";
import type { RecordingTogglesApi } from "./use-overlay-toggles";

export interface WidgetDevice {
  id: string;
  label: string;
}

/** The devices the widget's Microphone and Camera chevrons offer, and the ones in use. */
export interface WidgetDevices {
  microphones: WidgetDevice[];
  /** `null` is the system default. */
  microphoneId: string | null;
  selectMicrophone(id: string): void;
  cameras: WidgetDevice[];
  cameraId: string | null;
  selectCamera(id: string): void;
}

/**
 * The same choices as Home and the capture panel, written to the same places: the microphone
 * through the shared `RecordingSettings`, the camera through `AppSettings.cameraBubble.deviceId`.
 * Enumerating devices opens nothing, and a screenshot overlay (`enabled` false) reads nothing.
 */
export function useWidgetDevices(
  api: RecordingTogglesApi & Partial<Pick<KaipuElectronAPI, "updateSettings">>,
  enabled: boolean,
): WidgetDevices {
  const microphones = useMicrophones(enabled);
  const cameras = useCameras(enabled);
  const [selectedMicrophone, setSelectedMicrophone] =
    useState<RecordingSettings["selectedMicrophone"]>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  // Counts every microphone change after mount (a choice or a broadcast), so a late first
  // read can tell it is older than what the window already shows.
  const microphoneRevision = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const revisionAtRequest = microphoneRevision.current;
    api
      .getRecordingSettings()
      .then((current) => {
        if (live && microphoneRevision.current === revisionAtRequest) {
          setSelectedMicrophone(current.selectedMicrophone);
        }
      })
      .catch(() => {});
    api
      .getSettings?.()
      .then((app) => {
        if (live) setCameraId(app.cameraBubble?.deviceId ?? null);
      })
      .catch(() => {});
    const unsubscribe = api.onRecordingSettingsChanged((current) => {
      microphoneRevision.current += 1;
      setSelectedMicrophone(current.selectedMicrophone);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api, enabled]);

  const selectMicrophone = useCallback(
    (id: string): void => {
      const microphone = microphones.find((candidate) => candidate.deviceId === id);
      if (!microphone) return;
      microphoneRevision.current += 1;
      setSelectedMicrophone(microphone);
      api.updateRecordingSettings({ selectedMicrophone: microphone });
    },
    [api, microphones],
  );

  const selectCamera = useCallback(
    (id: string): void => {
      setCameraId(id);
      // The whole bubble is written back, as the camera settings do: a partial would drop it.
      void api
        .getSettings?.()
        .then((app) =>
          api.updateSettings?.({ cameraBubble: { ...app.cameraBubble, deviceId: id } }),
        )
        .catch(() => {});
    },
    [api],
  );

  return {
    microphones: microphones.map((mic) => ({ id: mic.deviceId, label: mic.label })),
    microphoneId: selectedMicrophone?.deviceId ?? null,
    selectMicrophone,
    cameras: cameras.map((camera) => ({ id: camera.deviceId, label: camera.label })),
    cameraId,
    selectCamera,
  };
}
