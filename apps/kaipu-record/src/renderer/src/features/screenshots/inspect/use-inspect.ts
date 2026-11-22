import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import type { ResolvedImage } from "@renderer/features/screenshots/image-source";
import { formatCaptured, formatColor, type ColorFormat, type Rgba } from "./color";
import type { PickedColor } from "@shared/image-inspect-settings";
import { inspectKeyAction } from "./inspect-keys";
import { usePickedColors } from "./use-picked-colors";
import {
  assetClientRect,
  clientToBasePixel,
  decodeSrgbBuffer,
  isPointVisible,
  loupePixels,
  probeCaptured,
  readProbe,
  sampleAt,
  type BaseView,
  type PixelBuffer,
  type ProbeTile,
  visiblePixelWindow,
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

/** How long the tolerance card stays after the last change, in ms. */
const TOLERANCE_CARD_MS = 900;

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
  /** The text the chip shows and the C key copies; null while the value is not known yet. */
  readout: string | null;
  loupe: Uint8ClampedArray | null;
  onPointerMove(e: { clientX: number; clientY: number; shiftKey?: boolean }): void;
  onPointerLeave(): void;
  /** Copy a value the bar shows (the picked color, a recent one). False when it failed. */
  copyValue(text: string): Promise<boolean>;
  /** True for a moment after a successful copy. */
  copied: boolean;
  /** The text that copy wrote, while `copied` is true: the pointer may be on another pixel by then. */
  copiedText: string | null;
  status: InspectStatus;
  /** The second decode behind "as captured" and the out-of-sRGB mark failed for this image. */
  capturedUnavailable: boolean;
  /** The decoded sRGB pixels, once read; the colors panel (NIW2-704) counts from them.
   * Kept while the editor is mounted and the image is the same, also after Inspect exits. */
  buffer: PixelBuffer | null;
  /** The ruler's axis: `1` picks x, `2` picks y, the same key again hides it. */
  ruler: RulerAxis | null;
  setRuler(axis: RulerAxis | null): void;
  /** Per-channel tolerance of the run scan, 0–255. The wheel changes it while a run is shown. */
  tolerance: number;
  setTolerance(value: number): void;
  /** True for a moment after the tolerance changes (wheel or buttons): the cursor card shows. */
  toleranceShown: boolean;
  /** Where the pointer is while it is over the layer but not on an image pixel (the image is
   * read). `hover` stays null then. */
  empty: { clientX: number; clientY: number } | null;
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
  /**
   * Pick the pixel under the cursor into the Color box (NIW2-911): the previous pick goes to
   * the recents. False when the pointer is not on an image pixel.
   */
  pick(): boolean;
  /** The color the last click picked, kept across sessions. */
  picked: PickedColor | null;
  /** The colors the picks replaced, newest first, at most three. */
  recents: readonly PickedColor[];
  /** Whether the loupe shows next to the pointer; kept across sessions. */
  loupeShown: boolean;
  setLoupeShown(on: boolean): void;
}

