import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  IDENTITY_VIEW,
  ZOOM_STEP,
  clampPan,
  compensateExtents,
  fitView,
  overflowsAtRest,
  panBy,
  panByWheel,
  wheelPx,
  zoomAt,
  zoomByWheel,
  type Insets,
  type PanBounds,
  type Point,
  type View,
} from "./viewport";
import { isFitContentKey } from "./fit-key";

/** What the canvas is doing about panning, for the cursor and the UI map. */
export type PanMode = "idle" | "ready" | "active";

/**
 * Where the frame sits in the canvas element: its UNSCALED size and its rest origin.
 * `offsetLeft/Top/Width/Height` ignore CSS transforms, so this holds at any zoom and pan.
 * The frame is the canvas element's first child (windowed or not).
 */
function measure(canvas: HTMLElement): PanBounds | null {
  const root = canvas.firstElementChild;
  if (!(root instanceof HTMLElement)) return null;
  return {
    viewport: { w: canvas.clientWidth, h: canvas.clientHeight },
    origin: { x: root.offsetLeft - canvas.offsetLeft, y: root.offsetTop - canvas.offsetTop },
    content: { w: root.offsetWidth, h: root.offsetHeight },
  };
}

/** Keys that belong to the control that has focus, not to the canvas. */
function ownsSpaceKey(target: EventTarget | null): boolean {
  if (document.querySelector('[aria-modal="true"]')) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "BUTTON") return focusedByKeyboard(target);
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest('[role="dialog"]') !== null
  );
}

/** A button keeps Space only when keyboard focus reached it; after a mouse click Space pans. */
function focusedByKeyboard(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible") || el.closest('[role="dialog"]') !== null;
  } catch {
    return true;
  }
}

const isSpace = (e: KeyboardEvent): boolean => e.code === "Space" || e.key === " ";

export interface CanvasViewport {
  view: View;
  panMode: PanMode;
  /**
   * True once, for the click that ends a pan. `panMode` is already `idle` by then when Space
   * was released before the button, so a click guard cannot rely on it alone. Any later press
   * clears it, so a pan whose click never came cannot swallow the next real click.
   */
  consumePanClick(): boolean;
  /** Back to zoom 100% and no pan. */
  reset(): void;
  /**
   * The content box grew or shrank (`prev` -> `next`, layout px): move the pan so the shot
   * stays where it was on screen instead of sliding with the re-centred frame.
   */
  compensate(prev: Insets, next: Insets): void;
  /**
   * Show the whole content box, centred (zoomed out if it is wider or taller than the
   * canvas, never past 100%). `onlyIfOverflowing` leaves a frame that already fits at rest
   * untouched, so a document that fits opens exactly as before.
   */
  fit(options?: { onlyIfOverflowing?: boolean }): void;
  /** The +/- buttons: step the zoom around the middle of the visible canvas. */
  zoomStep(direction: 1 | -1): void;
  /** Spread onto the canvas element: Space+drag and middle-button drag pan. */
  bindings: {
    onPointerDownCapture(e: React.PointerEvent<HTMLDivElement>): void;
    onPointerMove(e: React.PointerEvent<HTMLDivElement>): void;
    onPointerUp(e: React.PointerEvent<HTMLDivElement>): void;
    onPointerCancel(e: React.PointerEvent<HTMLDivElement>): void;
    onLostPointerCapture(e: React.PointerEvent<HTMLDivElement>): void;
    onAuxClick(e: React.MouseEvent<HTMLDivElement>): void;
  };
}

/**
 * The infinite canvas's pan and zoom controller (NIW2-698): the wiring between pointer,
 * wheel and keyboard events and the pure math in `viewport.ts`. It owns no look — the
 * page reads `view` and `panMode` and decides how to draw them.
 *
 * - ⌘/Ctrl + wheel (a trackpad pinch arrives as one) zooms around the pointer.
 * - A plain wheel or two-finger scroll pans.
 * - Space + drag and middle-button drag pan. Space is ignored while a text field, button
 *   or dialog has the keyboard.
 *
 * Inert while `enabled` is false: no listeners, `view` stays the identity.
 * `ready` is true once the canvas element exists (the image resolved).
 */
