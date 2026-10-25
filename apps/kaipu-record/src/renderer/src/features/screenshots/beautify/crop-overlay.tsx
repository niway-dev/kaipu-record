import React, { useCallback, useEffect, useRef, useState } from "react";
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
export function CropOverlay({ scene }: { scene: EditorScene }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const drag = useRef<Drag | null>(null);
  // Latest scene for the window keydown handler, so it reads fresh state without
  // re-subscribing on every render (scene is a new object each render).
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

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
      const scn = sceneRef.current;
      // Esc resets the crop to the full frame. Abort any in-progress drag first so the
      // trailing pointerup can't commit a second history entry.
      if (e.key === "Escape" && (scn.crop || liveCropRef.current)) {
        e.preventDefault();
        if (drag.current) drag.current = null;
        setLive(undefined);
        if (scn.crop) scn.setCrop(undefined);
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
    const tol = { x: HANDLE_HIT_PX / (size.w || 1), y: HANDLE_HIT_PX / (size.h || 1) };
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
      <svg className={styles.svg} width={W} height={H}>
        {/* Dim the four strips outside the crop rect. */}
        <rect className={styles.dim} x={0} y={0} width={W} height={y} />
        <rect className={styles.dim} x={0} y={y + h} width={W} height={Math.max(0, H - (y + h))} />
        <rect className={styles.dim} x={0} y={y} width={x} height={h} />
        <rect className={styles.dim} x={x + w} y={y} width={Math.max(0, W - (x + w))} height={h} />
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
    </div>
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
