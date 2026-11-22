import { useEffect, useRef } from "react";
import type { StartOutcome } from "./transcription-job-store";

/**
 * Claims (item plus media content) the app has already tried to re-transcribe on its own in this
 * session. Module-level so two mounted hooks for one item (the panel and the Library detail can
 * both be on screen) share one trigger. Main keeps the durable guard, one automatic attempt per
 * media content, across restarts.
 */
const claimed = new Set<string>();

/** Test hook: forget every claim. */
export function resetAutoRetranscribe(): void {
  claimed.clear();
}

/**
 * Starts a transcription job by itself the first time `armed` is true for a claim key (the item
 * plus the media content that armed it), and never again for that key from the renderer: a cancel,
 * a failure or a refusal must not make the app retry in a loop (an automatic `busy` refusal is quiet,
 * so the control re-arms at once). The claim is given back only when nothing was attempted (`null`),
 * so a later moment can try again.
 */
export function useAutoRetranscribe(
  claimKey: string,
  armed: boolean,
  start: () => Promise<StartOutcome | null>,
): void {
  const latest = useRef(start);
  latest.current = start;

  useEffect(() => {
    if (!armed || claimed.has(claimKey)) return;
    claimed.add(claimKey);
    const release = (): void => {
      claimed.delete(claimKey);
    };
    latest
      .current()
      .then((outcome) => {
        if (outcome === null) release();
      })
      .catch(release);
  }, [armed, claimKey]);
}
