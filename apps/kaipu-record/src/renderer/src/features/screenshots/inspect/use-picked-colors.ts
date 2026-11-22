import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import {
  getSettingsSnapshot,
  subscribeSettings,
  updateSettings,
} from "@renderer/features/settings/settings-store";
import {
  DEFAULT_IMAGE_INSPECT_SETTINGS,
  pickColor,
  type ImageInspectSettings,
  type PickedColor,
} from "@shared/image-inspect-settings";

export interface PickedColors {
  /** The color the last click picked, from an earlier session too. */
  picked: PickedColor | null;
  /** The colors the picks replaced, newest first, at most three. */
  recents: readonly PickedColor[];
  /** Whether the loupe shows next to the pointer. */
  loupe: boolean;
  /** A click picked this pixel: it replaces the picked color and the old one goes to the recents. */
  pick(color: PickedColor): void;
  setLoupe(on: boolean): void;
}

/** Main sends a new object on every broadcast: compare what is read, not the reference. */
const sameInspect = (a: ImageInspectSettings, b: ImageInspectSettings): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const readStored = (): ImageInspectSettings | null => getSettingsSnapshot()?.imageInspect ?? null;
const noUnsubscribe = (): void => {};

/**
 * The picked color, its recents and the loupe switch, kept in `AppSettings.imageInspect`
 * (NIW2-911) so they survive closing the editor and the app. A change shows at once and stands
 * until the store reports it back, so two clicks in a row each build on the one before even
 * though the first has not been saved yet. Saves go one after another, in order.
 *
 * `enabled` is the editor's latched `image-inspect` flag: with it off the hook never touches the
 * settings store, so an editor without Inspect asks main for nothing it did not ask for before.
 */
export function usePickedColors(enabled: boolean): PickedColors {
  const t = useTranslations("screenshots");
  const subscribe = useCallback(
    (onChange: () => void): (() => void) =>
      enabled ? subscribeSettings(() => onChange()) : noUnsubscribe,
    [enabled],
  );
  const stored = useSyncExternalStore(subscribe, readStored, readStored);
  const [pending, setPending] = useState<ImageInspectSettings | null>(null);
  const current = pending ?? stored ?? DEFAULT_IMAGE_INSPECT_SETTINGS;
  const latest = useRef(current);
  latest.current = current;
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(0);
  // Every value the store takes: the optimistic one ends when the store reaches it (a broadcast
  // of an older save still in flight leaves it standing).
  useEffect(() => {
    if (!enabled) return;
    return subscribeSettings((published) => {
      if (sameInspect(published.imageInspect, latest.current)) setPending(null);
    });
  }, [enabled]);

  const write = useCallback(
    (next: ImageInspectSettings): void => {
      latest.current = next;
      setPending(next);
      inFlight.current += 1;
      writes.current = writes.current
        .then(() => updateSettings({ imageInspect: next }))
        .then(() => {
          inFlight.current -= 1;
        })
        .catch((error: unknown) => {
          inFlight.current -= 1;
          // The store re-read main before it rethrew: drop the value that never stuck, unless
          // a later save is still queued (it carries this value and settles the store itself).
          if (inFlight.current === 0) setPending(null);
          reportError(t("inspectPicksSaveError"), error, {
            context: { phase: "inspect-picks-save" },
          });
        });
    },
    [t],
  );

  const pick = useCallback(
    (color: PickedColor): void => {
      const next = pickColor(latest.current, color);
      if (next !== latest.current) write(next);
    },
    [write],
  );
  const setLoupe = useCallback(
    (on: boolean): void => {
      if (latest.current.loupe !== on) write({ ...latest.current, loupe: on });
    },
    [write],
  );

  return { picked: current.picked, recents: current.recents, loupe: current.loupe, pick, setLoupe };
}
