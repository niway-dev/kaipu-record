---
title: "Video editor v2 — 05 camera path model"
description: "Why a damped camera cannot be a stateless cameraAt(t), and the replacement: one deterministic simulation over source time with critically damped springs, lookahead, a deadzone and state clamping, sampled by preview and export alike. Resolves the follow-offset contradiction. Fixes audit W9."
sidebar:
  order: 5
---

# 05 — Camera path model

> **Status: 🔵 Proposed** (2026-09-21). Part of PR 4 in the
> [audit](/plans/video-editor-v2/00-audit/). Fixes W9. Pure TypeScript, no UI.

## Problem

The overview asks for `cameraAt(segments, track, t)` that is "deterministic given inputs
(no internal state)" **and** has a deadzone, critically damped easing and hysteresis.
Those are contradictory: easing depends on where the camera was a moment ago, a deadzone
depends on where it is aiming now. A stateless function either jumps (no easing) or
re-simulates from 0 on every call (O(n) per frame while scrubbing).

Also undefined: what happens between two segments, how zoom-in/out ramps, what the camera
does at the edge of the frame, and the follow mode's "drag defines the offset relative to
the cursor" (UI spec § 4.2), which the data model cannot store (`anchor` only in fixed).

## Decision

**Simulate once, sample everywhere.** `buildCameraPath(segments, track, sourceDuration)`
steps a small state machine at a fixed 60 Hz over the whole **source** timeline from
`t = 0` and stores `cx`, `cy`, `scale` in three `Float32Array`s. `cameraAt(path, t)` lerps
between two steps. Preview and export call the same function on the same path, so they
agree to the float; scrubbing is O(1).

Per step (`dt = 1/60 s`, `u = t + 0.2 s` lookahead):

1. **Active segment.** The segments are sorted and non-overlapping
   ([06](/plans/video-editor-v2/06-time-base-cuts-and-mapping/) enforces it) and the step
   looks one up **twice**: the segment still covering `t` wins; if there is none, the
   segment covering `u` opens. So a segment is active over `[start − 0.2 s, end]`. Target
   scale = its `scale`, else 1.
2. **Target center.** `fixed` with an anchor → the anchor. `fixed` with `anchor: null` →
   the target is left where it was, so the segment holds the frame centre; it must never
   fall through to the follow branch and secretly track the cursor. `follow` → the pointer
   at `u` (clamped to the display); with no cursor track at all (a window-source
   recording, or a pre-v2 file) the target is likewise left alone, so a `follow` segment
   zooms on the frame centre. On the step a segment becomes active the target jumps
   straight to the pointer; afterwards the target moves only when the pointer leaves a
   deadzone **centred on the current target** (half-size = 35 % of the visible
   half-window), and then only enough to put the pointer back on the deadzone edge. The
   deadzone is deliberately not measured from the camera centre: the camera is still
   easing toward the target, so measuring from it would re-trigger on every step. Outside
   segments the target stays where it was (the scale spring and the clamp bring the view
   home).
3. **Springs.** Critically damped springs (exact closed-form step, stable at any `dt`, no
   overshoot from rest) move center and scale toward their targets. `smoothing` maps
   linearly to the angular frequency: center ω 14 → 3 s⁻¹, scale ω 10 → 4 s⁻¹ for
   smoothing 0 → 100. Outside segments the last segment's smoothing is kept, so a zoom
   eases out the way it eased in.
4. **Clamp the state.** Scale to [1, `ZOOM_LIMITS.maxScale`]; center to
   [½/scale, 1 − ½/scale]. Velocity on a clamped axis is zeroed so springs never wind up
   against the frame edge.

The 0.2 s lookahead is the spec's anticipation: the camera starts moving before the click
because it already knows the click is coming. It is **anticipation only** — it may open a
segment early, never close one early. Looking the segment up at `u` alone (a single
lookup) would also zoom **out** 200 ms before `segment.end`, so the picture would stop
being zoomed while the timeline block, doc 09's camera box and doc 11's fast-path boundary
all still said it was. Hence the two lookups, and the test that pins the camera as still
zoomed at `end − 0.1 s`.

**Constants live in `zoom-model.ts`.** `CAMERA` carries only camera-specific numbers; the
scale ceiling is `ZOOM_LIMITS.maxScale` and the smoothing default is
`ZOOM_DEFAULTS.smoothing`, both imported from
[04](/plans/video-editor-v2/04-zoom-detection-algorithm/)'s model module so there is one
source of truth (and no import cycle — `zoom-model.ts` imports nothing).

**Follow-mode offset: removed.** Dragging the camera box of a `follow` segment switches it
to `fixed` at the dropped position (and makes it `manual`). The inspector's two buttons
remain the way back to Follow. One mental model, and nothing the data model cannot store.

