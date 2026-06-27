import { useCallback, useState } from "react";
import type { ScreenSource } from "@shared/types/electron-api";

export interface ScreenSourcesState {
  sources: ScreenSource[];
  isLoading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/** Fetches the list of recordable screens/windows from the main process. */
export function useScreenSources(): ScreenSourcesState {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSources(await window.electronAPI.getScreenSources());
    } catch (cause) {
      setSources([]);
      setError(cause instanceof Error ? cause.message : "Could not list sources");
    } finally {
      setLoading(false);
    }
  }, []);

  return { sources, isLoading, error, refresh };
}
