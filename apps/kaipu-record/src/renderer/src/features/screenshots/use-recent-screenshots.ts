import { useCallback, useEffect, useState } from "react";
import type { LocalRecording } from "@shared/types/library-storage";

/**
 * Recent screenshots from the unified vault, newest first. Reuses the library
 * list and filters to `kind === "screenshot"`. Re-reads on window focus so a
 * capture saved moments ago appears when the user returns to this page.
 */
export function useRecentScreenshots(limit = 6): { shots: LocalRecording[] } {
  const [shots, setShots] = useState<LocalRecording[]>([]);

  const refresh = useCallback(() => {
    void window.electronAPI.listLocalRecordings().then((items) => {
      setShots(items.filter((item) => item.kind === "screenshot").slice(0, limit));
    });
  }, [limit]);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  return { shots };
}
