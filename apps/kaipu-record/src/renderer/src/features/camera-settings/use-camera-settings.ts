import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings, CameraAccessStatus } from "@shared/types";
import { DEFAULT_CAMERA_BUBBLE, type CameraBubbleSettings } from "@shared/camera-bubble";

export interface CameraDevice {
  deviceId: string;
  /** Empty while the OS hides names (camera not granted yet). */
  label: string;
}

export interface CameraSettingsStore {
  bubble: CameraBubbleSettings;
  /** Applies at once on screen; persisting is throttled so a slider drag is not a disk write per pixel. */
  update(patch: Partial<CameraBubbleSettings>): void;
  cameras: CameraDevice[];
  access: CameraAccessStatus;
  openSystemSettings(): void;
}

/** How often a burst of changes (slider drag, held arrow key) reaches main. */
const PERSIST_EVERY_MS = 60;

/**
 * Lists the `videoinput` devices, refreshed on plug/unplug. Never opens the camera to
 * read labels (that would light the camera on a page where nothing records); unnamed
 * devices are labelled by ordinal at render time.
 */
export function useCameras(): CameraDevice[] {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const devices = await media.enumerateDevices();
        if (cancelled) return;
        setCameras(
          devices
            .filter((device) => device.kind === "videoinput" && device.deviceId !== "")
            .map((device) => ({ deviceId: device.deviceId, label: device.label })),
        );
      } catch {
        if (!cancelled) setCameras([]);
      }
    };
    void load();
    media.addEventListener?.("devicechange", load);
    return () => {
      cancelled = true;
      media.removeEventListener?.("devicechange", load);
    };
  }, []);
  return cameras;
}

/** Where camera access is read from: the preload bridge, or a test's fake. */
export interface CameraAccessSource {
  getCameraAccessStatus?: () => Promise<CameraAccessStatus>;
}

/**
 * Camera access, re-read when the window regains focus (it is granted in System Settings).
 * The Record page, the tray panel and the record overlay all read it here. `enabled` false
 * reads nothing (a screenshot overlay has no camera toggle); a source without the call
 * reads "unknown", which never blocks.
 */
export function useCameraAccess(
  source: CameraAccessSource = window.electronAPI,
  enabled = true,
): CameraAccessStatus {
  const [access, setAccess] = useState<CameraAccessStatus>("unknown");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const check = (): void => {
      source
        .getCameraAccessStatus?.()
        .then((next) => {
          if (!cancelled) setAccess(next);
        })
        .catch(() => {});
    };
    check();
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
    };
  }, [source, enabled]);
  return access;
}

/**
 * The camera bubble settings (persisted in AppSettings by main), plus what the settings
 * UI needs around them: the cameras to choose from and whether access is blocked.
 * Query on mount + subscribe, like every cross-window setting.
 */
export function useCameraSettings(): CameraSettingsStore {
  const [bubble, setBubble] = useState<CameraBubbleSettings>(DEFAULT_CAMERA_BUBBLE);
  const latest = useRef(bubble);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(0);
  // Until the first read lands, `latest` holds the defaults, not the saved value: a change
  // made then is kept as a patch and merged over the saved value, never over the defaults
  // (which would wipe the saved device and shape).
  const loaded = useRef(false);
  const early = useRef<Partial<CameraBubbleSettings> | null>(null);

  const send = useCallback((): void => {
    timer.current = null;
    lastSent.current = Date.now();
    void window.electronAPI.updateSettings({ cameraBubble: latest.current });
  }, []);

  useEffect(() => {
    const accept = (settings: AppSettings): void => {
      // A change of ours still waiting to be sent wins over the echo of an older one.
      if (timer.current) return;
      const patch = early.current;
      early.current = null;
      loaded.current = true;
      const next = patch ? { ...settings.cameraBubble, ...patch } : settings.cameraBubble;
      latest.current = next;
      setBubble(next);
      if (patch) send();
    };
    void window.electronAPI.getSettings().then(accept);
    const unsubscribe = window.electronAPI.onSettingsChanged(accept);
    return () => {
      unsubscribe();
      // A change still throttled when the popover or drawer closes is sent now, not lost.
      if (timer.current) {
        clearTimeout(timer.current);
        send();
      }
    };
  }, [send]);

  const update = useCallback(
    (patch: Partial<CameraBubbleSettings>): void => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setBubble(next);
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

  const cameras = useCameras();
  const access = useCameraAccess();
  const openSystemSettings = useCallback((): void => {
    void window.electronAPI.openSystemSettings("camera");
  }, []);

  return { bubble, update, cameras, access, openSystemSettings };
}
