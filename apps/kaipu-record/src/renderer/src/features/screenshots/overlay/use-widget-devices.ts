import { useCallback, useEffect, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type { RecordingSettings } from "@shared/types/ipc";
import type { AppSettings } from "@shared/types";
import {
  getSettingsSnapshot,
  loadSettings,
  subscribeSettings,
  useSettings,
} from "@renderer/features/settings/settings-store";
import { useCameras } from "@renderer/features/camera-settings/use-camera-settings";
import { useMicrophones } from "@renderer/features/recording/hooks/use-microphones";
import type { RecordingTogglesApi } from "./use-overlay-toggles";

export interface WidgetDevice {
  id: string;
  label: string;
}

const wholeSettings = (settings: AppSettings): AppSettings => settings;

/** `over` while the store had not answered yet when the camera was picked. */
const NOT_LOADED = Symbol("settings not loaded");

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
 * Enumerating devices opens nothing by itself. But when every microphone label is blank,
 * `useMicrophones` falls back to a `getUserMedia` probe, which can briefly open the microphone
 * and show the OS permission prompt or indicator. While the overlay is on capture intent
 * (`enabled` false) it reads nothing and never probes. On record intent it may, including
 * after a switch from capture, because `enabled` follows the intent.
 */
export function useWidgetDevices(
  api: RecordingTogglesApi & Partial<Pick<KaipuElectronAPI, "updateSettings">>,
  enabled: boolean,
): WidgetDevices {
  const microphones = useMicrophones(enabled);
  const cameras = useCameras(enabled);
  const [selectedMicrophone, setSelectedMicrophone] =
    useState<RecordingSettings["selectedMicrophone"]>(null);
  // The camera in use is what the window's settings store holds. One overlay window per display
  // mounts this hook: a camera picked in another window arrives as a settings broadcast, and
  // this window's widget follows it. A pick made here shows at once, until the store changes
  // (main's echo, or another window's choice), which is newer.
  // A pick made before the store's first read answered stands over that read, which was
  // computed before the choice; the next change after it (main's echo) is the newer one.
  const app = useSettings(wholeSettings);
  const savedCameraId = app?.cameraBubble?.deviceId ?? null;
  const [pick, setPick] = useState<{
    id: string;
    over: string | null | typeof NOT_LOADED;
  } | null>(null);
  const cameraId =
    pick && (pick.over === NOT_LOADED || pick.over === savedCameraId) ? pick.id : savedCameraId;
  // Follows every value the store takes, not the rendered one: React renders the latest value
  // and can skip the ones in between, so a camera that left the pick's baseline and came back
  // before a render would look like no change and revive the pick.
  useEffect(
    () =>
      subscribeSettings((published) => {
        const camera = published.cameraBubble?.deviceId ?? null;
        setPick((current) => {
          if (!current) return current;
          // Settled over the first read's value.
          if (current.over === NOT_LOADED) return { id: current.id, over: camera };
          // The store moved off the value the pick was made over: the pick is spent, so the
          // saved camera can come back to that value later without reviving it.
          return current.over === camera ? current : null;
        });
      }),
    [],
  );
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
      // What the store holds at this moment, not what was last rendered.
      const held = getSettingsSnapshot();
      setPick({ id, over: held ? (held.cameraBubble?.deviceId ?? null) : NOT_LOADED });
      // The whole bubble is written back, as the camera settings do: a partial would drop it.
      void loadSettings()
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
