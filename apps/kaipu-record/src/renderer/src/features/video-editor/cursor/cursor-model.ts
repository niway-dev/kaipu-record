/** Pure, source-time cursor model shared by preview and both export workers. */
import {
  isOnDisplay,
  lastIndexAtOrBefore,
  sampleCursor,
  type CursorTrack,
} from "@shared/cursor-track";
import { canOverlayRecordedCursor, type CursorPixelProvenance } from "@shared/native-capture";
import type { CameraState } from "../zoom/camera-path";
import { cropRect } from "../zoom/camera-path";
import type { Redaction } from "../privacy/redaction";

export interface CursorSettings {
  visible: boolean;
  style: "arrow" | "dot" | "spotlight";
  /** Size in pixels on a 1080-high output; independent of camera magnification.
   * The inspector moves it on a logarithmic scale (`cursorSizeToSlider`). */
  size: number;
  smoothing: number;
  clickEffect: "none" | "circle" | "ripple";
  clickBounce: boolean;
  idleHide: boolean;
}
export const CURSOR_SIZE_MIN = 16;
export const CURSOR_SIZE_MAX = 240;
export const DEFAULT_CURSOR: Readonly<CursorSettings> = Object.freeze({
  visible: true,
  style: "arrow",
  size: 56,
  smoothing: 50,
  clickEffect: "ripple",
  clickBounce: true,
  idleHide: false,
});
/** Slider position 0–100 ↔ size. Each step grows the cursor by the same ratio, so the
 * large end is noticeably larger instead of crawling a few pixels at a time. */
export function cursorSizeToSlider(size: number): number {
  const clamped = Math.max(CURSOR_SIZE_MIN, Math.min(CURSOR_SIZE_MAX, size));
  return (100 * Math.log(clamped / CURSOR_SIZE_MIN)) / Math.log(CURSOR_SIZE_MAX / CURSOR_SIZE_MIN);
}
export function cursorSliderToSize(position: number): number {
  const p = Math.max(0, Math.min(100, position)) / 100;
  return Math.round(CURSOR_SIZE_MIN * (CURSOR_SIZE_MAX / CURSOR_SIZE_MIN) ** p);
}
export function parseCursorSettings(raw: unknown): CursorSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CURSOR };
  const r = raw as Record<string, unknown>;
  const num = (key: string, min: number, max: number, fallback: number): number =>
    typeof r[key] === "number" && Number.isFinite(r[key])
      ? Math.max(min, Math.min(max, r[key] as number))
      : fallback;
  return {
    visible: typeof r.visible === "boolean" ? r.visible : DEFAULT_CURSOR.visible,
    style: r.style === "dot" || r.style === "spotlight" ? r.style : "arrow",
    size: num("size", CURSOR_SIZE_MIN, CURSOR_SIZE_MAX, DEFAULT_CURSOR.size),
    smoothing: num("smoothing", 0, 100, DEFAULT_CURSOR.smoothing),
    clickEffect:
      r.clickEffect === "none" || r.clickEffect === "circle" || r.clickEffect === "ripple"
        ? r.clickEffect
        : DEFAULT_CURSOR.clickEffect,
    clickBounce: typeof r.clickBounce === "boolean" ? r.clickBounce : DEFAULT_CURSOR.clickBounce,
    idleHide: typeof r.idleHide === "boolean" ? r.idleHide : DEFAULT_CURSOR.idleHide,
  };
}
export interface CursorLayerData {
  track: CursorTrack;
  settings: CursorSettings;
}
export function cursorLayerData(
  capture: { cursorPixels?: CursorPixelProvenance } | null | undefined,
  track: CursorTrack | null,
  settings: CursorSettings = DEFAULT_CURSOR,
): CursorLayerData | null {
  return canOverlayRecordedCursor(capture) ? overlayLayerData(track, settings) : null;
}
/** For a track whose eligibility was already decided per recording (`axisOverlayTrack`). */
export function overlayLayerData(
  track: CursorTrack | null,
  settings: CursorSettings = DEFAULT_CURSOR,
): CursorLayerData | null {
  return track?.t.length ? { track, settings } : null;
}
export interface CursorFrame {
  x: number;
  y: number;
  size: number;
  style: CursorSettings["style"];
  bounce: number;
  click: null | { x: number; y: number; progress: number; effect: "circle" | "ripple" };
}
/** Precompute a zero-lag smoothing filter and last movement times ONCE per settings/track.
 * Sampling never depends on playback history, seek direction, frame rate or cut order. */
