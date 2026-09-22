/**
 * Zoom-edit view (a zoom is selected): the preview shows the FULL original frame and this
 * box marks the window the zoom will show (UI spec § 4.2) — frame, corner ticks, scrim,
 * "2.1× · FOLLOW" chip. Dragging it locks the segment where it is dropped (doc 05:
 * follow mode has no stored offset). Positioned per frame from the camera path without
 * React re-renders; the drag reports normalized CENTERS already clamped into the frame.
 *
 * The box itself is pointer-transparent; only the four edge strips are hit-testable, so
 * the box — which can cover the whole picture at low zoom — never swallows a click meant
 * for an annotation under it. The handlers stay here and receive the strips' bubbled
 * events; the pointer capture taken on pointerdown is what lets the drag continue once
 * the pointer leaves the strip.
 */
import { useRef } from "react";
import { useTranslations } from "@kaipu/i18n";
import { useVideoFrameClock } from "../use-video-frame-clock";
import { type CameraPath, cameraAt, clampAnchor } from "../zoom/camera-path";
import type { ZoomSegment } from "../zoom/zoom-model";
import styles from "./camera-box.module.css";

type Point = { x: number; y: number };

/** Where the box sits at source time `t`: the anchor for fixed, the simulated camera for follow. */
export function boxCenterAt(segment: ZoomSegment, path: CameraPath, t: number): Point {
  if (segment.mode === "fixed" && segment.anchor) return clampAnchor(segment.anchor, segment.scale);
  const inside = Math.min(segment.end, Math.max(segment.start, t));
  const cam = cameraAt(path, inside);
  return clampAnchor({ x: cam.cx, y: cam.cy }, segment.scale);
}

export function CameraBox({
  videoRef,
  path,
  segment,
  onBegin,
  onMove,
  onEnd,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  path: CameraPath;
  segment: ZoomSegment;
  onBegin(): void;
  onMove(center: Point): void;
  onEnd(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const center = useRef<Point>({ x: 0.5, y: 0.5 });
  const drag = useRef<{ x: number; y: number; from: Point; w: number; h: number } | null>(null);

  const place = (c: Point): void => {
    center.current = c;
    const el = boxRef.current;
    if (!el) return;
    const size = 1 / segment.scale;
    el.style.left = `${(c.x - size / 2) * 100}%`;
    el.style.top = `${(c.y - size / 2) * 100}%`;
    el.style.width = `${size * 100}%`;
    el.style.height = `${size * 100}%`;
  };

  useVideoFrameClock(
    videoRef,
    (time) => {
      if (!drag.current) place(boxCenterAt(segment, path, time));
    },
    segment,
  );

  // A drag can end without a pointerup (system gesture, capture stolen, the zoom being
  // deselected mid-drag). Without this the controller stays `interacting` forever and
  // every later commit/undo/redo silently no-ops.
  const abort = (): void => {
    if (!drag.current) return;
    drag.current = null;
    onEnd();
  };

  const level = segment.scale.toFixed(1);
  return (
    <div
      ref={boxRef}
      className={styles.box}
      data-testid="camera-box"
      onPointerDown={(event) => {
        event.stopPropagation();
        const stage = boxRef.current?.parentElement?.getBoundingClientRect();
        if (!stage || stage.width === 0 || stage.height === 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          from: center.current,
          w: stage.width,
          h: stage.height,
        };
        onBegin();
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        const next = clampAnchor(
          { x: d.from.x + (event.clientX - d.x) / d.w, y: d.from.y + (event.clientY - d.y) / d.h },
          segment.scale,
        );
        place(next);
        onMove(next);
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        // Release before abort() so the lostpointercapture this queues finds the drag
        // already cleared and the gesture ends exactly once.
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        abort();
      }}
      onPointerCancel={abort}
      onLostPointerCapture={abort}
    >
      <span className={styles.chip}>
        {segment.mode === "fixed"
          ? t("cameraChipLocked", { level })
          : t("cameraChipFollow", { level })}
      </span>
      {/* The only hit-testable parts of the box (see .box / .edge in the CSS). */}
      <span className={`${styles.edge} ${styles.edgeTop}`} data-camera-edge="top" />
      <span className={`${styles.edge} ${styles.edgeRight}`} data-camera-edge="right" />
      <span className={`${styles.edge} ${styles.edgeBottom}`} data-camera-edge="bottom" />
      <span className={`${styles.edge} ${styles.edgeLeft}`} data-camera-edge="left" />
      <span className={`${styles.tick} ${styles.tl}`} />
      <span className={`${styles.tick} ${styles.tr}`} />
      <span className={`${styles.tick} ${styles.bl}`} />
      <span className={`${styles.tick} ${styles.br}`} />
    </div>
  );
}
