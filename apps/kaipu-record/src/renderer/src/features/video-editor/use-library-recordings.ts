import { useEffect, useState } from "react";
import { toLibraryVideo } from "@renderer/features/library/map-item";
import type { LibraryVideo } from "@renderer/features/library/types";

export interface LibraryRecordings {
  /** Every Library item, mapped; the Add from Library panel keeps the recordings it can join. */
  videos: LibraryVideo[];
  /** True once a read has landed (or failed), so "no recordings" is never said before it. */
  loaded: boolean;
}

/**
 * The Library's items for the Add from Library panel (NIW2-782). One `listLibraryItems()` read
 * each time `enabled` turns on, and another whenever main broadcasts `library:changed` while it
 * is on, like `useSourceCaptures`. Deliberately not `useLocalLibrary`: that hook also
 * re-confirms the cloud catalog, reports errors as toasts and heals orphan metadata
 * (decoding video), none of which belongs in the editor. A failed read ends loading with an
 * empty list rather than loading for ever.
 */
export function useLibraryRecordings(enabled: boolean): LibraryRecordings {
  const [state, setState] = useState<LibraryRecordings>({ videos: [], loaded: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // Only the latest read may write: an older one resolving last would show a stale list.
    let latest = 0;
    const read = async (): Promise<void> => {
      const seq = ++latest;
      try {
        const result = await window.electronAPI.listLibraryItems();
        if (alive && seq === latest) {
          setState({ videos: result.items.map(toLibraryVideo), loaded: true });
        }
      } catch {
        if (alive && seq === latest) setState((prev) => ({ ...prev, loaded: true }));
      }
    };
    void read();
    const stop = window.electronAPI.onLibraryChanged(() => void read());
    return () => {
      alive = false;
      stop();
    };
  }, [enabled]);
  return state;
}
