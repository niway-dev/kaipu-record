import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import type { PixelBuffer, PixelWindow } from "../pixel-buffer";
import {
  AnalyzerDisposed,
  createColorsAnalyzer,
  sameWindow,
  type ColorsAnalyzer,
  type LocatedImage,
} from "./colors-client";
import type { ColorAnalysis, LocateTarget } from "./histogram";

export type ColorsStatus = "idle" | "counting" | "ready" | "error";

export interface ColorsController {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  status: ColorsStatus;
  /** Counting progress, 0..1, while `status` is "counting"; null otherwise. */
  progress: number | null;
  analysis: ColorAnalysis | null;
  /** The color the image is highlighting, or null. */
  located: LocateTarget | null;
  /** Highlight `target`; the target already shown, or null, clears the highlight. */
  locate(target: LocateTarget | null): void;
  /** The overlay for `located`, once the worker drew it. */
  overlay: LocatedImage | null;
}

interface Options {
  /** Inspect is on. Off closes the panel and stops the worker. */
  active: boolean;
  /** Inspect's decoded pixels (shared, never decoded again here). */
  buffer: PixelBuffer | null;
  /** The part of the buffer that shows (a cropped base); absent = all of it. Counted only. */
  window?: PixelWindow;
}

export const sameTarget = (a: LocateTarget | null, b: LocateTarget | null): boolean =>
  !!a &&
  !!b &&
  a.kind === b.kind &&
  (a.kind === "group" ? a.id === (b as typeof a).id : a.rgb === (b as typeof a).rgb);

/**
 * The colors panel (NIW2-704): one analyzer per decoded buffer, started when the panel opens
 * and stopped when Inspect exits, the image changes or the editor unmounts, so the worker's
 * copy of the pixels lives only while it can be used.
 */
export function useColors({ active, buffer, window: win }: Options): ColorsController {
  const t = useTranslations("screenshots");
  // Read through a ref: a new `t` must not restart counting nor change the controller.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [open, setOpenState] = useState(false);
  const [status, setStatus] = useState<ColorsStatus>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<ColorAnalysis | null>(null);
  const [located, setLocated] = useState<LocateTarget | null>(null);
  const [overlay, setOverlayState] = useState<LocatedImage | null>(null);

  const analyzer = useRef<ColorsAnalyzer | null>(null);
  const overlayRef = useRef<LocatedImage | null>(null);
  const locatedRef = useRef<LocateTarget | null>(null);
  const locateSeq = useRef(0);

  const setOverlay = useCallback((next: LocatedImage | null): void => {
    const previous = overlayRef.current;
    if (previous && previous !== next) previous.bitmap?.close();
    overlayRef.current = next;
    setOverlayState(next);
  }, []);

  const clearLocate = useCallback((): void => {
    locateSeq.current++;
    locatedRef.current = null;
    setLocated(null);
    setOverlay(null);
  }, [setOverlay]);

  const stop = useCallback((): void => {
    analyzer.current?.dispose();
    analyzer.current = null;
    clearLocate();
    setAnalysis(null);
    setProgress(null);
    setStatus("idle");
  }, [clearLocate]);

  const setOpen = useCallback(
    (next: boolean): void => {
      setOpenState(next);
      if (!next) clearLocate();
    },
    [clearLocate],
  );

  // Inspect off: close the panel and free the worker.
  useEffect(() => {
    if (active) return;
    setOpenState(false);
    stop();
  }, [active, stop]);

  // A different (or dropped) buffer, or another visible window (the crop moved): the old counts
  // describe other pixels.
  useEffect(() => {
    const current = analyzer.current;
    if (current && (current.buffer !== buffer || !sameWindow(current.window, win))) stop();
  }, [buffer, win, stop]);

  // Open on a decoded buffer: count it, once per buffer.
  useEffect(() => {
    if (!open || !active || !buffer || analyzer.current) return;
    const current = createColorsAnalyzer(
      buffer,
      (done) => {
        if (analyzer.current === current) setProgress(done);
      },
      win,
    );
    analyzer.current = current;
    setProgress(0);
    setStatus("counting");
    current.analysis.then(
      (result) => {
        if (analyzer.current !== current) return;
        setAnalysis(result);
        setProgress(null);
        setStatus("ready");
      },
      (error: unknown) => {
        if (analyzer.current !== current || error instanceof AnalyzerDisposed) return;
        // Drop the failed analyzer so closing and reopening the panel tries again.
        current.dispose();
        analyzer.current = null;
        setProgress(null);
        setStatus("error");
        reportError(tRef.current("inspectColorsUnavailable"), error, {
          context: { phase: "inspect-colors" },
        });
      },
    );
  }, [open, active, buffer, win]);

  const locate = useCallback(
    (target: LocateTarget | null): void => {
      const current = analyzer.current;
      if (!target || !current || sameTarget(target, locatedRef.current)) {
        clearLocate();
        return;
      }
      const seq = ++locateSeq.current;
      locatedRef.current = target;
      setLocated(target);
      // The previous mask (and its count) describes another color: drop it until the new one.
      setOverlay(null);
      current.locate(target).then(
        (image) => {
          if (seq !== locateSeq.current || analyzer.current !== current) {
            image.bitmap?.close();
            return;
          }
          setOverlay(image);
        },
        (error: unknown) => {
          if (seq !== locateSeq.current || error instanceof AnalyzerDisposed) return;
          clearLocate();
          reportError(tRef.current("inspectColorsUnavailable"), error, {
            context: { phase: "inspect-colors-locate" },
          });
        },
      );
    },
    [clearLocate, setOverlay],
  );

  useEffect(
    () => () => {
      analyzer.current?.dispose();
      analyzer.current = null;
      overlayRef.current?.bitmap?.close();
      overlayRef.current = null;
    },
    [],
  );

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  // Stable while nothing changes, so the memoized panel skips the page's hover re-renders.
  return useMemo(
    () => ({ open, setOpen, toggle, status, progress, analysis, located, locate, overlay }),
    [open, setOpen, toggle, status, progress, analysis, located, locate, overlay],
  );
}
