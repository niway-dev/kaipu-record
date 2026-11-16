import { useCallback, useEffect, useRef, useState } from "react";
import { toLibraryVideo } from "@renderer/features/library/map-item";
import type { LibraryVideo } from "@renderer/features/library/types";

export interface SourceCaptures {
  /** This video's frame captures, newest first. */
  captures: LibraryVideo[];
  /** True once a read has landed, so "no captures" is never shown before the first one. */
  loaded: boolean;
  /** Re-read the library now; resolves when the list on screen is at least that new. */
  refresh(): Promise<void>;
  /**
   * The list as of the last read that landed, without waiting for a render: a handler that
   * awaited `refresh()` reads it here, because its own `captures` is the render's copy.
   */
  latest(): LibraryVideo[];
}

/**
 * The screenshots taken from `videoAssetId` (one asset, or the opened recording plus every
 * recording the scene joins) with the editor's Capture frame button
 * (NIW2-764: `sourceVideoAssetId` in the sidecar), newest first. Read when `enabled` turns
 * on (the editor passes true from its first render: the top-bar Capture frame needs the
 * list for its duplicate check, panel open or not) and again whenever main broadcasts `library:changed`,
 * so a capture just saved shows up without reopening anything. The editor keeps no library
 * list of its own, so this reads `listLibraryItems` like `useSourceExports`. A failed read
 * keeps what was on screen.
 */
export function useSourceCaptures(
  videoAssetId: string | readonly string[] | null,
  enabled: boolean,
): SourceCaptures {
  // A stable key: callers build the array on every render, the effect must not re-run for it.
  const assetKey =
    videoAssetId === null
      ? ""
      : typeof videoAssetId === "string"
        ? videoAssetId
        : videoAssetId.join("\n");
  const [captures, setCaptures] = useState<LibraryVideo[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Only the latest read may write: an older one resolving last would show a stale list.
  const latestSeq = useRef(0);
  // The read whose result may land: a superseded read waits for it before resolving.
  const newest = useRef<Promise<void>>(Promise.resolve());
  const current = useRef<LibraryVideo[]>([]);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (!assetKey) return Promise.resolve();
    const assetIds = new Set(assetKey.split("\n"));
    const seq = ++latestSeq.current;
    const read = (async (): Promise<void> => {
      try {
        const result = await window.electronAPI.listLibraryItems();
        if (!alive.current) return;
        // A newer read started meanwhile: resolve when it lands, never with this older list.
        if (seq !== latestSeq.current) return await newest.current;
        current.current = result.items
          .filter(
            (item) =>
              item.kind === "screenshot" &&
              !!item.sourceVideoAssetId &&
              assetIds.has(item.sourceVideoAssetId),
          )
          .map(toLibraryVideo)
          .sort((a, b) => b.createdAt - a.createdAt);
        setCaptures(current.current);
        setLoaded(true);
      } catch {
        // Keep the previous list; a capture is a convenience, never a blocker.
      }
    })();
    newest.current = read;
    return read;
  }, [assetKey]);
  const latest = useCallback((): LibraryVideo[] => current.current, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    return window.electronAPI.onLibraryChanged(() => void refresh());
  }, [enabled, refresh]);

  return { captures, loaded, refresh, latest };
}
