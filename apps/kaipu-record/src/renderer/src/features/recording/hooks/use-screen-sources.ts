import { useCallback, useRef, useState } from "react";
import type { ScreenSource } from "@shared/types/electron-api";

export interface ScreenSourcesState {
  sources: ScreenSource[];
  isLoading: boolean;
  error: string | null;
  /**
   * Re-enumerate. With thumbnails (the default) it lists screens and windows for the
   * picker; `{ withThumbnails: false }` lists screens only, for choosing a default.
   */
  refresh(options?: { withThumbnails?: boolean }): Promise<void>;
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
  // Only the latest call may write. The quick screens-only list and the picker's
  // full list can be in flight together, and the quick one landing second would
  // replace the picker's tiles with a list that has no windows and no thumbnails.
  const latest = useRef(0);

  const refresh = useCallback(async (options?: { withThumbnails?: boolean }) => {
    const call = ++latest.current;
    const withThumbnails = options?.withThumbnails !== false;
    const request = withThumbnails ? undefined : { withThumbnails: false };
    setLoading(true);
    setError(null);
    try {
      let result = await window.electronAPI.getScreenSources(request);
      // Retry briefly while thumbnails are blank, so opening the picker right as the
      // window comes forward (from the tray) doesn't show broken images. Only when
      // thumbnails were asked for: without them every thumbnail is blank by design,
      // and retrying would put back the very wait the screens-only call removes.
      for (let i = 0; withThumbnails && i < BLANK_RETRIES && screenThumbsBlank(result); i += 1) {
        await delay(BLANK_RETRY_MS);
        result = await window.electronAPI.getScreenSources();
      }
      if (call === latest.current) setSources(result);
    } catch (cause) {
      if (call !== latest.current) return;
      setSources([]);
      setError(cause instanceof Error ? cause.message : "Could not list sources");
    } finally {
      if (call === latest.current) setLoading(false);
    }
  }, []);

  return { sources, isLoading, error, refresh };
}