**Recompute** whenever `segments`, the track or the duration change (`useMemo`). Cost,
measured: 26 ms for a 1-hour recording with 350 segments; ~0.5 ms per minute. A path for
one hour is 2.6 MB (3 × 216 k floats).

## Coordinates

`(cx, cy)` is the normalized center of the visible window; `scale` its magnification.
The window is `1/scale` of the frame on **both** axes, so it always has the frame's aspect
ratio. `cropRect(cam)` returns `{ x, y, w, h }` normalized; multiply by the frame size
(export) or use CSS percentages (preview).

## Files

| Action | Path (under `apps/kaipu-record/src/renderer/src/features/video-editor/zoom/`) |
| ------ | ----------------------------------------------------------------------------- |
| Create | `camera-path.ts` + `.test.ts`                                                 |
| Create | `use-camera-path.ts`                                                          |

## Tasks

### Task 1 — camera path

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/camera-path.ts`**

```ts
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
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/camera-path.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import { buildCameraPath, cameraAt, clampAnchor, cropRect, springStep } from "./camera-path";
import type { ZoomSegment } from "./zoom-model";

const DISPLAY = { id: "1", width: 1600, height: 1000, scaleFactor: 2 };

function track(partial: Partial<CursorTrack> = {}): CursorTrack {
  return {
    version: 1,
    display: DISPLAY,
    anchor: "exact",
    clicksAvailable: true,
    t: [],
    x: [],
    y: [],
    clicks: [],
    ...partial,
  };
}

function seg(partial: Partial<ZoomSegment>): ZoomSegment {
  return {
    id: "s",
    start: 0,
    end: 1,
    scale: 2,
    mode: "follow",
    anchor: null,
    smoothing: 70,
    origin: "auto",
    trigger: "click",
    ...partial,
  };
}

