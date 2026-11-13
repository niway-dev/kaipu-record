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
}

/**
 * The screenshots taken from `videoAssetId` with the editor's Capture frame button
 * (NIW2-764: `sourceVideoAssetId` in the sidecar), newest first. Read when `enabled` turns
 * on (the Captures panel opening) and again whenever main broadcasts `library:changed`,
 * so a capture just saved shows up without reopening anything. The editor keeps no library
 * list of its own, so this reads `listLibraryItems` like `useSourceExports`. A failed read
 * keeps what was on screen.
 */
export function useSourceCaptures(videoAssetId: string | null, enabled: boolean): SourceCaptures {
  const [captures, setCaptures] = useState<LibraryVideo[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Only the latest read may write: an older one resolving last would show a stale list.
  const latest = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!videoAssetId) return;
    const seq = ++latest.current;
    try {
      const result = await window.electronAPI.listLibraryItems();
      if (!alive.current || seq !== latest.current) return;
      setCaptures(
        result.items
          .filter((item) => item.kind === "screenshot" && item.sourceVideoAssetId === videoAssetId)
          .map(toLibraryVideo)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
      setLoaded(true);
    } catch {
      // Keep the previous list; a capture is a convenience, never a blocker.
    }
  }, [videoAssetId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    return window.electronAPI.onLibraryChanged(() => void refresh());
  }, [enabled, refresh]);

  return { captures, loaded, refresh };
}
