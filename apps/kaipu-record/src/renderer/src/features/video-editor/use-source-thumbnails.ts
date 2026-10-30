import { useEffect, useState } from "react";
import { CanvasSink, type Input } from "mediabunny";
import { openRecordingInput } from "@renderer/lib/open-recording-input";

export interface SourceThumbnail {
  sourceTime: number;
  url: string;
}

/** The SOURCE range a companion file has footage for: `[start, end)`. */
export interface CoveredRange {
  start: number;
  end: number;
}

/** A companion file's filmstrip and where it has footage (null until decoded). */
export interface CompanionThumbnails {
  thumbnails: SourceThumbnail[];
  covered: CoveredRange | null;
}

const THUMB_WIDTH = 160;
const THUMB_COUNT = 24;
/** Recordings whose thumbnails stay decoded (~250 KB each), so re-opening the editor is free. */
const CACHE_LIMIT = 8;

interface CachedThumbnail {
  sourceTime: number;
  blob: Blob;
}

interface CachedStrip {
  frames: CachedThumbnail[];
  covered: CoveredRange;
}

// Insertion order = recency (a Map iterates oldest first); `cacheGet` re-inserts to refresh.
const cache = new Map<string, CachedStrip>();

function cacheGet(key: string): CachedStrip | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: CachedStrip): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Where to decode a companion file: the same evenly spaced SOURCE times as the screen's
 * filmstrip, moved into the companion's own time, keeping only those it has a frame for
 * (`[0, mediaDuration)`; an unknown duration bounds nothing past the start).
 */
export function companionSampleTimes(
  sourceDuration: number,
  count: number,
  offsetSeconds: number,
  mediaDuration: number,
): number[] {
  const end = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : Infinity;
  return Array.from(
    { length: count },
    (_, i) => ((i + 0.5) / count) * sourceDuration - offsetSeconds,
  ).filter((t) => t >= 0 && t < end);
}

/**
 * The SOURCE range a companion file covers: from its first frame (source time = its own
 * time + the offset) to its last. An unknown duration bounds nothing past the start, like
 * {@link companionSampleTimes}.
 */
export function companionCoveredRange(offsetSeconds: number, mediaDuration: number): CoveredRange {
  const known = Number.isFinite(mediaDuration) && mediaDuration > 0;
  return { start: offsetSeconds, end: known ? offsetSeconds + mediaDuration : Infinity };
}

/** Test seam: forget every cached recording. */
export function __resetSourceThumbnailCacheForTests(): void {
  cache.clear();
}

/**
 * Decodes a fixed set of evenly spaced frames from the SOURCE recording, once.
 * Cuts never invalidate this cache — blocks pick the nearest thumbnails by source
 * time — so we never re-decode while editing. Frames are decoded through Range
 * requests (not a full-file read) and kept per recording in a small LRU.
 */
export function useSourceThumbnails(mediaUrl: string, durationSeconds: number): SourceThumbnail[] {
  return useThumbnailStrip(mediaUrl, durationSeconds).thumbnails;
}

/**
 * {@link useSourceThumbnails} for a file played alongside the recording (the webcam, ADR
 * 0032) whose own time is source time − `offsetSeconds`, and which may start after or end
 * before the screen: frames are decoded at its own time and reported at SOURCE time, so
 * the same `thumbnailsForRange` lookups work for both, and `covered` says where it has
 * footage at all. The cache is keyed by URL and offset, so the screen and webcam
 * filmstrips of one recording never collide. An empty `mediaUrl` decodes nothing (a
 * recording without a webcam).
 */
export function useCompanionThumbnails(
  mediaUrl: string,
  durationSeconds: number,
  offsetSeconds: number,
): CompanionThumbnails {
  return useThumbnailStrip(mediaUrl, durationSeconds, offsetSeconds);
}

const EMPTY: CompanionThumbnails = { thumbnails: [], covered: null };

function useThumbnailStrip(
  mediaUrl: string,
  durationSeconds: number,
  companionOffsetSeconds?: number,
): CompanionThumbnails {
  const [strip, setStrip] = useState<CompanionThumbnails>(EMPTY);

  useEffect(() => {
    if (!mediaUrl) {
      setStrip(EMPTY);
      return;
    }
    let cancelled = false;
    let input: Input | null = null;
    const urls: string[] = [];
    const companion = companionOffsetSeconds !== undefined;
    const offsetSeconds = companionOffsetSeconds ?? 0;
    const key = `${mediaUrl}|${durationSeconds}|${companion ? offsetSeconds : "source"}`;

    // Object URLs are created per mount (and revoked on unmount); the cache holds Blobs.
    const publish = (cached: CachedStrip): void => {
      setStrip({
        thumbnails: cached.frames.map((frame) => {
          const url = URL.createObjectURL(frame.blob);
          urls.push(url);
          return { sourceTime: frame.sourceTime, url };
        }),
        covered: cached.covered,
      });
    };

    const cleanup = (): void => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      // Also aborts in-flight Range requests if the effect is torn down mid-decode.
      input?.dispose();
    };

    const cached = cacheGet(key);
    if (cached) {
      publish(cached);
      return cleanup;
    }

    void (async () => {
      try {
        input = openRecordingInput(mediaUrl);
        const track = await input.getPrimaryVideoTrack();
        if (!track || cancelled) return;
        const sink = new CanvasSink(track, { width: THUMB_WIDTH });
        const mediaDuration = companion
          ? await track.computeDuration().catch(() => Number.NaN)
          : Number.NaN;
        // The screen recording is the source: it covers all of it.
        const covered = companion
          ? companionCoveredRange(offsetSeconds, mediaDuration)
          : { start: 0, end: Infinity };
        const timestamps = companion
          ? companionSampleTimes(durationSeconds, THUMB_COUNT, offsetSeconds, mediaDuration)
          : Array.from(
              { length: THUMB_COUNT },
              (_, i) => ((i + 0.5) / THUMB_COUNT) * durationSeconds,
            );
        if (cancelled) return;
        const decoded: CachedThumbnail[] = [];
        for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
          if (cancelled) return; // cancelled mid-stream: stop decoding further frames
          if (!wrapped) continue;
          const canvas = wrapped.canvas as HTMLCanvasElement;
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.6),
          );
          if (!blob) continue;
          if (cancelled) return;
          decoded.push({ sourceTime: wrapped.timestamp + offsetSeconds, blob });
        }
        if (cancelled) return;
        // An empty result means every frame failed to encode: don't pin that failure in the cache.
        if (decoded.length > 0) cacheSet(key, { frames: decoded, covered });
        publish({ frames: decoded, covered });
      } catch {
        // Thumbnails are cosmetic; a decode failure must never break the editor.
      } finally {
        // Frees the UrlSource's cache and connections as soon as the work is done.
        input?.dispose();
      }
    })();

    return cleanup;
  }, [mediaUrl, durationSeconds, companionOffsetSeconds]);

  return strip;
}
