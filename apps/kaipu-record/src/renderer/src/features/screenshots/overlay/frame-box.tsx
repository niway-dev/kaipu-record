import { useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { clampFrameToDisplay } from "@shared/capture-geometry";
import type { CaptureRect } from "@shared/types/screenshot-capture";
import { cropHandles, hitCropHandle, moveCrop, resizeCrop } from "../annotations/crop";
import { handleCursor, type HandleId, type Pt, type Size } from "../annotations/handles";
import type { CropRect } from "../annotations/scene";
import { workAreaInWindow, type OverlayQuery } from "./overlay-query";
import styles from "./capture-overlay.module.css";

/** How close (DIP) the pointer must be to a handle to grab it. */
const HANDLE_HIT_DIP = 8;
/** Gap between the frame's bottom edge and the toolbar under it. */
const TOOLBAR_GAP_DIP = 10;
/** Room the toolbar (44 DIP tall plus its gap) needs below the frame before it moves inside. */
const TOOLBAR_ROOM_DIP = 56;
/** About half the toolbar's width: how far its center stays from a display edge. */
const TOOLBAR_HALF_WIDTH_DIP = 170;
/** Room the size pill needs above the frame before it moves inside. */
const PILL_ROOM_DIP = 30;

/** A press that moves less than this (DIP) on both axes is a click, not a drag. */
export const MIN_DRAG_DIP = 4;
/** The share of the work area the first box covers when nothing is remembered. */
const DEFAULT_BOX_SHARE = 0.6;

/**
 * The frame this overlay opens with: the remembered one for this display, else a
 * centered box of 60 % of the work area, either way clamped to the work area
 * (Failure 8: a frame remembered before a resolution change is moved, not dropped).
 */
export function initialFrame(
  query: Pick<OverlayQuery, "displayId" | "bounds" | "work">,
  remembered: CaptureRect | null,
): CaptureRect {
  const area = workAreaInWindow(query);
  const margin = (1 - DEFAULT_BOX_SHARE) / 2;
  const fallback = {
    x: area.x + area.width * margin,
    y: area.y + area.height * margin,
    width: area.width * DEFAULT_BOX_SHARE,
    height: area.height * DEFAULT_BOX_SHARE,
  };
  return clampFrameToDisplay(remembered ?? fallback, {
    id: query.displayId,
    bounds: query.bounds,
    workArea: query.work,
    scaleFactor: 1,
  });
}

// The crop helpers work in 0–1 units of a canvas. Here the canvas is the work area, so
// "clamped to the canvas" means "clamped to the work area" with no extra code.
function toCrop(rect: CaptureRect, area: CaptureRect): CropRect {
  return {
    x: (rect.x - area.x) / area.width,
    y: (rect.y - area.y) / area.height,
    w: rect.width / area.width,
    h: rect.height / area.height,
  };
}

function toPoint(clientX: number, clientY: number, area: CaptureRect): Pt {
  return { x: (clientX - area.x) / area.width, y: (clientY - area.y) / area.height };
}

/** The rectangle spanned by two window points, kept inside the work area, at least 1x1 DIP. */
export function drawnRect(from: Pt, to: Pt, area: CaptureRect): CaptureRect {
  const clampX = (value: number): number =>
    Math.min(Math.max(Math.round(value), area.x), area.x + area.width);
  const clampY = (value: number): number =>
    Math.min(Math.max(Math.round(value), area.y), area.y + area.height);
  const x1 = clampX(from.x);
  const y1 = clampY(from.y);
  const x2 = clampX(to.x);
  const y2 = clampY(to.y);
  const x = Math.min(Math.min(x1, x2), area.x + area.width - 1);
  const y = Math.min(Math.min(y1, y2), area.y + area.height - 1);
  return {
    x,
    y,
    width: Math.max(1, Math.abs(x2 - x1)),
    height: Math.max(1, Math.abs(y2 - y1)),
  };
}

/**
 * `origin` is the box as it was when the drag began: a key press mid-drag restores it, so
 * no half-drawn or half-moved box outlives the drag.
 */
type Drag = { origin: CaptureRect } & (
  | { kind: "move"; from: Pt; start: CropRect }
  | { kind: "resize"; handle: HandleId; start: CropRect }
  | { kind: "draw"; from: Pt; moved: boolean }
);

/** Keys that only change what the next key means; they must not cancel a drag. */
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta"]);

interface FrameBoxProps {
  query: OverlayQuery;
  remembered: CaptureRect | null;
  /** The confirmed frame, display-relative DIP. */
  onConfirm(rect: CaptureRect): void;
}

/**
 * Frame mode: a resizable rectangle with eight handles and a draggable body, redrawn from
 * scratch by dragging on the dim sheet outside it. Enter or Capture confirms it; Esc
 * (handled by the overlay) cancels. A key press during a drag ends the drag first. Geometry is window-local
 * DIP, which is display-relative because the window covers the display.
 */
export function FrameBox({ query, remembered, onConfirm }: FrameBoxProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const area = useMemo(() => workAreaInWindow(query), [query]);
  const size: Size = useMemo(() => ({ w: area.width, h: area.height }), [area]);
  const display = useMemo(
    () => ({ id: query.displayId, bounds: query.bounds, workArea: query.work, scaleFactor: 1 }),
    [query],
  );
  const [frame, setFrame] = useState<CaptureRect>(() => initialFrame(query, remembered));
  const drag = useRef<Drag | null>(null);

  // Latest frame for the window-level Enter listener without re-subscribing per move.
  const latest = useRef(frame);
  latest.current = frame;
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (MODIFIER_KEYS.has(event.key)) return;
      // Whatever the key does next (confirm, switch mode, cancel), the drag ends first.
      const dragging = drag.current;
      drag.current = null;
      if (event.key === "Enter") {
        event.preventDefault();
        confirm.current(latest.current);
        return;
      }
      if (dragging) setFrame(dragging.origin);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const fromCrop = (crop: CropRect): CaptureRect =>
    clampFrameToDisplay(
      {
        x: area.x + crop.x * area.width,
        y: area.y + crop.y * area.height,
        width: crop.w * area.width,
        height: crop.h * area.height,
      },
      display,
    );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const crop = toCrop(frame, area);
    const point = toPoint(event.clientX, event.clientY, area);
    const tol = { x: HANDLE_HIT_DIP / area.width, y: HANDLE_HIT_DIP / area.height };
    const handle = hitCropHandle(crop, point, tol, size);
    const inside =
      event.clientX >= frame.x &&
      event.clientX <= frame.x + frame.width &&
      event.clientY >= frame.y &&
      event.clientY <= frame.y + frame.height;
    const origin = frame;
    if (handle) drag.current = { origin, kind: "resize", handle, start: crop };
    else if (inside) drag.current = { origin, kind: "move", from: point, start: crop };
    else {
      // The dim sheet: press, drag and release defines a new box.
      drag.current = {
        origin,
        kind: "draw",
        from: { x: event.clientX, y: event.clientY },
        moved: false,
      };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current) return;
    if (current.kind === "draw") {
      const { from } = current;
      // A click that barely moves keeps the box it found; only a real drag replaces it.
      if (!current.moved) {
        const travelled = Math.max(
          Math.abs(event.clientX - from.x),
          Math.abs(event.clientY - from.y),
        );
        if (travelled < MIN_DRAG_DIP) return;
        current.moved = true;
      }
      setFrame(drawnRect(from, { x: event.clientX, y: event.clientY }, workAreaInWindow(query)));
      return;
    }
    const point = toPoint(event.clientX, event.clientY, area);
    const next =
      current.kind === "resize"
        ? resizeCrop(current.start, current.handle, point, size)
        : moveCrop(current.start, point.x - current.from.x, point.y - current.from.y);
    setFrame(fromCrop(next));
  };

  const endDrag = (): void => {
    drag.current = null;
  };

  const handles = cropHandles(toCrop(frame, area), size);
  const toolbarInside = frame.y + frame.height + TOOLBAR_ROOM_DIP > query.bounds.height;
  const pillInside = frame.y - PILL_ROOM_DIP < 0;
  // Centered under the frame, but kept on the display when the frame hugs a side edge.
  const toolbarCenter = Math.min(
    Math.max(frame.x + frame.width / 2, TOOLBAR_HALF_WIDTH_DIP),
    Math.max(TOOLBAR_HALF_WIDTH_DIP, query.bounds.width - TOOLBAR_HALF_WIDTH_DIP),
  );

  return (
    <div
      className={`${styles.sheet} ${styles.drawable}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        role="group"
        aria-label={t("overlay.frame")}
        data-testid="capture-frame"
        className={styles.frameBox}
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      />
      {/* Marching ants over the pink border; drawn in window pixels so the dashes keep
          their length whatever the frame's size. */}
      <svg
        className={styles.ants}
        aria-hidden
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      >
        <rect
          x={0.5}
          y={0.5}
          width={Math.max(0, frame.width - 1)}
          height={Math.max(0, frame.height - 1)}
        />
      </svg>
      {handles.map((handle) => (
        <div
          key={handle.id}
          className={styles.handle}
          style={{
            left: area.x + handle.x * area.width,
            top: area.y + handle.y * area.height,
            cursor: handleCursor(handle.id),
          }}
        />
      ))}
      <div
        className={styles.sizePill}
        style={{
          left: frame.x,
          top: pillInside ? frame.y + 8 : frame.y - PILL_ROOM_DIP,
          marginLeft: pillInside ? 8 : 0,
        }}
      >
        {frame.width} × {frame.height}
      </div>
      <div
        className={styles.toolbar}
        style={{
          left: toolbarCenter,
          top: toolbarInside
            ? frame.y + frame.height - TOOLBAR_ROOM_DIP
            : frame.y + frame.height + TOOLBAR_GAP_DIP,
        }}
        // Pressing the toolbar must not start a frame move.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={styles.captureButton} onClick={() => onConfirm(frame)}>
          <Camera size={14} aria-hidden />
          {t("overlay.capture")}
        </button>
        <span className={styles.toolbarHint}>{t("overlay.hint")}</span>
      </div>
    </div>
  );
}
