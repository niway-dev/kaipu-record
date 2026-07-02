import { useCallback, useState } from "react";
import type { ScreenSource } from "@shared/types/electron-api";

export interface ScreenSourcesState {
  sources: ScreenSource[];
  isLoading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

/** An empty NativeImage.toDataURL() is a ~22-char stub ("data:image/png;base64,"). */
const BLANK_THUMB_MAX_LEN = 64;
const BLANK_RETRIES = 4;
const BLANK_RETRY_MS = 250;

const isBlankThumb = (thumb: string): boolean => !thumb || thumb.length < BLANK_THUMB_MAX_LEN;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True while the screen thumbnails haven't captured yet. `desktopCapturer` returns
 * blank (0×0) thumbnails when called while the window is still coming to the
 * foreground (e.g. opened from the tray), and a screen is always capturable once
 * settled — so a blank screen thumbnail means "retry", not "no screen".
 */
const screenThumbsBlank = (sources: ScreenSource[]): boolean => {
  const screens = sources.filter((s) => s.type === "screen");
  return screens.length > 0 && screens.every((s) => isBlankThumb(s.thumbnail));
};

/** Fetches the list of recordable screens/windows from the main process. */
export function useScreenSources(): ScreenSourcesState {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result = await window.electronAPI.getScreenSources();
      // Retry briefly while thumbnails are blank, so opening the picker right as the
      // window comes forward (from the tray) doesn't show broken images. The app path
      // already fetches when settled, so this no-ops there.
      for (let i = 0; i < BLANK_RETRIES && screenThumbsBlank(result); i += 1) {
        await delay(BLANK_RETRY_MS);
        result = await window.electronAPI.getScreenSources();
      }
      setSources(result);
    } catch (cause) {
      setSources([]);
      setError(cause instanceof Error ? cause.message : "Could not list sources");
    } finally {
      setLoading(false);
    }
  }, []);

  return { sources, isLoading, error, refresh };
}