interface Options {
  /** The latched `image-inspect` flag. Off: no listener, no decode, nothing. */
  enabled: boolean;
  /** Canvas mode is on: Shift+1 is "fit the content" there, so the ruler key leaves it alone. */
  canvasMode?: boolean;
  image: ResolvedImage | null;
  /** The invisible anchor: the asset at scale 1 at the layer's origin, NOT where a resized base shows. */
  imgRef: RefObject<HTMLImageElement | null>;
  /** The base's crop and placement (per-image crop): pixels map through them, hidden ones read as none. */
  baseCrop?: BaseView["baseCrop"];
  basePlacement?: BaseView["basePlacement"];
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

/**
 * The text for a picked color in the bar's format. "As captured" shows the raw bytes when the
 * pick has them. A pick without them (the probe failed, or the pick was saved by an earlier
 * session that had no probe) shows its sRGB value instead, so it still reads as a color; the bar
 * tags that case (`isSrgbFallback`). A click never makes such a pick while the probe is only
 * pending: it waits for the raw value.
 */
export function pickedReadout(
  picked: PickedColor,
  format: ColorFormat,
  asCaptured: boolean,
): string {
  if (asCaptured && picked.captured) return formatCaptured(picked.captured, format);
  return formatColor(picked.color, format);
}

/**
 * Whether a pick shows its sRGB value although As captured is on: it was made without the
 * raw bytes (the probe had failed), so the bar tags it instead of passing sRGB off as captured.
 */
export function isSrgbFallback(picked: PickedColor, asCaptured: boolean): boolean {
  return asCaptured && !picked.captured;
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

export function useInspect({
  enabled,
  canvasMode = false,
  image,
  imgRef,
  baseCrop,
  basePlacement,
  onEnter,
  onPin,
}: Options): InspectController {
  const t = useTranslations("screenshots");
  const [active, setActiveState] = useState(false);
  const [format, setFormat] = useState<ColorFormat>("hex");
  const [asCaptured, setAsCaptured] = useState(false);
  const [status, setStatus] = useState<InspectStatus>("idle");
  const [hover, setHover] = useState<InspectHover | null>(null);
  const [loupe, setLoupe] = useState<Uint8ClampedArray | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [capturedUnavailable, setCapturedUnavailable] = useState(false);
  const [buffer, setBuffer] = useState<PixelBuffer | null>(null);
  const [ruler, setRulerState] = useState<RulerAxis | null>(null);
  const [tolerance, setToleranceState] = useState(DEFAULT_TOLERANCE);
  const [outerLocked, setOuterLockedState] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [run, setRun] = useState<InspectRun | null>(null);
  const [toleranceShown, setToleranceShown] = useState(false);
  const [empty, setEmpty] = useState<{ clientX: number; clientY: number } | null>(null);
  const picks = usePickedColors(enabled);
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const toleranceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rulerRef = useRef<RulerAxis | null>(null);
  const toleranceRef = useRef(DEFAULT_TOLERANCE);
  const outerLockedRef = useRef(false);
  const shiftRef = useRef(false);
  const runRef = useRef<InspectRun | null>(null);
  const wheelRest = useRef(0);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;
  const viewRef = useRef<BaseView>({});
  viewRef.current = { baseCrop, basePlacement };

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
  const asCapturedRef = useRef(asCaptured);
  asCapturedRef.current = asCaptured;

  const publishRun = useCallback((next: InspectRun | null) => {
    runRef.current = next;
    setRun(next);
  }, []);

  const publish = useCallback(
    (next: InspectHover | null) => {
      hoverRef.current = next;
      if (!next) publishRun(null);
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
      setEmpty(null);
      return;
    }
    const anchor = img.getBoundingClientRect();
    const view = viewRef.current;
    // The whole asset's rect (the ruler line is drawn on it); the anchor is the asset at scale 1.
    const rect = assetClientRect(anchor, view);
    const px = isPointVisible(img, pointer.clientX, pointer.clientY)
      ? clientToBasePixel(pointer.clientX, pointer.clientY, anchor, buf, view)
      : null;
    // A cropped base keeps the whole asset decoded: the readout, the loupe and the ruler read
    // only the part that shows.
    const win = visiblePixelWindow(buf, view.baseCrop);
    const color = px && sampleAt(buf, px.x, px.y, win);
    if (!px || !color) {
      publish(null);
      setLoupe(null);
      setEmpty({ clientX: pointer.clientX, clientY: pointer.clientY });
      return;
    }
    setEmpty(null);
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
    setLoupe(loupePixels(buf, px.x, px.y, LOUPE_RADIUS, win));
    // The run is scanned on the decoded pixels, so zoom and pan never change its length:
    // they only move where the line is drawn.
    const axis = rulerRef.current;
    const outer = outerLockedRef.current || shiftRef.current;
    const found = axis ? scanRun(buf, px.x, px.y, axis, toleranceRef.current, outer, win) : null;
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
      setBuffer(buffer);
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
        publish(null);
        setLoupe(null);
        setEmpty(null);
        if (toleranceTimer.current !== null) clearTimeout(toleranceTimer.current);
        toleranceTimer.current = null;
        setToleranceShown(false);
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
      setToleranceShown(true);
      if (toleranceTimer.current !== null) clearTimeout(toleranceTimer.current);
      toleranceTimer.current = setTimeout(() => {
        toleranceTimer.current = null;
        if (alive.current) setToleranceShown(false);
      }, TOLERANCE_CARD_MS);
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
      setCopiedText(text);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        setCopied(false);
        setCopiedText(null);
      }, COPIED_MS);
      return true;
    },
    [t],
  );

  const pick = useCallback((): boolean => {
    const at = hoverRef.current;
    if (!activeRef.current || !at) return false;
    // As captured is on and the probe has not read this pixel yet: the chip still says "…", so
    // there is nothing honest to pick. (A probe that failed falls back to the sRGB value.)
    if (asCapturedRef.current && !at.captured && !probeBroken.current) return false;
    picksRef.current.pick({
      color: { ...at.color },
      ...(at.captured ? { captured: { ...at.captured } } : {}),
      ...(at.outOfGamut !== undefined ? { outOfGamut: at.outOfGamut } : {}),
    });
    return true;
  }, []);

  const setLoupeShown = useCallback((on: boolean): void => picksRef.current.setLoupe(on), []);
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
    setEmpty(null);
  }, [publish, stopWatch]);

  // Keys: a window listener, only while the flag is on.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      const action = inspectKeyAction(
        e,
        activeRef.current,
        document.querySelector('[aria-modal="true"]') !== null,
        canvasMode,
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
  }, [enabled, canvasMode, setActive, setRuler, setShift]);

  // The base was cropped or resized under a resting pointer: no pointer event fires, so re-sample.
  useEffect(() => {
    if (activeRef.current && lastPointer.current) scheduleFlush();
  }, [baseCrop, basePlacement, scheduleFlush]);

  // A different image invalidates everything decoded from the old one.
  const displayUrl = image?.displayUrl;
  useEffect(() => {
    bufferRef.current = null;
    setBuffer(null);
    bytesRef.current = null;
    tileRef.current = null;
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
      if (toleranceTimer.current !== null) clearTimeout(toleranceTimer.current);
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
    copyValue: copyText,
    copied,
    copiedText,
    status,
    capturedUnavailable,
    buffer,
    ruler,
    setRuler,
    tolerance,
    setTolerance,
    toleranceShown,
    empty,
    outerLocked,
    setOuterLocked,
    outer: outerLocked || shiftHeld,
    run,
    onWheel,
    pin,
    pick,
    picked: picks.picked,
    recents: picks.recents,
    loupeShown: picks.loupe,
    setLoupeShown,
  };
}
