import { useEffect, useState } from "react";
import { levelsFromTimeDomain } from "@renderer/features/recording/audio-levels";

/** Bars in the settings' meter (the engine's activity broadcast has 5; see `spreadLevels`). */
export const METER_BARS = 14;

const SILENT: number[] = Array.from({ length: METER_BARS }, () => 0);

/** About 15 updates a second is plenty for a meter and keeps React renders cheap. */
const FRAME_MS = 66;

/**
 * Meters one input device before a take. It opens `getUserMedia` for that device only while
 * `active` (the settings are open, the mic is on, nothing is recording) and releases the
 * tracks and the AudioContext as soon as `active` turns false, the device changes or the
 * component unmounts. During a take the engine already holds the mic, so the caller reads
 * the activity broadcast instead (opening it twice would double the OS mic indicator work).
 */
export function useMicLevelMeter(deviceId: string | null, active: boolean): number[] {
  const [levels, setLevels] = useState<number[]>(SILENT);

  useEffect(() => {
    if (!active || !deviceId || !navigator.mediaDevices?.getUserMedia) {
      setLevels(SILENT);
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;

    const release = (): void => {
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => {});
      stream = null;
      context = null;
    };

    void navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: { exact: deviceId } } })
      .then((opened) => {
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(opened).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let last = 0;
        const tick = (now: number): void => {
          frame = requestAnimationFrame(tick);
          if (now - last < FRAME_MS) return;
          last = now;
          analyser.getByteTimeDomainData(data);
          setLevels(levelsFromTimeDomain(data, METER_BARS));
        };
        frame = requestAnimationFrame(tick);
      })
      .catch(() => {
        // Denied or unplugged: the meter stays flat; the Record page shows the permission notice.
      });

    return () => {
      cancelled = true;
      release();
      setLevels(SILENT);
    };
  }, [deviceId, active]);

  return levels;
}

/** Spreads the engine's few bars over the meter's `METER_BARS`, interpolating between them. */
export function spreadLevels(source: readonly number[] | undefined, bars = METER_BARS): number[] {
  if (!source || source.length === 0) return SILENT;
  if (source.length === 1) return Array.from({ length: bars }, () => source[0]!);
  return Array.from({ length: bars }, (_, index) => {
    const position = (index / (bars - 1)) * (source.length - 1);
    const low = Math.floor(position);
    const high = Math.min(source.length - 1, low + 1);
    const fraction = position - low;
    return source[low]! * (1 - fraction) + source[high]! * fraction;
  });
}
