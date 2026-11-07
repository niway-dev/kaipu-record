import { useCallback, useEffect, useMemo, useRef } from "react";
import { captureException } from "@renderer/features/analytics";
import type { AppSettingsStore } from "@renderer/pages/settings/use-app-settings";
import { ALWAYS_SHOWN, parseHiddenTracks, type TrackKey } from "./tracks";

export interface HiddenTracks {
  /** The lanes the user hid (per user, from the settings store). View state only. */
  hidden: TrackKey[];
  /** Flip one lane. Clips is ignored. */
  toggle(key: TrackKey): void;
  /** Make sure a lane is drawn, so a selection on it is never invisible (ADR 0050 decision 6). */
  showTrack(key: TrackKey): void;
}

/**
 * `editor.hiddenTracks` read and written through the page's settings store. Takes the store
 * rather than opening its own, so the page keeps one subscription to the settings.
 */
export function useHiddenTracks({ settings, update }: AppSettingsStore): HiddenTracks {
  const stored = settings?.editor.hiddenTracks;
  const hidden = useMemo(() => parseHiddenTracks(stored), [stored]);
  // The write is async and settings come back later, so two quick changes (a selection that
  // shows a lane right after a toggle) must start from the list the first one wrote.
  const latest = useRef(hidden);
  // Follows the store only when it delivers a new list, so a re-render in between (playback
  // ticks the page) cannot put a pending write back to the old one.
  useEffect(() => {
    latest.current = hidden;
  }, [hidden]);

  // The rest of `editor`, read at write time through a ref so `write` (and the callbacks
  // built on it) keep one identity while the store re-renders.
  const editor = useRef(settings?.editor);
  editor.current = settings?.editor;

  const write = useCallback(
    (next: TrackKey[]) => {
      latest.current = next;
      // `settings:update` merges one level deep (`{ ...settings, ...patch }`), so a patch
      // holding only `hiddenTracks` would replace the whole `editor` object and wipe any
      // other field it gains: send the object whole.
      update({ editor: { ...editor.current, hiddenTracks: next } }).catch((error: unknown) => {
        captureException(error, { context: "editor-hidden-tracks-save" });
      });
    },
    [update],
  );

  const toggle = useCallback(
    (key: TrackKey) => {
      if (ALWAYS_SHOWN.includes(key)) return;
      const current = latest.current;
      write(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
    },
    [write],
  );

  const showTrack = useCallback(
    (key: TrackKey) => {
      if (!latest.current.includes(key)) return;
      write(latest.current.filter((k) => k !== key));
    },
    [write],
  );

  return { hidden, toggle, showTrack };
}
