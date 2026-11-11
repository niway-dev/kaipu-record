import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import type { ResolvedImage } from "@renderer/features/screenshots/image-source";
import { formatCaptured, formatColor, type ColorFormat, type Rgba } from "./color";
import { inspectKeyAction } from "./inspect-keys";
import {
  clientToImagePixel,
  decodeSrgbBuffer,
  isPointVisible,
  loupePixels,
  probeCaptured,
  readProbe,
  sampleAt,
  type PixelBuffer,
  type ProbeTile,
} from "./pixel-buffer";
import {
  clampTolerance,
  DEFAULT_TOLERANCE,
  runLength,
  scanRun,
  wheelSteps,
  type PixelRun,
  type RulerAxis,
} from "./pixel-run";

/** Half-width of the loupe in image pixels: 15 x 15 pixels are shown. */
export const LOUPE_RADIUS = 7;
/** How long the pointer rests on a pixel before the captured/out-of-gamut probe runs. */
const PROBE_REST_MS = 120;
/** How long the Copy button keeps saying "Copied". */
const COPIED_MS = 1500;

export type InspectStatus = "idle" | "decoding" | "ready" | "error";

export interface InspectHover {
  x: number;
  y: number;
  /** The pixel as sRGB. */
  color: Rgba;
  /** The raw display-profile bytes, once the probe tile covering this pixel is there. */
  captured?: Rgba;
  outOfGamut?: boolean;
  clientX: number;
  clientY: number;
}

/** The run the ruler shows under the cursor, with where to draw it. */
export interface InspectRun {
  run: PixelRun;
  /** `to - from`, in image pixels. */
  length: number;
  /** Whether it is the outer size (Shift or the bar's Outer toggle). */
  outer: boolean;
  /** The line in client coordinates, from the first pixel's outer edge to the last one's. */
  line: { x1: number; y1: number; x2: number; y2: number };
}

/** A run being pinned: the pixels plus the size of the image they were measured on. */
export interface PinnedRun extends PixelRun {
  imageW: number;
  imageH: number;
}

export interface InspectController {
  enabled: boolean;
  active: boolean;
  setActive(next: boolean): void;
  toggle(): void;
  format: ColorFormat;
  setFormat(format: ColorFormat): void;
  asCaptured: boolean;
  setAsCaptured(on: boolean): void;
  hover: InspectHover | null;
  /** The text the chip shows and the C key copies; null while the value is not known yet.
   * The bar's Copy writes the same, but falls back to the last pixel after the pointer left. */
  readout: string | null;
  loupe: Uint8ClampedArray | null;
  onPointerMove(e: { clientX: number; clientY: number; shiftKey?: boolean }): void;
  onPointerLeave(): void;
  copy(): Promise<boolean>;
  /** True for a moment after a successful copy. */
  copied: boolean;
  status: InspectStatus;
  /** The second decode behind "as captured" and the out-of-sRGB mark failed for this image. */
  capturedUnavailable: boolean;
  /** The ruler's axis: `1` picks x, `2` picks y, the same key again hides it. */
  ruler: RulerAxis | null;
  setRuler(axis: RulerAxis | null): void;
  /** Per-channel tolerance of the run scan, 0–255. The wheel changes it while a run is shown. */
  tolerance: number;
  setTolerance(value: number): void;
  /** The bar's Outer toggle; holding Shift has the same effect while held. */
  outerLocked: boolean;
  setOuterLocked(on: boolean): void;
  /** Shift held, or the toggle on. */
  outer: boolean;
  run: InspectRun | null;
  /** Wheel over the canvas. True when it changed the tolerance (the caller then cancels it). */
  onWheel(e: {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
    metaKey: boolean;
  }): boolean;
  /** Pin the run under the cursor. False when no run is shown. */
  pin(): boolean;
}

interface Options {
  /** The latched `image-inspect` flag. Off: no listener, no decode, nothing. */
  enabled: boolean;
  image: ResolvedImage | null;
  imgRef: RefObject<HTMLImageElement | null>;
  /** Called when Inspect turns on (the page selects the Select tool). */
  onEnter?: () => void;
  /** A click while a run is shown: the page adds it as a `measure` annotation. */
  onPin?: (run: PinnedRun) => void;
}