export function useCanvasViewport(
  canvasRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  ready: boolean,
): CanvasViewport {
  const [view, setViewState] = useState<View>(IDENTITY_VIEW);
  // The latest view, so several events inside one frame accumulate instead of each
  // starting from the same stale render.
  const viewRef = useRef(view);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const spaceRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const panEnded = useRef(false);

  const apply = useCallback(
    (change: (v: View, bounds: PanBounds | null) => View): void => {
      const canvas = canvasRef.current;
      const bounds = canvas ? measure(canvas) : null;
      let next = change(viewRef.current, bounds);
      if (bounds) next = clampPan(next, bounds);
      viewRef.current = next;
      setViewState(next);
    },
    [canvasRef],
  );

  // Wheel: non-passive so ⌘/Ctrl+wheel can cancel Electron's own page zoom.
  useEffect(() => {
    const el = canvasRef.current;
    if (!enabled || !el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { x: dx, y: dy } = wheelPx(e, { w: el.clientWidth, h: el.clientHeight });
      if (e.ctrlKey || e.metaKey) {
        apply((v, b) => {
          const origin = b?.origin ?? { x: 0, y: 0 };
          const anchor = {
            x: e.clientX - rect.left - origin.x,
            y: e.clientY - rect.top - origin.y,
          };
          return zoomByWheel(v, anchor, dy);
        });
      } else {
        apply((v) => panByWheel(v, dx, dy));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [enabled, ready, canvasRef, apply]);

  // Space = "hand" while held. It never reaches a control that owns the key.
  useEffect(() => {
    if (!enabled) return;
    const setSpace = (held: boolean): void => {
      spaceRef.current = held;
      setSpaceHeld(held);
    };
    const onDown = (e: KeyboardEvent): void => {
      if (!isSpace(e) || ownsSpaceKey(e.target)) return;
      e.preventDefault(); // no page scroll
      if (!spaceRef.current) setSpace(true);
    };
    const onUp = (e: KeyboardEvent): void => {
      if (isSpace(e) && spaceRef.current) setSpace(false);
    };
    const onBlur = (): void => {
      if (spaceRef.current) setSpace(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      spaceRef.current = false;
    };
  }, [enabled]);

  const endDrag = useCallback((): void => {
    if (!drag.current) return;
    drag.current = null;
    panEnded.current = true;
    setPanning(false);
  }, []);

  const consumePanClick = useCallback((): boolean => {
    const ended = panEnded.current;
    panEnded.current = false;
    return ended;
  }, []);

  const bindings: CanvasViewport["bindings"] = {
    // Capture phase, so a pan press never reaches the annotation layer underneath
    // (Space + drag must not also draw a box).
    onPointerDownCapture(e) {
      if (!enabled) return;
      panEnded.current = false;
      const middle = e.button === 1;
      if (!middle && !(e.button === 0 && spaceRef.current)) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = { x: e.clientX, y: e.clientY };
      setPanning(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e) {
      const last = drag.current;
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      drag.current = { x: e.clientX, y: e.clientY };
      apply((v) => panBy(v, dx, dy));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
    // A middle click would otherwise paste-select or autoscroll on some platforms.
    onAuxClick(e) {
      if (enabled && e.button === 1) e.preventDefault();
    },
  };

  const reset = useCallback((): void => {
    viewRef.current = IDENTITY_VIEW;
    setViewState(IDENTITY_VIEW);
  }, []);

  const compensate = useCallback(
    (prev: Insets, next: Insets): void => {
      if (!enabled) return;
      apply((v) => compensateExtents(v, prev, next));
    },
    [enabled, apply],
  );

  const fit = useCallback(
    (options?: { onlyIfOverflowing?: boolean }): void => {
      if (!enabled) return;
      apply((v, b) => {
        if (!b || (options?.onlyIfOverflowing && !overflowsAtRest(b))) return v;
        return fitView(v, b);
      });
    },
    [enabled, apply],
  );

  // Shift+1 fits the content in view (mock A6). Not while typing, with a dialog open, or with
  // an open toolbar menu (the same overlay guard as useToolShortcuts).
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      const overlayOpen = document.querySelector('[role="menu"], [aria-modal="true"]') !== null;
      if (!isFitContentKey(e, overlayOpen)) return;
      e.preventDefault();
      fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, fit]);

  const zoomStep = useCallback(
    (direction: 1 | -1): void => {
      apply((v, b) => {
        const center: Point = b
          ? { x: b.viewport.w / 2 - b.origin.x, y: b.viewport.h / 2 - b.origin.y }
          : { x: 0, y: 0 };
        return zoomAt(v, center, v.zoom + direction * ZOOM_STEP);
      });
    },
    [apply],
  );

  const panMode: PanMode = panning ? "active" : spaceHeld ? "ready" : "idle";
  return { view, panMode, consumePanClick, reset, compensate, fit, zoomStep, bindings };
}
