import { useEffect, useMemo, useRef, useState } from "react";
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
/** Room the Capture button needs below the frame before it moves inside. */
const BUTTON_ROOM_DIP = 44;
/** Room the size pill needs above the frame before it moves inside. */
const PILL_ROOM_DIP = 24;

/**
 * The frame this overlay opens with: the remembered one for this display, else a
 * centered rectangle one third of the display, either way clamped to the work area
 * (Failure 8: a frame remembered before a resolution change is moved, not dropped).
 */
export function initialFrame(
  query: Pick<OverlayQuery, "displayId" | "bounds" | "work">,
  remembered: CaptureRect | null,
): CaptureRect {
  const { width, height } = query.bounds;
  const fallback = {
    x: width / 3,
    y: height / 3,
    width: width / 3,
    height: height / 3,
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

type Drag =
  | { kind: "move"; from: Pt; start: CropRect }
  | { kind: "resize"; handle: HandleId; start: CropRect };

interface FrameBoxProps {
  query: OverlayQuery;
  remembered: CaptureRect | null;
  /** The confirmed frame, display-relative DIP. */
  onConfirm(rect: CaptureRect): void;
}

/**
 * Frame mode: a resizable rectangle with eight handles and a draggable body. Enter or
 * Capture confirms it; Esc (handled by the overlay) cancels. Geometry is window-local
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
      if (event.key !== "Enter") return;
      event.preventDefault();
      confirm.current(latest.current);
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
    if (handle) drag.current = { kind: "resize", handle, start: crop };
    else if (inside) drag.current = { kind: "move", from: point, start: crop };
    else return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (!current) return;
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
  const buttonInside = frame.y + frame.height + BUTTON_ROOM_DIP > query.bounds.height;
  const pillInside = frame.y - PILL_ROOM_DIP < 0;

  return (
    <div
      className={styles.sheet}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        role="group"
        aria-label={t("overlay.frame")}
        data-testid="capture-frame"
        className={`${styles.box} ${styles.frame}`}
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      />
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
        className={styles.pill}
        style={{
          left: frame.x,
          top: pillInside ? frame.y + 6 : frame.y - PILL_ROOM_DIP,
          marginLeft: pillInside ? 6 : 0,
        }}
      >
        {frame.width} × {frame.height}
      </div>
      <button
        type="button"
        className={styles.captureButton}
        style={{
          right: query.bounds.width - (frame.x + frame.width) + (buttonInside ? 8 : 0),
          top: buttonInside
            ? frame.y + frame.height - BUTTON_ROOM_DIP + 4
            : frame.y + frame.height + 8,
        }}
        // Pressing the button must not start a frame move.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onConfirm(frame)}
      >
        {t("overlay.capture")}
      </button>
    </div>
  );
}
