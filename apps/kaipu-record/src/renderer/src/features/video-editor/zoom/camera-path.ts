/**
 * Camera model. Damping, deadzone and "what did the camera aim at last" are STATE —
 * a camera with easing cannot be a stateless `cameraAt(t)`. To stay deterministic
 * (preview scrubbing and export must agree frame for frame) the whole camera is
 * SIMULATED ONCE over the source timeline at a fixed step (`CAMERA.fps`) from t = 0,
 * and every consumer samples the resulting path with `cameraAt(path, t)`.
 *
 * Same inputs → same Float32Arrays → identical preview and export. Recompute the
 * path whenever `segments` (or the track/duration) change; ~1 ms per minute of video.
 *
 * Coordinates: (cx, cy) is the normalized CENTER of the visible window; `scale` is the
 * magnification (1 = whole frame). The visible window is 1/scale of the frame on each
 * axis, so it always keeps the frame's aspect ratio.
 */
import { type CursorTrack, sampleCursor } from "@shared/cursor-track";
import { ZOOM_DEFAULTS, ZOOM_LIMITS, type ZoomSegment } from "./zoom-model";

export const CAMERA = {
  /** Simulation + sampling rate of the path. */
  fps: 60,
  /** The camera reacts to where the pointer WILL be (spec: ~200 ms anticipation). */
  lookaheadSeconds: 0.2,
  /** Half-size of the deadzone around the current TARGET, as a fraction of the visible half-window. */
  deadzone: 0.35,
  /** Spring angular frequency (1/s) for the center at smoothing 0 and 100. */
  centerOmegaSnappy: 14,
  centerOmegaSmooth: 3,
  /** Same for the scale. */
  scaleOmegaSnappy: 10,
  scaleOmegaSmooth: 4,
} as const;

export interface CameraPath {
  fps: number;
  cx: Float32Array;
  cy: Float32Array;
  scale: Float32Array;
}