describe("springStep", () => {
  it("converges to the goal without overshoot from rest", () => {
    let x = 0;
    let v = 0;
    for (let i = 0; i < 600; i++) {
      [x, v] = springStep(x, v, 1, 8, 1 / 60);
      expect(x).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(x).toBeCloseTo(1, 6);
  });
});

describe("buildCameraPath", () => {
  it("is identity with no segments", () => {
    const path = buildCameraPath([], null, 2);
    expect(path.scale.length).toBe(121);
    expect(cameraAt(path, 1)).toEqual({ cx: 0.5, cy: 0.5, scale: 1 });
  });
  it("zooms in during a fixed segment, reaches the anchor, and zooms back out", () => {
    const path = buildCameraPath(
      [seg({ start: 1, end: 5, mode: "fixed", anchor: { x: 0.7, y: 0.6 }, smoothing: 0 })],
      null,
      8,
    );
    const mid = cameraAt(path, 4);
    expect(mid.scale).toBeCloseTo(2, 2);
    expect(mid.cx).toBeCloseTo(0.7, 2);
    expect(mid.cy).toBeCloseTo(0.6, 2);
    expect(cameraAt(path, 7.9).scale).toBeCloseTo(1, 2);
  });
  it("starts moving before the segment (lookahead)", () => {
    const path = buildCameraPath(
      [seg({ start: 2, end: 4, mode: "fixed", anchor: { x: 0.7, y: 0.5 } })],
      null,
      5,
    );
    expect(cameraAt(path, 1.7).scale).toBe(1);
    expect(cameraAt(path, 1.95).scale).toBeGreaterThan(1);
  });
  it("stays zoomed until the segment's end (the lookahead never closes early)", () => {
    const path = buildCameraPath(
      [seg({ start: 1, end: 5, mode: "fixed", anchor: { x: 0.7, y: 0.5 }, smoothing: 0 })],
      null,
      8,
    );
    // The camera must still be on the segment 100 ms before its end, or the timeline
    // block, the camera box and the export fast path all disagree with the picture.
    expect(cameraAt(path, 4.9).scale).toBeCloseTo(2, 2);
    expect(cameraAt(path, 5.3).scale).toBeLessThan(1.9);
  });
  it("never lets the window leave the frame", () => {
    const path = buildCameraPath(
      [seg({ start: 0, end: 5, mode: "fixed", anchor: { x: 1, y: 0 }, scale: 4, smoothing: 0 })],
      null,
      5,
    );
    for (let i = 0; i < path.scale.length; i++) {
      const r = cropRect({ cx: path.cx[i], cy: path.cy[i], scale: path.scale[i] });
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
  it("follow mode ignores pointer motion inside the deadzone", () => {
    // Pointer sits at 0.5 then wiggles by 0.02 — well inside the deadzone at 2×.
    const tr = track({
      t: [0, 3000, 3100, 3200, 6000],
      x: [0.5, 0.5, 0.52, 0.5, 0.5],
      y: [0.5, 0.5, 0.5, 0.5, 0.5],
    });
    const path = buildCameraPath([seg({ start: 0, end: 6, smoothing: 0 })], tr, 6);
    expect(cameraAt(path, 3.1).cx).toBeCloseTo(0.5, 3);
  });
  it("follow mode tracks the pointer when it leaves the deadzone", () => {
    const tr = track({
      t: [0, 2000, 2100, 6000],
      x: [0.3, 0.3, 0.7, 0.7],
      y: [0.5, 0.5, 0.5, 0.5],
    });
    const path = buildCameraPath([seg({ start: 0, end: 6, smoothing: 0 })], tr, 6);
    const later = cameraAt(path, 5);
    // Target = pointer − deadzone half (0.35 × 0.25) = 0.6125.
    expect(later.cx).toBeCloseTo(0.6125, 2);
  });
  it("a fixed segment with a null anchor holds the frame centre instead of following", () => {
    const tr = track({ t: [0, 6000], x: [0.9, 0.9], y: [0.9, 0.9] });
    const path = buildCameraPath(
      [seg({ start: 0, end: 6, mode: "fixed", anchor: null, smoothing: 0 })],
      tr,
      6,
    );
    const mid = cameraAt(path, 3);
    expect(mid.scale).toBeCloseTo(2, 2);
    expect(mid.cx).toBeCloseTo(0.5, 3);
    expect(mid.cy).toBeCloseTo(0.5, 3);
  });
  it("a follow segment without a cursor track zooms on the frame centre", () => {
    const path = buildCameraPath([seg({ start: 0, end: 4, smoothing: 0 })], null, 4);
    const mid = cameraAt(path, 2);
    expect(mid.scale).toBeCloseTo(2, 2);
    expect(mid.cx).toBeCloseTo(0.5, 3);
    expect(mid.cy).toBeCloseTo(0.5, 3);
  });
  it("is deterministic", () => {
    const s = [seg({ start: 1, end: 3 })];
    const tr = track({ t: [0, 3000], x: [0.2, 0.8], y: [0.2, 0.8] });
    expect(buildCameraPath(s, tr, 4)).toEqual(buildCameraPath(s, tr, 4));
  });
});

describe("clampAnchor", () => {
  it("keeps a 2× window inside the frame", () => {
    expect(clampAnchor({ x: 0.9, y: 0.1 }, 2)).toEqual({ x: 0.75, y: 0.25 });
  });
});
```

### Task 2 — memo hook

- [ ] Create:

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/use-camera-path.ts`**

```ts
import { useMemo } from "react";
import type { CursorTrack } from "@shared/cursor-track";
import { buildCameraPath, type CameraPath } from "./camera-path";
import type { ZoomSegment } from "./zoom-model";

/**
 * The camera path for the current scene. Rebuilt only when its inputs change by
 * reference — `zoomSegments` is replaced (never mutated) on every edit, so a drag
 * rebuilds it once per live update, which is cheap (~0.5 ms per minute of video).
 */
export function useCameraPath(
  segments: ZoomSegment[],
  track: CursorTrack | null,
  sourceDurationSeconds: number,
): CameraPath {
  return useMemo(
    () => buildCameraPath(segments, track, sourceDurationSeconds),
    [segments, track, sourceDurationSeconds],
  );
}
```

No test: it is a one-line memo over a tested function.

## Consumers (later PRs — do not implement here)

- Preview ([09](/plans/video-editor-v2/09-preview-compositing/)): per video frame,
  `cameraAt(path, video.currentTime)` → CSS transform.
- Export ([11](/plans/video-editor-v2/11-export-pass/)): the renderer builds the path
  with the same function and transfers the three arrays to the worker; per decoded frame,
  `cameraAt(path, frame.timestamp)` → `drawImage` source rect.
- Camera box ([09](/plans/video-editor-v2/09-preview-compositing/)): shows `cropRect` of
  the camera at the playhead; dragging writes `anchor = clampAnchor(center, scale)`.

## Acceptance criteria

- All tests in `camera-path.test.ts` pass unchanged.
- `buildCameraPath` never produces a crop rect outside [0, 1] (test "never lets the
  window leave the frame" covers scale 4 at a corner).
- Two calls with equal inputs return equal arrays.
- The camera is still at the segment's scale at `end − 0.1 s`: the lookahead opens a
  segment early and never closes one early.
- A `fixed` segment with `anchor: null` and a `follow` segment with no cursor track both
  zoom on the frame centre; neither follows the pointer.
- `CAMERA` contains no copy of `ZOOM_LIMITS.maxScale` or `ZOOM_DEFAULTS.smoothing`.

## Non-goals

Keyframes, editable easing curves, rotation, motion blur, per-segment ramp durations.

## Reopen if

Users report the camera "lags" on fast pointer motion at high smoothing (raise
`centerOmegaSmooth`) or v2.1 needs the path at output fps > 60 (raise `CAMERA.fps`; the
tests do not depend on it except the 121-step identity case).