/** The string Inspect shows for a hovered pixel, or null while "as captured" is still loading. */
export function readoutFor(
  hover: InspectHover | null,
  format: ColorFormat,
  asCaptured: boolean,
): string | null {
  if (!hover) return null;
  if (asCaptured) return hover.captured ? formatCaptured(hover.captured, format) : null;
  return formatColor(hover.color, format);
}

/** The ruler's line in client coordinates for a run on an image shown at `rect`. */
export function runLine(
  run: PixelRun,
  rect: { left: number; top: number; width: number; height: number },
  buf: { width: number; height: number },
): InspectRun["line"] {
  const sx = rect.width / buf.width;
  const sy = rect.height / buf.height;
  if (run.axis === "x") {
    const y = rect.top + (run.at + 0.5) * sy;
    return { x1: rect.left + run.from * sx, y1: y, x2: rect.left + run.to * sx, y2: y };
  }
  const x = rect.left + (run.at + 0.5) * sx;
  return { x1: x, y1: rect.top + run.from * sy, x2: x, y2: rect.top + run.to * sy };
}

export function useInspect({ enabled, image, imgRef, onEnter, onPin }: Options): InspectController {
  const t = useTranslations("screenshots");
  const [active, setActiveState] = useState(false);
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [asCaptured, setAsCaptured] = useState(false);
  const [status, setStatus] = useState<InspectStatus>("idle");
  const [hover, setHover] = useState<InspectHover | null>(null);
  const [loupe, setLoupe] = useState<Uint8ClampedArray | null>(null);
  const [copied, setCopied] = useState(false);
  const [capturedUnavailable, setCapturedUnavailable] = useState(false);
  const [ruler, setRulerState] = useState<RulerAxis | null>(null);
  const [tolerance, setToleranceState] = useState(DEFAULT_TOLERANCE);
  const [outerLocked, setOuterLockedState] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [run, setRun] = useState<InspectRun | null>(null);
  const rulerRef = useRef<RulerAxis | null>(null);
  const toleranceRef = useRef(DEFAULT_TOLERANCE);
  const outerLockedRef = useRef(false);
  const shiftRef = useRef(false);
  const runRef = useRef<InspectRun | null>(null);
  const wheelRest = useRef(0);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;

  const activeRef = useRef(false);
  const alive = useRef(true);
  const bufferRef = useRef<PixelBuffer | null>(null);
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const decoding = useRef(false);
  const tileRef = useRef<ProbeTile | null>(null);
  const lastPointer = useRef<{ clientX: number; clientY: number } | null>(null);
  const frame = useRef<number | null>(null);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probing = useRef(false);
  const hoverRef = useRef<InspectHover | null>(null);
  // The last pixel the pointer rested on: survives pointer leave so the bar's Copy still has it.
  const lastHoverRef = useRef<InspectHover | null>(null);
  const watchFrame = useRef<number | null>(null);
  const watchRect = useRef<string>("");
  const imageRef = useRef(image);
  imageRef.current = image;
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const flushRef = useRef<() => void>(() => {});
  const runProbeRef = useRef<() => Promise<void>>(async () => {});
  const scheduleProbeRef = useRef<() => void>(() => {});
  // A probe that failed once is not retried on every move: "as captured" just stays unknown.
  const probeBroken = useRef(false);

  const readout = readoutFor(hover, format, asCaptured);
  const readoutRef = useRef(readout);
  readoutRef.current = readout;
  const formatRef = useRef(format);
  formatRef.current = format;
  const asCapturedRef = useRef(asCaptured);
  asCapturedRef.current = asCaptured;

  const publishRun = useCallback((next: InspectRun | null) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const publish = useCallback(
    (next: InspectHover | null) => {
      hoverRef.current = next;
      if (next) lastHoverRef.current = next;
      else publishRun(null);
      setHover(next);
    },
    [publishRun],
  );

  const scheduleFlush = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => flushRef.current());
  }, []);

  const rectKey = useCallback((): string => {
    const r = imgRef.current?.getBoundingClientRect();
    return r ? `${r.left},${r.top},${r.width},${r.height}` : "";
  }, [imgRef]);

  /**
   * While the pointer rests on the image, re-sample when the image moves or resizes under it
   * (pan, scroll, zoom): no pointer event fires then. Runs only while a pointer position is known.
   */
  const startWatch = useCallback((): void => {
    if (watchFrame.current !== null) return;
    watchRect.current = rectKey();
    const tick = (): void => {
      watchFrame.current = null;
      if (!alive.current || !activeRef.current || !lastPointer.current) return;
      const key = rectKey();
      if (key !== watchRect.current) {
        watchRect.current = key;
        scheduleFlush();
      }
      watchFrame.current = window.requestAnimationFrame(tick);
    };
    watchFrame.current = window.requestAnimationFrame(tick);
  }, [rectKey, scheduleFlush]);

  const stopWatch = useCallback((): void => {
    if (watchFrame.current !== null) window.cancelAnimationFrame(watchFrame.current);
    watchFrame.current = null;
  }, []);

  /** Run the probe for the pixel the pointer rests on; one at a time, stale results dropped. */
  const runProbe = useCallback(async (): Promise<void> => {
    const bytes = bytesRef.current;
    const buf = bufferRef.current;
    const at = hoverRef.current;
    if (probing.current || probeBroken.current || !bytes || !buf || !at) return;
    if (tileRef.current && readProbe(tileRef.current, at.x, at.y)) return;
    probing.current = true;
    // The image may be swapped while the tile decodes: a swap clears bytesRef and the next
    // decode sets new bytes, so `!==` means this result belongs to another image.
    const otherImage = (): boolean => bytesRef.current !== bytes;
    try {
      const tile = await probeCaptured(bytes, at.x, at.y, 32, buf);
      if (!alive.current || !activeRef.current) return;
      const now = hoverRef.current;
      // Stale: the image changed, or the pointer left this tile while it was decoding.
      // Drop it; the tail below probes again for what is under the pointer now.
      if (!otherImage() && now && readProbe(tile, now.x, now.y)) {
        tileRef.current = tile;
        scheduleFlush();
      }
    } catch (error) {
      if (!alive.current) return;
      // The old image's failure says nothing about the new one: drop it and probe again below.
      if (!otherImage()) {
        probeBroken.current = true;
        setCapturedUnavailable(true);
        reportError(t("inspectUnavailable"), error, { context: { phase: "inspect-probe" } });
        return;
      }
    } finally {
      probing.current = false;
    }
    const after = hoverRef.current;
    const covered = after && tileRef.current && readProbe(tileRef.current, after.x, after.y);
    // Wait for the pointer to rest again rather than decoding on every tile it crosses.
    if (alive.current && activeRef.current && after && !covered) scheduleProbeRef.current();
  }, [scheduleFlush, t]);
  runProbeRef.current = runProbe;

  const scheduleProbe = useCallback((): void => {
    if (restTimer.current !== null) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => {
      restTimer.current = null;
      void runProbeRef.current();
    }, PROBE_REST_MS);
  }, []);
  scheduleProbeRef.current = scheduleProbe;

  /** Map the last pointer position to a pixel and publish it (one per animation frame). */
  const flush = useCallback(() => {
    frame.current = null;
    const buf = bufferRef.current;
    const img = imgRef.current;
    const pointer = lastPointer.current;
    if (!activeRef.current || !buf || !img || !pointer) {
      publish(null);
      setLoupe(null);
      return;
    }
    const rect = img.getBoundingClientRect();
    const px = isPointVisible(img, pointer.clientX, pointer.clientY)
      ? clientToImagePixel(pointer.clientX, pointer.clientY, rect, buf)
      : null;
    const color = px && sampleAt(buf, px.x, px.y);
    if (!px || !color) {
      publish(null);
      setLoupe(null);
      return;
    }
    const known = tileRef.current && readProbe(tileRef.current, px.x, px.y);
    publish({
      x: px.x,
      y: px.y,
      color,
      captured: known ? known.raw : undefined,
      outOfGamut: known ? known.outOfGamut : undefined,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
    });
    setLoupe(loupePixels(buf, px.x, px.y, LOUPE_RADIUS));
    // The run is scanned on the decoded pixels, so zoom and pan never change its length:
    // they only move where the line is drawn.
    const axis = rulerRef.current;
    const outer = outerLockedRef.current || shiftRef.current;
    const found = axis ? scanRun(buf, px.x, px.y, axis, toleranceRef.current, outer) : null;
    publishRun(
      found
        ? { run: found, length: runLength(found), outer, line: runLine(found, rect, buf) }
        : null,
    );
    if (!known) scheduleProbe();
  }, [imgRef, publish, publishRun, scheduleProbe]);
  flushRef.current = flush;

  /** Decode once, the first time Inspect is entered; kept while the editor is mounted. */
  const ensureDecoded = useCallback(async (): Promise<void> => {
    const current = imageRef.current;
    if (bufferRef.current || decoding.current || !current) return;
    decoding.current = true;
    setStatus("decoding");
    // The image may change while it decodes: then this result is dropped and the new one decoded.
    let stale = false;
    try {
      const bytes = await current.getBytes();
      const buffer = await decodeSrgbBuffer(bytes);
      if (!alive.current) return;
      stale = imageRef.current?.displayUrl !== current.displayUrl;
      if (stale) return;
      bytesRef.current = bytes;
      bufferRef.current = buffer;
      setStatus("ready");
      // The pointer may already be over the image: show its pixel without another move.
      scheduleFlush();
    } catch (error) {
      if (!alive.current) return;
      // A decode of the previous image that fails says nothing about the current one.
      stale = imageRef.current?.displayUrl !== current.displayUrl;
      if (stale) return;
      setStatus("error");
      reportError(t("inspectUnavailable"), error, { context: { phase: "inspect-decode" } });
    } finally {
      decoding.current = false;
      if (stale && activeRef.current) void ensureDecodedRef.current();
    }
  }, [scheduleFlush, t]);

  const ensureDecodedRef = useRef(ensureDecoded);
  ensureDecodedRef.current = ensureDecoded;

  const setActive = useCallback(
    (next: boolean): void => {
      if (!enabled || next === activeRef.current) return;
      activeRef.current = next;
      setActiveState(next);
      if (next) {
        // A failed probe gets one more chance each time Inspect is entered.
        probeBroken.current = false;
        setCapturedUnavailable(false);
        onEnterRef.current?.();
        void ensureDecoded();
      } else {
        if (restTimer.current !== null) clearTimeout(restTimer.current);
        restTimer.current = null;
        lastPointer.current = null;
        stopWatch();
        lastHoverRef.current = null;
        publish(null);
        setLoupe(null);
      }
    },
    [enabled, ensureDecoded, publish, stopWatch],
  );

  const toggle = useCallback(() => setActive(!activeRef.current), [setActive]);

  const setRuler = useCallback(
    (axis: RulerAxis | null): void => {
      rulerRef.current = axis;
      setRulerState(axis);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const setTolerance = useCallback(
    (value: number): void => {
      const next = clampTolerance(value);
      toleranceRef.current = next;
      setToleranceState(next);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const setOuterLocked = useCallback(
    (on: boolean): void => {
      outerLockedRef.current = on;
      setOuterLockedState(on);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const setShift = useCallback(
    (held: boolean): void => {
      if (shiftRef.current === held) return;
      shiftRef.current = held;
      setShiftHeld(held);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const onWheel = useCallback<InspectController["onWheel"]>(
    (e) => {
      // Cmd/Ctrl + wheel keeps zooming, so the length can be checked at any zoom.
      if (!activeRef.current || !runRef.current || e.ctrlKey || e.metaKey) return false;
      const { steps, rest } = wheelSteps(wheelRest.current, e);
      wheelRest.current = rest;
      if (steps !== 0) setTolerance(toleranceRef.current + steps);
      return true;
    },
    [setTolerance],
  );

  const pin = useCallback((): boolean => {
    const current = runRef.current;
    const buf = bufferRef.current;
    if (!activeRef.current || !current || !buf) return false;
    onPinRef.current?.({ ...current.run, imageW: buf.width, imageH: buf.height });
    return true;
  }, []);

  const copyText = useCallback(
    async (text: string | null): Promise<boolean> => {
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        // Otherwise "Copied" just never shows and the user cannot tell the copy failed.
        reportError(t("inspectCopyError"), error, { context: { phase: "inspect-copy" } });
        return false;
      }
      if (!alive.current) return true;
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
      return true;
    },
    [t],
  );

  /** The bar's Copy: the pixel under the pointer, or the last one if the pointer moved to the bar. */
  const copy = useCallback(
    (): Promise<boolean> =>
      copyText(
        readoutFor(
          hoverRef.current ?? lastHoverRef.current,
          formatRef.current,
          asCapturedRef.current,
        ),
      ),
    [copyText],
  );
  // The C key keeps copying only what the chip shows.
  const copyKeyRef = useRef(() => copyText(readoutRef.current));
  copyKeyRef.current = () => copyText(readoutRef.current);

  const onPointerMove = useCallback(
    (e: { clientX: number; clientY: number; shiftKey?: boolean }): void => {
      if (!activeRef.current) return;
      if (e.shiftKey !== undefined) setShift(e.shiftKey);
      lastPointer.current = { clientX: e.clientX, clientY: e.clientY };
      startWatch();
      scheduleFlush();
    },
    [scheduleFlush, setShift, startWatch],
  );

  const onPointerLeave = useCallback((): void => {
    lastPointer.current = null;
    stopWatch();
    publish(null);
    setLoupe(null);
  }, [publish, stopWatch]);

  // Keys: a window listener, only while the flag is on.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      const action = inspectKeyAction(
        e,
        activeRef.current,
        document.querySelector('[aria-modal="true"]') !== null,
      );
      if (e.key === "Shift" && activeRef.current) setShift(true);
      if (!action) return;
      e.preventDefault();
      if (action === "toggle") setActive(!activeRef.current);
      else if (action === "exit") setActive(false);
      else if (action === "rulerX") setRuler(rulerRef.current === "x" ? null : "x");
      else if (action === "rulerY") setRuler(rulerRef.current === "y" ? null : "y");
      else void copyKeyRef.current();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === "Shift") setShift(false);
    };
    // Shift released in another window never sends keyup here.
    const onBlur = (): void => setShift(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, setActive, setRuler, setShift]);

  // A different image invalidates everything decoded from the old one.
  const displayUrl = image?.displayUrl;
  useEffect(() => {
    bufferRef.current = null;
    bytesRef.current = null;
    tileRef.current = null;
    lastHoverRef.current = null;
    // The readout still shows the old image's pixel: drop it until the new buffer is read.
    publish(null);
    setLoupe(null);
    probeBroken.current = false;
    setCapturedUnavailable(false);
    if (activeRef.current) void ensureDecodedRef.current();
  }, [displayUrl, publish]);

  // Unmount: drop the buffer (about 81 MiB at 6K) and every timer.
  useEffect(() => {
    alive.current = true; // StrictMode re-runs effects
    return () => {
      alive.current = false;
      bufferRef.current = null;
      bytesRef.current = null;
      tileRef.current = null;
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      if (watchFrame.current !== null) window.cancelAnimationFrame(watchFrame.current);
      watchFrame.current = null;
      if (restTimer.current !== null) clearTimeout(restTimer.current);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    };
  }, []);

  return {
    enabled,
    active,
    setActive,
    toggle,
    format,
    setFormat,
    asCaptured,
    setAsCaptured,
    hover,
    readout,
    loupe,
    onPointerMove,
    onPointerLeave,
    copy,
    copied,
    status,
    capturedUnavailable,
    ruler,
    setRuler,
    tolerance,
    setTolerance,
    outerLocked,
    setOuterLocked,
    outer: outerLocked || shiftHeld,
    run,
    onWheel,
    pin,
  };
}
