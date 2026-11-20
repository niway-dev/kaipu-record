import { useEffect, useRef } from "react";
import type { StartOutcome } from "./transcription-job-store";

/**
 * Items the app has already tried to re-transcribe on its own in this session. Module-level so two
 * mounted hooks for one item (the panel and the Library detail can both be on screen) share one
 * trigger. Main keeps the durable guard, one automatic attempt per media content, across restarts.
 */
const claimed = new Set<string>();

/** Test hook: forget every claim. */
export function resetAutoRetranscribe(): void {
  claimed.clear();
}

/**
 * Starts a transcription job by itself the first time `armed` is true for an item, and never again
 * from the renderer: a cancel or a failure must not make the app retry in a loop. The claim is
 * given back only when nothing started (`null` or a refusal), so a later moment can try again.
 */
export function useAutoRetranscribe(
  itemId: string,
  armed: boolean,
  start: () => Promise<StartOutcome | null>,
): void {
  const latest = useRef(start);
  latest.current = start;

  useEffect(() => {
    if (!armed || claimed.has(itemId)) return;
    claimed.add(itemId);
    const release = (): void => {
      claimed.delete(itemId);
    };
    latest
      .current()
      .then((outcome) => {
        if (outcome === null || outcome.status === "refused") release();
      })
      .catch(release);
  }, [armed, itemId]);
}
