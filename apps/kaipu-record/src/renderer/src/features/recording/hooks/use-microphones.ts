import { useEffect, useState } from "react";
import type { Microphone } from "@renderer/features/recording/types";

/**
 * Enumerates audio-input devices. Briefly opens an audio stream first so the OS
 * grants the mic permission and reveals device labels (otherwise `label` is ""),
 * and refreshes when devices are plugged/unplugged.
 */
export function useMicrophones(): Microphone[] {
  const [microphones, setMicrophones] = useState<Microphone[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // Permission denied — still enumerate, labels may be empty.
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(
        (device) => device.kind === "audioinput" && device.deviceId !== "default",
      );
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