export function prepareCursor(track: CursorTrack, settings: CursorSettings) {
  const x = track.x.slice(),
    y = track.y.slice(),
    moved = track.t.slice();
  const tau = settings.smoothing * 2;
  const n = track.t.length;
  const discontinuity = (i: number, j: number): boolean =>
    !isOnDisplay({ x: track.x[i], y: track.y[i] }) ||
    !isOnDisplay({ x: track.x[j], y: track.y[j] });
  const gain = (i: number, j: number): number =>
    tau > 0 && !discontinuity(i, j) ? 1 - Math.exp(-Math.abs(track.t[i] - track.t[j]) / tau) : 1;
  // A forward pass alone trails the real pointer by about tau, so a click ring would
  // appear before the cursor reaches it. The whole track is known, so a backward pass
  // cancels that lag (forward-backward filtering is zero-phase).
  for (let i = 1; i < n; i++) {
    const k = gain(i, i - 1);
    x[i] = x[i - 1] + (x[i] - x[i - 1]) * k;
    y[i] = y[i - 1] + (y[i] - y[i - 1]) * k;
  }
  for (let i = n - 2; i >= 0; i--) {
    const k = gain(i, i + 1);
    x[i] = x[i + 1] + (x[i] - x[i + 1]) * k;
    y[i] = y[i + 1] + (y[i] - y[i + 1]) * k;
  }
  let movementAnchor = 0;
  for (let i = 1; i < n; i++) {
    if (
      Math.hypot(track.x[i] - track.x[movementAnchor], track.y[i] - track.y[movementAnchor]) <
      0.0005
    )
      moved[i] = moved[i - 1];
    else movementAnchor = i;
  }
  const filtered = { ...track, x, y };
  const clicks = track.clicksAvailable ? track.clicks : [];
  const clickTimes = clicks.map((c) => c.t);
  return (
    sourceSeconds: number,
    camera: CameraState,
    width: number,
    height: number,
    redactions: Redaction[] = [],
  ): CursorFrame | null => {
    const t = sourceSeconds * 1000;
    if (
      !settings.visible ||
      !track.t.length ||
      t < 0 ||
      (track.truncatedAtMs !== undefined && t >= track.truncatedAtMs)
    )
      return null;
    const raw = sampleCursor(track, t),
      p = sampleCursor(filtered, t);
    if (!raw || !p || !isOnDisplay(raw) || !isOnDisplay(p)) return null;
    const i = lastIndexAtOrBefore(track.t, t);
    const ci = lastIndexAtOrBefore(clickTimes, t);
    const click = ci >= 0 ? clicks[ci] : null;
    const age = click ? t - click.t : Infinity;
    if (settings.idleHide && t - Math.max(moved[Math.max(0, i)], click?.t ?? -Infinity) >= 1500)
      return null;
    const crop = cropRect(camera);
    const project = (point: { x: number; y: number }) => ({
      x: ((point.x - crop.x) / crop.w) * width,
      y: ((point.y - crop.y) / crop.h) * height,
    });
    const at = project(p);
    if (at.x < 0 || at.x > width || at.y < 0 || at.y > height) return null;
    // Privacy wins: suppress the entire layer while a redaction overlaps this source
    // instant. Neither pointer motion nor click locations can disclose hidden content.
    if (redactions.some((r) => sourceSeconds >= r.start && sourceSeconds <= r.end)) return null;
    const effect = settings.clickEffect;
    return {
      ...at,
      size: (settings.size * height) / 1080,
      style: settings.style,
      bounce: settings.clickBounce && age < 240 ? 1 - 0.15 * Math.sin((age / 240) * Math.PI) : 1,
      click:
        click && age < 500 && effect !== "none" && isOnDisplay(click)
          ? { ...project(click), progress: age / 500, effect }
          : null,
    };
  };
}
/** The exact same Canvas2D painter runs in the editor and export. No source pixels read. */
export function drawCursor(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CursorFrame | null,
): void {
  if (!frame) return;
  ctx.save();
  if (frame.click) {
    // A dark band under a white one stays visible on light and dark screens alike.
    const c = frame.click;
    const radius = frame.size * (c.effect === "ripple" ? 0.35 + 0.65 * c.progress : 0.6);
    const fade = 1 - c.progress;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    if (c.effect === "circle") {
      ctx.globalAlpha = fade * 0.35;
      ctx.fillStyle = "#18181b";
      ctx.fill();
    }
    ctx.globalAlpha = fade * 0.55;
    ctx.strokeStyle = "#18181b";
    ctx.lineWidth = Math.max(2, frame.size / 7);
    ctx.stroke();
    ctx.globalAlpha = fade * 0.95;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, frame.size / 16);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Soft drop shadow in output pixels (shadow sizes ignore the transform below).
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = Math.max(1, frame.size * 0.12);
  ctx.shadowOffsetY = Math.max(1, frame.size * 0.04);
  ctx.translate(frame.x, frame.y);
  ctx.scale(frame.size * frame.bounce, frame.size * frame.bounce);
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (frame.style === "spotlight") {
    ctx.arc(0, 0, 1.25, 0, Math.PI * 2);
    ctx.fillStyle = "#ffdc58";
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.restore();
    return;
  }
  if (frame.style === "arrow") {
    // The macOS arrow: black body, white rim. Hotspot at the tip (0, 0); 1 unit = height.
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 0.84);
    ctx.lineTo(0.21, 0.64);
    ctx.lineTo(0.36, 0.98);
    ctx.lineTo(0.5, 0.92);
    ctx.lineTo(0.36, 0.59);
    ctx.lineTo(0.63, 0.59);
    ctx.closePath();
  } else {
    ctx.arc(0, 0, 0.22, 0, Math.PI * 2);
  }
  // The rim is a wide white stroke under the fill; only its outer half shows.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 0.13;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.restore();
}
