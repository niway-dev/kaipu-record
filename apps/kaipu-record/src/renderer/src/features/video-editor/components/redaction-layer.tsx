/**
 * Privacy regions in the preview. Rendered in PreviewStage's `underlay` slot — inside the
 * camera-transformed content layer and under the annotations — so they stay glued to the
 * footage when the camera zooms (UI spec § 4.1, "non-negotiable").
 *
 * Visibility is decided per video frame from SOURCE time (useVideoFrameClock), padded by
 * PREVIEW_PAD_SECONDS on both sides so the preview never shows a secret the export hides.
 *
 * Strength parity with the export comes from redaction.ts: every size is a fraction of the
 * frame height. Which height depends on the unit: the blur sigma (`backdrop-filter`) and
 * the cover label's font-size are DISPLAYED-pixel lengths, so they take the displayed frame
 * height; the pixelate canvas is computed in SOURCE px (drawPixelated) so its cell grid is
 * identical to the export's mosaic, and CSS upscales it to whatever the preview's size is.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useVideoFrameClock } from "../use-video-frame-clock";
import {
  blurSigmaPx,
  coverLabelColor,
  coverLabelPx,
  pixelBlockPx,
  rectToPx,
  type Redaction,
} from "../privacy/redaction";
import styles from "./redaction-layer.module.css";

const PREVIEW_PAD_SECONDS = 0.05;

export function rectStyle(rect: Redaction["rect"]): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

/**
 * Downscale the region of the current video frame into `canvas` (cells, sized in SOURCE px
 * so the grid matches the export's mosaic exactly); CSS upscales it `pixelated`.
 */
function drawPixelated(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement,
  r: Redaction,
): void {
  if (!canvas || r.kind !== "blur") return;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return;
  const px = rectToPx(r.rect, vw, vh);
  if (px.w === 0 || px.h === 0) return;
  const cell = pixelBlockPx(r.intensity, vh);
  const cols = Math.max(1, Math.ceil(px.w / cell));
  const rows = Math.max(1, Math.ceil(px.h / cell));
  if (canvas.width !== cols) canvas.width = cols;
  if (canvas.height !== rows) canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true; // averaging on the way down = the mosaic colors
  ctx.drawImage(video, px.x, px.y, px.w, px.h, 0, 0, cols, rows);
}

export function RedactionView({
  redaction,
  frameHeightPx,
}: {
  redaction: Redaction;
  /** Layout height of the displayed frame, px (untransformed). */
  frameHeightPx: number;
}): React.JSX.Element {
  const base = rectStyle(redaction.rect);
  if (redaction.kind === "cover") {
    return (
      <div
        data-redaction-id={redaction.id}
        className={styles.cover}
        style={{ ...base, background: redaction.fill }}
      >
        {redaction.label && (
          <span
            className={styles.label}
            style={{
              fontSize: `${coverLabelPx(frameHeightPx)}px`,
              color: coverLabelColor(redaction.fill),
            }}
          >
            {redaction.label}
          </span>
        )}
      </div>
    );
  }
  if (redaction.style === "pixelate") {
    return (
      <div data-redaction-id={redaction.id} className={styles.region} style={base}>
        <canvas className={styles.pixels} />
      </div>
    );
  }
  return (
    <div
      data-redaction-id={redaction.id}
      className={styles.region}
      style={{
        ...base,
        backdropFilter: `blur(${blurSigmaPx(redaction.intensity, frameHeightPx)}px)`,
      }}
    />
  );
}

export function RedactionLayer({
  redactions,
  videoRef,
  hidden,
}: {
  /** Only regions visible on the timeline (use-redaction-editing's visibleRedactions). */
  redactions: Redaction[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Hold-to-compare or a slide: render nothing. */
  hidden: boolean;
}): React.JSX.Element {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [heightPx, setHeightPx] = useState(0);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const measure = (): void => setHeightPx(el.clientHeight);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  const trigger = useMemo(() => ({ redactions, hidden }), [redactions, hidden]);
  useVideoFrameClock(
    videoRef,
    (t) => {
      const layer = layerRef.current;
      const video = videoRef.current;
      if (!layer || !video) return;
      for (const r of redactions) {
        const el = layer.querySelector<HTMLElement>(`[data-redaction-id="${r.id}"]`);
        if (!el) continue;
        const on =
          !hidden && t >= r.start - PREVIEW_PAD_SECONDS && t <= r.end + PREVIEW_PAD_SECONDS;
        el.style.display = on ? "" : "none";
        if (on && r.kind === "blur" && r.style === "pixelate") {
          drawPixelated(el.querySelector("canvas"), video, r);
        }
      }
    },
    trigger,
  );

  return (
    <div ref={layerRef} className={styles.layer} aria-hidden data-testid="redaction-layer">
      {redactions.map((r) => (
        <RedactionView key={r.id} redaction={r} frameHeightPx={heightPx} />
      ))}
    </div>
  );
}
