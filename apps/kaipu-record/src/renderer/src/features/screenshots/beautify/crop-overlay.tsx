import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  clampCrop,
  cropHandles,
  hitCropHandle,
  isFullCrop,
  moveCrop,
  resizeCrop,
} from "../annotations/crop";
import { handleCursor, type HandleId } from "../annotations/handles";
import { FULL_CROP, type CropRect } from "../annotations/scene";
import type { EditorScene } from "../annotations/use-editor-scene";
import styles from "./crop-overlay.module.css";

interface Size {
  w: number;
  h: number;
}
interface Pt {
  x: number;
  y: number;
}
type Drag =
  | { mode: "draw"; start: Pt }
  | { mode: "move"; start: Pt; orig: CropRect }
  | { mode: "resize"; handle: HandleId; orig: CropRect };

/** Handle side in px, its click tolerance, and the smallest meaningful crop-draw drag. */
const HANDLE_PX = 10;
const HANDLE_HIT_PX = 12;
const CROP_DRAW_MIN = 0.01;

/**
 * The crop tool overlay, positioned over the whole beautify frame (bg + padding +
 * shot). Crop coordinates are normalized 0–1 of the FRAME, so a crop can reach into
 * the padding/background. Mirrors the annotation resize/move geometry via `crop.ts`;
 * only the measured element (the frame vs the shot) differs.
 *
 * Rendered by the editor only while the crop tool is active, and only when the frame
 * is shown un-windowed (the applied crop is not previewed while editing it).
 */