export interface CameraState {
  cx: number;
  cy: number;
  scale: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * One exact step of a critically damped spring toward `goal` (stable for any dt,
 * never overshoots from rest). Returns [position, velocity].
 */
export function springStep(
  x: number,
  v: number,
  goal: number,
  omega: number,
  dt: number,
): [number, number] {
  const d = x - goal;
  const k = (v + omega * d) * dt;
  const e = Math.exp(-omega * dt);
  return [goal + (d + k) * e, (v - omega * k) * e];
}

/** The segment covering source time `t`, walking forward from `hint` (segments sorted, non-overlapping). */
function segmentAt(segments: ZoomSegment[], t: number, hint: { i: number }): ZoomSegment | null {
  while (hint.i < segments.length && segments[hint.i].end <= t) hint.i++;
  const s = segments[hint.i];
  return s && s.start <= t ? s : null;
}

export function buildCameraPath(
  segments: ZoomSegment[],
  track: CursorTrack | null,
  sourceDurationSeconds: number,
): CameraPath {
  const fps = CAMERA.fps;
  const n = Math.max(1, Math.ceil(sourceDurationSeconds * fps) + 1);
  const cxOut = new Float32Array(n);
  const cyOut = new Float32Array(n);
  const scaleOut = new Float32Array(n);
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const dt = 1 / fps;
  // Two independent cursors into `sorted`: one for `t`, one for the lookahead `u`.
  const hintNow = { i: 0 };
  const hintAhead = { i: 0 };

  let cx = 0.5;
  let cy = 0.5;
  let vx = 0;
  let vy = 0;
  let s = 1;
  let vs = 0;
  let tx = 0.5;
  let ty = 0.5;
  let smoothing: number = ZOOM_DEFAULTS.smoothing;
  let activeId: string | null = null;

  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const u = t + CAMERA.lookaheadSeconds;
    // The lookahead is ANTICIPATION: it may open a segment early, never close one
    // early. Looking the segment up at `u` alone would also zoom OUT 200 ms before
    // `segment.end`, desynchronising the camera from the timeline block, the camera
    // box and the export fast path. So: a segment still covering `t` wins; otherwise
    // the one the camera can already see coming at `u` opens.
    const open = segmentAt(sorted, t, hintNow);
    const opening = segmentAt(sorted, u, hintAhead);
    const seg = open ?? opening;
    const targetScale = seg ? clamp(seg.scale, 1, ZOOM_LIMITS.maxScale) : 1;

    if (seg) {
      smoothing = seg.smoothing;
      if (seg.mode === "fixed" && seg.anchor) {
        tx = seg.anchor.x;
        ty = seg.anchor.y;
      } else if (seg.mode === "fixed") {
        // A fixed segment whose anchor is null holds the target where it already was
        // (the frame centre on a fresh path). It must NOT fall through to the follow
        // branch and silently track the cursor.
      } else if (track) {
        const p = sampleCursor(track, u * 1000);
        if (p) {
          const px = clamp(p.x, 0, 1);
          const py = clamp(p.y, 0, 1);
          if (seg.id !== activeId) {
            // Entering a segment: aim straight at the action, no deadzone.
            tx = px;
            ty = py;
          } else {
            // The deadzone is measured from the current TARGET, not from the camera
            // centre: the camera is still easing toward the target, so measuring from
            // it would re-trigger on every step and defeat the deadzone.
            const dz = CAMERA.deadzone * (0.5 / Math.max(s, 1));
            if (px > tx + dz) tx = px - dz;
            else if (px < tx - dz) tx = px + dz;
            if (py > ty + dz) ty = py - dz;
            else if (py < ty - dz) ty = py + dz;
          }
        }
      }
      // `follow` with no cursor track (window source, pre-v2 recording) leaves the
      // target alone too — the segment zooms on the frame centre.
    }
    activeId = seg ? seg.id : null;

    if (i > 0) {
      const k = clamp(smoothing, 0, 100) / 100;
      const wc = lerp(CAMERA.centerOmegaSnappy, CAMERA.centerOmegaSmooth, k);
      const ws = lerp(CAMERA.scaleOmegaSnappy, CAMERA.scaleOmegaSmooth, k);
      [cx, vx] = springStep(cx, vx, tx, wc, dt);
      [cy, vy] = springStep(cy, vy, ty, wc, dt);
      [s, vs] = springStep(s, vs, targetScale, ws, dt);
    }

    // Clamp the STATE (not just the output) so springs never wind up past the frame.
    if (s < 1 || s > ZOOM_LIMITS.maxScale) {
      s = clamp(s, 1, ZOOM_LIMITS.maxScale);
      vs = 0;
    }
    const half = 0.5 / s;
    if (cx < half || cx > 1 - half) {
      cx = clamp(cx, half, 1 - half);
      vx = 0;
    }
    if (cy < half || cy > 1 - half) {
      cy = clamp(cy, half, 1 - half);
      vy = 0;
    }

    cxOut[i] = cx;
    cyOut[i] = cy;
    scaleOut[i] = s;
  }
  return { fps, cx: cxOut, cy: cyOut, scale: scaleOut };
}

/** Camera at source time `t` (seconds), linearly interpolated between path steps. */
export function cameraAt(path: CameraPath, t: number): CameraState {
  const n = path.scale.length;
  const f = clamp(t * path.fps, 0, n - 1);
  const i = Math.floor(f);
  const j = Math.min(n - 1, i + 1);
  const k = f - i;
  return {
    cx: lerp(path.cx[i], path.cx[j], k),
    cy: lerp(path.cy[i], path.cy[j], k),
    scale: lerp(path.scale[i], path.scale[j], k),
  };
}

/** Normalized visible window for a camera state. */
export function cropRect(cam: CameraState): CropRect {
  const w = 1 / cam.scale;
  return { x: cam.cx - w / 2, y: cam.cy - w / 2, w, h: w };
}

/** True when the camera is (visually) not zoomed — lets preview/export take the fast path. */
export function isIdentity(cam: CameraState): boolean {
  return cam.scale < 1.001;
}

/** A fixed anchor clamped so a window of `scale` stays inside the frame. */
export function clampAnchor(
  anchor: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  const half = 0.5 / Math.max(1, scale);
  return { x: clamp(anchor.x, half, 1 - half), y: clamp(anchor.y, half, 1 - half) };
}
