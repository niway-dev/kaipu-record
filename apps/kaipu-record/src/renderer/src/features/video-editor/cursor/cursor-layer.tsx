import { useEffect, useMemo, useRef } from "react";
import type { FrameSource } from "../playback-media";
import { useVideoFrameClock } from "../use-video-frame-clock";
import { cameraAt, type CameraPath } from "../zoom/camera-path";
import type { Redaction } from "../privacy/redaction";
import { prepareCursor, drawCursor, type CursorFrame, type CursorLayerData } from "./cursor-model";
import { uiArea } from "@renderer/lib/ui-area";

export function CursorLayer({
  data,
  videoRef,
  path,
  cameraEnabled,
  hidden,
  frame,
  redactions,
  onSelect,
  claim,
  selected = false,
}: {
  data: CursorLayerData;
  videoRef: React.RefObject<FrameSource | null>;
  path: CameraPath;
  cameraEnabled: boolean;
  hidden: boolean;
  frame: { width: number; height: number };
  redactions: Redaction[];
  /** Clicking the drawn pointer opens its settings. */
  onSelect?: () => void;
  /** Receives this layer's hit-test; the annotation layer calls it for Select presses
   *  on empty space. */
  claim?: React.MutableRefObject<((clientX: number, clientY: number) => boolean) | null>;
  /** Its settings are open: outline it in the preview so it reads as the selection. */
  selected?: boolean;
}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef<CursorFrame | null>(null);
  const at = useMemo(() => prepareCursor(data.track, data.settings), [data.track, data.settings]);
  const trigger = useMemo(
    () => ({ at, path, cameraEnabled, hidden, frame, redactions, selected }),
    [at, path, cameraEnabled, hidden, frame, redactions, selected],
  );
  useVideoFrameClock(
    videoRef,
    (t) => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, frame.width, frame.height);
      drawn.current = hidden
        ? null
        : at(
            t,
            cameraEnabled ? cameraAt(path, t) : { cx: 0.5, cy: 0.5, scale: 1 },
            frame.width,
            frame.height,
            redactions,
          );
      drawCursor(ctx, drawn.current);
      // Preview only: the export never calls this layer, so the outline cannot leak.
      if (selected && drawn.current) drawSelection(ctx, drawn.current, canvas.current);
    },
    trigger,
  );
  // The canvas never takes pointer events: the annotation layer above the footage owns
  // them, hit-tests its own shapes and handles first, and only then asks `claim`.
  useEffect(() => {
    if (!claim) return;
    claim.current = (clientX, clientY) => {
      const c = drawn.current;
      const box = canvas.current?.getBoundingClientRect();
      if (!c || !box || box.width === 0 || !onSelect) return false;
      const scale = frame.width / box.width;
      const hit = hitsCursor(
        c,
        (clientX - box.left) * scale,
        (clientY - box.top) * scale,
        Math.max(8 * scale, c.size * 0.25),
      );
      if (hit) onSelect();
      return hit;
    };
    return () => {
      claim.current = null;
    };
  }, [claim, onSelect, frame.width]);
  return (
    <canvas
      {...uiArea("editorVideo.cursor")}
      ref={canvas}
      width={frame.width}
      height={frame.height}
      aria-hidden="true"
      data-testid="cursor-layer"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}

/** A rounded accent outline around the drawn pointer, sized in screen pixels. */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  c: CursorFrame,
  el: HTMLCanvasElement | null,
): void {
  const box = el?.getBoundingClientRect();
  const px = box && box.width > 0 ? el!.width / box.width : 1; // canvas px per screen px
  const pad = 6 * px;
  const [left, top, right, bottom] =
    c.style === "arrow"
      ? [c.x, c.y, c.x + c.size * 0.65, c.y + c.size]
      : (() => {
          const r = c.size * (c.style === "spotlight" ? 1.25 : 0.22);
          return [c.x - r, c.y - r, c.x + r, c.y + r];
        })();
  const accent = el ? getComputedStyle(el).getPropertyValue("--accent-primary").trim() : "";
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(left - pad, top - pad, right - left + 2 * pad, bottom - top + 2 * pad, 6 * px);
  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = accent || "#f43f5e";
  ctx.setLineDash([5 * px, 3 * px]);
  ctx.stroke();
  ctx.restore();
}

/** Whether a press at (x, y), in canvas pixels, lands on the drawn pointer (plus `pad`). */
export function hitsCursor(c: CursorFrame, x: number, y: number, pad: number): boolean {
  const dx = x - c.x,
    dy = y - c.y;
  if (c.style === "arrow")
    return dx >= -pad && dx <= c.size * 0.65 + pad && dy >= -pad && dy <= c.size + pad;
  // The spotlight's glow is wide (1.25 × size); only its centre selects, like the dot,
  // so clicks across the glow still play/pause and deselect.
  return Math.hypot(dx, dy) <= c.size * 0.22 + pad;
}
