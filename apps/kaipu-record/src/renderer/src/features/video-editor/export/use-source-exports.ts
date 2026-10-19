import { useEffect, useState } from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import { toLibraryVideo } from "@renderer/features/library/map-item";

/**
 * The library items exported from `sourceAssetId` (lineage by `derivedFromAssetId`, ADR
 * 0003), re-read each time `enabled` turns on — the export sheet opening — so a file
 * exported or deleted since the last look is seen. The editor holds no library list of its
 * own; the library page has one already and passes it straight to the sheet.
 *
 * Reuse is a shortcut, never a requirement: a failed read leaves the list empty and every
 * row simply encodes.
 */
export function useSourceExports(sourceAssetId: string | null, enabled: boolean): LibraryVideo[] {
  const [exports, setExports] = useState<LibraryVideo[]>([]);
  useEffect(() => {
    if (!enabled || !sourceAssetId) return;
    let alive = true;
    window.electronAPI
      .listLibraryItems()
      .then((result) => {
        if (!alive) return;
        setExports(
          result.items
            .filter((item) => item.derivedFromAssetId === sourceAssetId)
            .map(toLibraryVideo),
        );
      })
      .catch(() => {
        if (alive) setExports([]);
      });
    return () => {
      alive = false;
    };
  }, [sourceAssetId, enabled]);
  return exports;
}
