import { useEffect } from "react";
import {
  useScreenSources,
  type ScreenSourcesState,
} from "@renderer/features/recording/hooks/use-screen-sources";
import type { RecordingSetup } from "@renderer/features/recording/hooks/use-recording-setup";

/**
 * Loads the real screen/window list and keeps a default source selected on the
 * given recording setup, so every window (Record page, Capture Panel) shows the
 * same source without hardcoding one. Returns the source list for the picker.
 */
export function useSourceSelection(setup: RecordingSetup): ScreenSourcesState {
  const screenSources = useScreenSources();
  const { refresh, sources } = screenSources;
  const { selectedSource, selectSource, isSourcePickerOpen } = setup;

  // On mount, only what the default selection needs: the screens, no thumbnails.
  // The full list — every window, a screenshot of each — is what made the Capture
  // Panel wait before it could say "Screen 1", and nothing on screen shows it until
  // the picker opens. So the picker pays for it, each time it opens.
  useEffect(() => {
    void refresh({ withThumbnails: false });
  }, [refresh]);

  useEffect(() => {
    if (isSourcePickerOpen) void refresh();
  }, [refresh, isSourcePickerOpen]);

  // Default to the primary screen once sources load, so recording is ready to
  // start without a manual pick. The user can still Change it.
  useEffect(() => {
    if (selectedSource || sources.length === 0) return;
    const source = sources.find((s) => s.type === "screen") ?? sources[0];
    selectSource({ id: source.id, name: source.name, type: source.type });
  }, [sources, selectedSource, selectSource]);

  return screenSources;
}
