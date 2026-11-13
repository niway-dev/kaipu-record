import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KaipuElectronAPI } from "@shared/types/electron-api";
import type { RecordingSettings } from "@shared/types/ipc";
import { DEFAULT_CAMERA_BUBBLE, type CameraBubbleShape } from "@shared/camera-bubble";
import { useCameraAccess } from "@renderer/features/camera-settings/use-camera-settings";
import type { InputToggleKey } from "./overlay-keys";

/** The bubble's look the overlay's placeholder needs (`AppSettings.cameraBubble`). */
export interface OverlayCameraBubble {
  size: number;
  shape: CameraBubbleShape;
  cornerRadius: number;
}

/**
 * The slice of the preload bridge the toggles use; tests pass a fake. Camera access and the
 * bubble settings are optional so a fake without them reads "unknown" and the defaults.
 */
export type RecordingTogglesApi = Pick<
  KaipuElectronAPI,
  "getRecordingSettings" | "updateRecordingSettings" | "onRecordingSettingsChanged"
> &
  Partial<Pick<KaipuElectronAPI, "getCameraAccessStatus" | "getSettings">>;

export interface OverlayToggles {
  microphone: boolean;
  systemAudio: boolean;
  camera: boolean;
  /**
   * Camera access is denied in the OS (`getCameraAccessStatus`, the same tri-state the
   * Record page and the tray read): the Camera toggle cannot turn on, only off.
   */
  cameraBlocked: boolean;
  /** The bubble's size, shape and corner (`AppSettings.cameraBubble`), for the placeholder. */
  cameraBubble: OverlayCameraBubble;
  /**
   * Flip an input. Returns what the input became, or `null` when nothing changed (a blocked
   * camera cannot turn on), so the key's toast never claims a switch that did not happen.
   */
  toggle(key: InputToggleKey): boolean | null;
}

/**
 * Mic, System audio and Camera as main holds them (the shared `RecordingSettings`): read on
 * mount, kept live by the broadcast, written optimistically. The same values the Record
 * page and the tray show, so a toggle here is a toggle everywhere.
 */
export function useOverlayToggles(api: RecordingTogglesApi, enabled = true): OverlayToggles {
  const [settings, setSettings] = useState<Pick<RecordingSettings, InputToggleKey>>({
    isMicrophoneEnabled: false,
    isSystemAudioEnabled: false,
    isCameraEnabled: false,
  });
  // The same camera-access read as the Record page and the tray tile.
  const access = useCameraAccess(api, enabled);
  // Counts every change after mount (a press or a broadcast), so a late first read can tell.
  const revision = useRef(0);
  const [bubble, setBubble] = useState<OverlayCameraBubble>({
    size: DEFAULT_CAMERA_BUBBLE.size,
    shape: DEFAULT_CAMERA_BUBBLE.shape,
    cornerRadius: DEFAULT_CAMERA_BUBBLE.cornerRadius,
  });
  useEffect(() => {
    // A screenshot overlay has no inputs to show: it never reads recording settings.
    if (!enabled) return;
    let live = true;
    // The first read can answer after a press or a broadcast: that reply is older than what
    // the window already shows, so it only applies when nothing changed since the request.
    const revisionAtRequest = revision.current;
    api
      .getRecordingSettings()
      .then((current) => {
        if (live && revision.current === revisionAtRequest) setSettings(current);
      })
      .catch(() => {});
    api
      .getSettings?.()
      .then((app) => {
        if (live && app.cameraBubble) {
          setBubble({
            size: app.cameraBubble.size,
            shape: app.cameraBubble.shape,
            cornerRadius: app.cameraBubble.cornerRadius ?? DEFAULT_CAMERA_BUBBLE.cornerRadius,
          });
        }
      })
      .catch(() => {});
    const unsubscribe = api.onRecordingSettingsChanged((current) => {
      revision.current += 1;
      setSettings(current);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api, enabled]);
  const cameraBlocked = access === "blocked";
  const blockedRef = useRef(cameraBlocked);
  blockedRef.current = cameraBlocked;
  // Read through a ref so the write happens once per click, outside a state updater.
  const latest = useRef(settings);
  latest.current = settings;
  const toggle = useCallback(
    (key: InputToggleKey): boolean | null => {
      const next = !latest.current[key];
      // A blocked camera cannot be turned on from here either; one that is on can go off.
      if (key === "isCameraEnabled" && next && blockedRef.current) return null;
      latest.current = { ...latest.current, [key]: next };
      revision.current += 1;
      setSettings(latest.current);
      api.updateRecordingSettings({ [key]: next });
      return next;
    },
    [api],
  );
  return useMemo(
    () => ({
      microphone: settings.isMicrophoneEnabled,
      systemAudio: settings.isSystemAudioEnabled,
      camera: settings.isCameraEnabled,
      cameraBlocked,
      cameraBubble: bubble,
      toggle,
    }),
    [settings, cameraBlocked, bubble, toggle],
  );
}
