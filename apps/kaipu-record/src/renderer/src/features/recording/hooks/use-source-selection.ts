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

  // Load on mount and whenever the picker (re)opens, so the list is ready.
  useEffect(() => {
    void refresh();
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
