import { useEffect, useRef } from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import { healOrphanMetadata } from "@renderer/features/library/media/heal-orphan-metadata";
import { toLibraryVideo } from "@renderer/features/library/map-recording";

/** Decode a couple of files at a time — a lost `.kaipu/` can orphan a whole vault. */
const MAX_CONCURRENT_HEALS = 3;

/**
 * A recording whose metadata was never derived from the file: no duration (shows
 * `0:00`, editor disabled) or no poster (generic icon). Screenshots also carry a
 * zero duration, so they are explicitly excluded.
 */
function isOrphan(video: LibraryVideo): boolean {
  return video.kind === "recording" && (video.durationSeconds === 0 || !video.thumbnailUrl);
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) await worker(items[index++]);
  });
  await Promise.all(runners);
}

/**
 * Self-heals orphaned recordings in the background: decodes duration + poster
 * from the file (renderer-only — WebCodecs), persists them to the sidecar via
 * main, and reports each patched item through `onHealed` so the list updates in
 * place without a full reload. Realizes "heal on scan" — it runs whenever the
 * `videos` list changes (mount + Sync + vault switch).
 *
 * The `attempted` set dedupes work: an id is added before its heal starts so a
 * re-render (each patch, or a Sync) doesn't relaunch an in-flight heal. Crucially
 * an in-flight heal is NEVER cancelled by that re-render — cancelling before the
 * backfill would leave the id marked attempted yet never persisted, permanently
 * un-healed. A heal that fails/reads nothing is removed from `attempted` so a
 * later scan retries. Only `onHealed` (a state update) is gated, on unmount.
 */
export function useOrphanHeal(
  videos: LibraryVideo[],
  onHealed: (video: LibraryVideo) => void,
): void {
  const attempted = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  const onHealedRef = useRef(onHealed);
  onHealedRef.current = onHealed;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const pending = videos.filter((v) => isOrphan(v) && !attempted.current.has(v.id));
    if (pending.length === 0) return;
    for (const v of pending) attempted.current.add(v.id);

    void runPool(pending, MAX_CONCURRENT_HEALS, async (v) => {
      try {
        const meta = await healOrphanMetadata(v.id);
        if (!meta) {
          attempted.current.delete(v.id); // unreadable now — let a later scan retry
          return;
        }
        const updated = await window.electronAPI.backfillLocalRecordingMeta(v.id, meta);
        if (updated && mounted.current) onHealedRef.current(toLibraryVideo(updated));
      } catch {
        attempted.current.delete(v.id); // transient failure — allow a retry
      }
    });
  }, [videos]);
}