export function CropOverlay({
  scene,
  chrome,
  onLeave,
}: {
  scene: EditorScene;
  /**
   * Leaves the crop tool (NIW2-759), keeping the crop: Esc, Enter, and a click outside an
   * existing crop. Dragging a handle or the frame never calls it.
   */
  onLeave?: () => void;
  /**
   * Canvas mode (mock A5): draws the export frame's chrome, undoing the view's zoom so rules,
   * handles and the label keep their screen size. `pixelSize` is the exact size an export of
   * a window (0–1 of the frame) has, so the label never says a size the export lacks.
   */
  chrome?: { zoom: number; pixelSize: (c: CropRect) => { w: number; h: number } | null };
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const drag = useRef<Drag | null>(null);
  // Latest `onLeave` for the window keydown handler, so it reads fresh state without
  // re-subscribing on every render.
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  // The rect being dragged lives here, not in the scene: the scene is touched once, on
  // release, so a crop drag is one undo entry and never re-renders the editor page. The
  // ref mirrors the state for the pointerup/abort/Esc handlers, which need the latest.
  const [liveCrop, setLiveCrop] = useState<CropRect | undefined>();
  const liveCropRef = useRef<CropRect | undefined>(undefined);
  const setLive = useCallback((next: CropRect | undefined): void => {
    liveCropRef.current = next;
    setLiveCrop(next);
  }, []);

  // The crop rect being edited = the drag in flight, else the scene crop, else the full frame.
  const cropRect = liveCrop ?? scene.crop ?? FULL_CROP;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    measure();
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Don't hijack keys while typing in a field or a modal is open.
      if (isEditingText(e.target) || document.querySelector('[aria-modal="true"]')) return;
      // Esc and Enter leave the tool and keep the crop (Reset and Undo remove it). Abort any
      // in-progress drag first so the trailing pointerup can't commit another history entry.
      // Enter on a focused control (Reset, a toolbar button) is that control's own press.
      const onControl =
        e.target instanceof Element && e.target.closest('button, a, [role="button"]') != null;
      if (e.key === "Escape" || (e.key === "Enter" && !onControl)) {
        e.preventDefault();
        if (drag.current) drag.current = null;
        setLive(undefined);
        onLeaveRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setLive]);

  const toNorm = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    const p = toNorm(e);
    // `size` is the layout box, which ignores the view's zoom; the handles are drawn (and the
    // tolerance meant) in screen px, so undo the zoom here.
    const zoom = chrome?.zoom || 1;
    const tol = {
      x: HANDLE_HIT_PX / zoom / (size.w || 1),
      y: HANDLE_HIT_PX / zoom / (size.h || 1),
    };
    const handle = hitCropHandle(cropRect, p, tol, size);
    // Move only an EXISTING sub-crop; with no crop yet, `cropRect` is FULL_CROP (covers
    // everything), so an interior press must draw a fresh rect, not no-op move it.
    const insideExisting =
      scene.crop != null &&
      p.x >= cropRect.x &&
      p.x <= cropRect.x + cropRect.w &&
      p.y >= cropRect.y &&
      p.y <= cropRect.y + cropRect.h;
    if (handle) {
      drag.current = { mode: "resize", handle, orig: cropRect };
    } else if (insideExisting) {
      drag.current = { mode: "move", start: p, orig: cropRect };
    } else {
      drag.current = { mode: "draw", start: p };
    }
    ref.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const p = toNorm(e);
    if (d.mode === "resize") {
      setLive(resizeCrop(d.orig, d.handle, p, size));
      return;
    }
    if (d.mode === "move") {
      setLive(moveCrop(d.orig, p.x - d.start.x, p.y - d.start.y));
      return;
    }
    const dw = Math.abs(p.x - d.start.x);
    const dh = Math.abs(p.y - d.start.y);
    // Ignore a click / tiny twitch: don't set a crop until the drag is meaningful, so a
    // plain click never sets a live rect and commits nothing (no phantom history).
    if (dw < CROP_DRAW_MIN && dh < CROP_DRAW_MIN) return;
    const x = Math.min(d.start.x, p.x);
    const y = Math.min(d.start.y, p.y);
    // Clamp so a pointer dragged past the edge can't produce a crop outside [0,1].
    setLive(clampCrop({ x, y, w: dw, h: dh }));
  };

  // Ends a drag: one commit with whatever was last shown. A crop that ended up covering
  // the whole frame is "no crop" — normalize it to undefined so it doesn't render through
  // the windowed path. Nothing is committed when the result equals the current crop.
  const commitLive = (): void => {
    const c = liveCropRef.current;
    setLive(undefined);
    if (!c) return;
    const next = isFullCrop(c) ? undefined : c;
    if (!sameCrop(next, scene.crop)) scene.setCrop(next);
  };

  const onPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // A click (no drag drew anything) outside an EXISTING crop leaves the tool, keeping the
    // crop. With no crop yet there is nothing to keep: the press just did not draw.
    if (d.mode === "draw" && !liveCropRef.current && scene.crop != null) {
      onLeave?.();
      return;
    }
    commitLive();
  };

  // A pointer gesture can end without a pointerup (system gesture, capture stolen).
  const onPointerAbort = (): void => {
    if (drag.current) {
      drag.current = null;
      commitLive();
    }
  };

  const { w: W, h: H } = size;
  const x = cropRect.x * W;
  const y = cropRect.y * H;
  const w = cropRect.w * W;
  const h = cropRect.h * H;

  return (
    <div
      ref={ref}
      className={styles.overlay}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerAbort}
      onLostPointerCapture={onPointerAbort}
    >
      {chrome ? (
        <CanvasChrome
          rect={{ x, y, w, h }}
          zoom={chrome.zoom}
          handles={cropHandles(cropRect, size).map((hd) => ({
            id: hd.id,
            x: hd.x * W,
            y: hd.y * H,
          }))}
          label={(() => {
            const px = chrome.pixelSize(cropRect);
            return px ? t("exportFrameLabel", { w: px.w, h: px.h }) : null;
          })()}
        />
      ) : (
        <svg className={styles.svg} width={W} height={H}>
          {/* Dim the four strips outside the crop rect. */}
          <rect className={styles.dim} x={0} y={0} width={W} height={y} />
          <rect
            className={styles.dim}
            x={0}
            y={y + h}
            width={W}
            height={Math.max(0, H - (y + h))}
          />
          <rect className={styles.dim} x={0} y={y} width={x} height={h} />
          <rect
            className={styles.dim}
            x={x + w}
            y={y}
            width={Math.max(0, W - (x + w))}
            height={h}
          />
          <rect className={styles.rect} x={x} y={y} width={w} height={h} />
          {cropHandles(cropRect, size).map((hd) => (
            <rect
              key={hd.id}
              className={styles.handle}
              x={hd.x * W - HANDLE_PX / 2}
              y={hd.y * H - HANDLE_PX / 2}
              width={HANDLE_PX}
              height={HANDLE_PX}
              rx={2}
              style={{ cursor: handleCursor(hd.id) }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

/** Far enough to dim the whole stage around the frame at any zoom the viewport allows. */
const DIM_REACH = 20000;
/** Canvas-mode handle side, in screen px (A4's 9 px square). */
const CANVAS_HANDLE_PX = 9;

/**
 * The export frame's look in canvas mode (mock A5): the outside dimmed, a 1 px white rule
 * either side of the edge, 8 square handles and the "W × H px · EXPORT FRAME" label above the
 * top-left corner. Everything is drawn in the frame's own px and divided by the zoom, so it
 * stays the same size on screen.
 */
function CanvasChrome({
  rect,
  zoom,
  handles,
  label,
}: {
  rect: { x: number; y: number; w: number; h: number };
  zoom: number;
  handles: { id: HandleId; x: number; y: number }[];
  label: string | null;
}): React.JSX.Element {
  const px = 1 / (zoom || 1);
  const { x, y, w, h } = rect;
  const R = DIM_REACH;
  return (
    <>
      <svg className={styles.svg} width={1} height={1}>
        {/* The dim reaches far past the overlay: a press out there belongs to the stage. On the
            overlay, a drag outside the export rect still draws a new one, like the flat crop. */}
        <g pointerEvents="none" data-testid="export-frame-dim">
          <rect className={styles.canvasDim} x={-R} y={-R} width={2 * R} height={R + y} />
          <rect className={styles.canvasDim} x={-R} y={y + h} width={2 * R} height={R} />
          <rect className={styles.canvasDim} x={-R} y={y} width={R + x} height={h} />
          <rect className={styles.canvasDim} x={x + w} y={y} width={R} height={h} />
        </g>
        <rect
          className={styles.rule}
          x={x - px}
          y={y - px}
          width={w + 2 * px}
          height={h + 2 * px}
        />
        <rect
          className={styles.rule}
          x={x + px}
          y={y + px}
          width={Math.max(0, w - 2 * px)}
          height={Math.max(0, h - 2 * px)}
        />
        <rect className={styles.canvasEdge} x={x} y={y} width={w} height={h} />
        {handles.map((hd) => (
          <rect
            key={hd.id}
            className={styles.canvasHandle}
            data-testid="export-frame-handle"
            x={hd.x - (CANVAS_HANDLE_PX * px) / 2}
            y={hd.y - (CANVAS_HANDLE_PX * px) / 2}
            width={CANVAS_HANDLE_PX * px}
            height={CANVAS_HANDLE_PX * px}
            style={{ cursor: handleCursor(hd.id) }}
          />
        ))}
      </svg>
      {label && (
        <div className={styles.frameLabel} style={{ left: x, top: y }}>
          <span
            className={styles.frameLabelText}
            data-testid="export-frame-label"
            style={{ bottom: 7 * px, transform: `scale(${px})` }}
          >
            {label}
          </span>
        </div>
      )}
    </>
  );
}

/** True when a keyboard event came from a text field (so the canvas shouldn't grab it). */
function isEditingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function sameCrop(a: CropRect | undefined, b: CropRect | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
