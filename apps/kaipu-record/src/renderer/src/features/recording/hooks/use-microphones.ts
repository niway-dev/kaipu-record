import { useEffect, useState } from "react";
import type { Microphone } from "@renderer/features/recording/types";

/**
 * Enumerates audio-input devices, and refreshes when devices are plugged or unplugged.
 *
 * It does NOT open the microphone to do it. Opening a stream just to read labels turns on
 * the OS microphone indicator — the user watches their own audio meter move on a page
 * where nothing is being recorded — and it used to happen on every mount of the Record
 * page, which is the app's default route. So: enumerate first, and open a stream only if
 * the OS is still hiding every label, which is the one case where there is no other way
 * to ask. Once permission has been granted, `enumerateDevices` returns real labels on its
 * own and the probe never runs again.
 */
export function useMicrophones(): Microphone[] {
  const [microphones, setMicrophones] = useState<Microphone[]>([]);

  useEffect(() => {
    let cancelled = false;

    const audioInputs = async (): Promise<MediaDeviceInfo[]> => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return systemDefaultFirst(devices.filter((device) => device.kind === "audioinput"));
    };

    const load = async (): Promise<void> => {
      let inputs = await audioInputs();

      // Every label blank means the OS has not granted the microphone yet (a granted
      // device keeps its name without a live stream). Opening one briefly is the only
      // way to ask, so it stays — as a fallback, not as the default path.
      if (inputs.length > 0 && inputs.every((device) => device.label === "")) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
          inputs = await audioInputs();
        } catch {
          // Denied — fall through and label them by ordinal below.
        }
      }
      let unnamed = 0;
      const mics = inputs.map((device) => ({
        deviceId: device.deviceId,
        // Fall back to a stable ordinal only for devices the OS won't name yet.
        label: device.label || `Microphone ${++unnamed}`,
      }));
      if (!cancelled) setMicrophones(mics);
    };

    void load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", load);
    };
  }, []);

  return microphones;
}

/**
 * The audio inputs without the "default" alias, the system's default input first. The
 * alias is the same device under a second id (Chromium gives it the real one's `groupId`);
 * listing it would show that device twice. First, because a first launch picks the head of
 * the list: the input macOS uses by default, not whichever one it happens to list first.
 */
export function systemDefaultFirst(inputs: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const alias = inputs.find((device) => device.deviceId === "default");
  const devices = inputs.filter((device) => device.deviceId !== "default");
  if (!alias) return devices;
  // By group when Chromium gives one; by name otherwise ("Default - Yeti Nano" → "Yeti Nano").
  const index = devices.findIndex((device) =>
    alias.groupId !== ""
      ? device.groupId === alias.groupId
      : device.label !== "" && alias.label.endsWith(device.label),
  );
  if (index <= 0) return devices;
  return [devices[index]!, ...devices.slice(0, index), ...devices.slice(index + 1)];
}
