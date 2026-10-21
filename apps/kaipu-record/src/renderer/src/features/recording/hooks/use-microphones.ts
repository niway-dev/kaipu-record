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
      return devices.filter(
        (device) => device.kind === "audioinput" && device.deviceId !== "default",
      );
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
