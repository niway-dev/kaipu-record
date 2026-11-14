import { useEffect, useState } from "react";
import { AudioSampleSink, type Input } from "mediabunny";
import { openRecordingInput } from "@renderer/lib/open-recording-input";
import { PeakAccumulator, referenceLevel } from "./audio-peaks";

/** The recording's loudness, ready to draw. `filled` buckets from the start are decoded. */
export interface AudioPeaks {
  peaks: Float32Array;
  filled: number;
  /** The peak that draws as a full-height bar (see `referenceLevel`). */
  reference: number;
  /** True once the whole recording is decoded; false for the partial peaks published on the way. */
  complete: boolean;
}

/** Peaks that stay decoded (about 1.3 MB for a 54-minute take): the last 8 recordings. */
const CACHE_LIMIT = 8;
/** Work this long, then hand the thread back so the editor keeps painting and typing. */
const SLICE_MS = 8;
/** How often the waveform grows on screen while the decode runs. */
const PUBLISH_EVERY_MS = 400;

// Insertion order = recency (a Map iterates oldest first); `cacheGet` re-inserts to refresh.
const cache = new Map<string, AudioPeaks>();

function cacheGet(key: string): AudioPeaks | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: AudioPeaks): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test seam: forget every cached recording. */
export function __resetAudioPeaksCacheForTests(): void {
  cache.clear();
}

/**
 * Loudness peaks of the SOURCE recording's audio, decoded once per recording and reduced
 * as they stream (100 buckets per second), so the waveform draws without holding the
 * decoded audio. The result grows left to right while the decode runs; the finished peaks
 * are kept per recording in a small LRU. Cuts never invalidate it: the lane reads the
 * peaks by source time.
 *
 * Null without a media url, without an audio track, or if decoding fails: the
 * waveform is cosmetic and must never break the editor.
 */
export function useAudioPeaks(mediaUrl: string, durationSeconds: number): AudioPeaks | null {
  const [audioPeaks, setAudioPeaks] = useState<AudioPeaks | null>(null);

  useEffect(() => {
    if (!mediaUrl || !(durationSeconds > 0)) {
      setAudioPeaks(null);
      return;
    }
    let cancelled = false;
    let input: Input | null = null;
    const key = `${mediaUrl}|${durationSeconds}`;

    const cleanup = (): void => {
      cancelled = true;
      // Also aborts in-flight Range requests if the effect is torn down mid-decode.
      input?.dispose();
    };

    const cached = cacheGet(key);
    if (cached) {
      setAudioPeaks(cached);
      return cleanup;
    }
    setAudioPeaks(null);

    void (async () => {
      try {
        input = openRecordingInput(mediaUrl);
        const track = await input.getPrimaryAudioTrack();
        if (!track || cancelled) return;
        const sink = new AudioSampleSink(track);
        const accumulator = new PeakAccumulator(durationSeconds);
        // A new wrapper per publish so React re-renders; the array underneath is shared.
        const snapshot = (complete: boolean): AudioPeaks => ({
          peaks: accumulator.peaks,
          filled: accumulator.filled,
          reference: referenceLevel(accumulator.peaks, accumulator.filled),
          complete,
        });

        let sliceStart = performance.now();
        let lastPublish = sliceStart;
        for await (const sample of sink.samples()) {
          if (cancelled) {
            sample.close();
            return;
          }
          try {
            const planes: Float32Array[] = [];
            for (let planeIndex = 0; planeIndex < sample.numberOfChannels; planeIndex++) {
              const options = { format: "f32-planar", planeIndex } as const;
              const plane = new Float32Array(sample.allocationSize(options) / 4);
              sample.copyTo(plane, options);
              planes.push(plane);
            }
            accumulator.add(sample.timestamp, sample.sampleRate, planes);
          } finally {
            sample.close();
          }
          const now = performance.now();
          if (now - lastPublish >= PUBLISH_EVERY_MS) {
            lastPublish = now;
            setAudioPeaks(snapshot(false));
          }
          if (now - sliceStart >= SLICE_MS) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            sliceStart = performance.now();
          }
        }
        if (cancelled) return;
        const done = snapshot(true);
        cacheSet(key, done);
        setAudioPeaks(done);
      } catch {
        // The waveform is cosmetic; a decode failure must never break the editor. Drop
        // the partial peaks so the lane falls back to its empty-state look.
        if (!cancelled) setAudioPeaks(null);
      } finally {
        // Frees the UrlSource's cache and connections as soon as the work is done.
        input?.dispose();
      }
    })();

    return cleanup;
  }, [mediaUrl, durationSeconds]);

  return audioPeaks;
}
