---
title: "Video editor v2 — 09 preview compositing"
description: "The live preview without encoding: a content layer that receives the camera as a per-frame CSS transform driven by requestVideoFrameCallback, the result view vs the zoom-edit view with a draggable camera box, the inspector's Follow/Lock control, hold-to-compare, pointer mapping under the transform, and the layer contract redactions plug into. Verified diffs. Fixes audit W13."
sidebar:
  order: 9
---

# 09 — Preview compositing

> **Status: 🟡 In progress** (2026-09-22). PR 7 ("Preview camera") in the
> [audit](/plans/video-editor-v2/00-audit/); defines the layer slot PR 8 uses. Fixes W13.
> Requires PR 6 ([08](/plans/video-editor-v2/08-editor-layout-and-tracks/)). Implemented
> on `feat/video-editor-v2-preview-camera` — not merged, not validated in production; see
> the [backlog PR table](/backlog/video-editor-zoom-blur-cover/).

## Problem

The overview gives the preview one bullet: "`camera-box.tsx` on `preview-stage`; preview
canvas applies `cameraAt(t)` as a CSS transform on the video element". Missing:

- **When** the preview is zoomed. The UI spec shows the camera box "only with a zoom
  selected", over the _full_ frame with a scrim — so while editing a zoom the preview
  cannot also be zoomed. Two views, never named.
- **How often** the transform updates. React state at `timeupdate` (~4 Hz) would visibly
  step; the playhead already uses a rAF subscription, but it emits _timeline_ time, and
  a rAF tick is not a video frame.
- **What** is transformed. Transforming only `<video>` leaves annotations (and later,
  redactions) behind in screen space — the exact failure the spec's composition order
  forbids for privacy regions.
- **Pointer math** for drawing annotations/regions while zoomed.
- Slides, fullscreen, hold-to-compare.

## Decisions

**Layers** inside `PreviewStage` (`overflow: hidden`, shrink-wrapping `.content`):

```
.stage (clips)
├── .content  ← camera transform (transform-origin 0 0), sized from the decoded ratio
│   ├── <video>
│   ├── slide <img>            (when a slide is under the playhead)
│   ├── underlay               privacy regions (PR 8) — under annotations
│   └── overlay                VideoAnnotationLayer (unchanged)
└── chrome                     NOT transformed: camera box, hold button, chip
```

This is the export order `frame → redactions → overlays → crop` expressed as DOM
(overview decision 2: annotations are content-pinned).

The `underlay` slot is inside the transformed layer for a reason beyond ordering: a blur
region there uses `backdrop-filter`, which blurs what is behind it **in the element's own
(camera-transformed) space**, so its radius scales with the camera exactly as the
export's pre-crop blur does. That parity argument, and the fallback if a GPU disagrees,
are worked out in
[10 § PR 8 Task 3](/plans/video-editor-v2/10-redactions-rendering-and-leaks/#task-3--preview-layer-underlay).

**Two views**, derived — no extra state:

| View          | When                                         | Camera transform | Chrome                                                                             |
| ------------- | -------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| Result        | nothing or a non-zoom item selected          | applied          | hold button                                                                        |
| Zoom edit     | a zoom is selected                           | identity         | camera box + scrim, hold button                                                    |
| Original held | "Hold to see original" pressed (either view) | identity         | chip `ORIGINAL · SIN EDITAR` only; box, privacy regions **and annotations** hidden |
| Slide         | the playhead is on a slide                   | identity         | hold button                                                                        |

**"Original" means original.** The chip says `SIN EDITAR` / `UNEDITED`, so the held frame
must not carry annotations either — the `overlay` slot is gated on `!holdingOriginal`
alongside the `underlay` one. Consequences, all acceptable: the hold has no pointer
surface (you are holding a button, not drawing), and background-click play/pause pauses
with it. Nothing is lost, because a draw or a text edit and a hold cannot overlap — the
hold owns the pointer from its own pointerdown.

**Cutting away a selected zoom is not a deselection.** `selectedZoom` is looked up in
`zooms.visibleZooms`, so deleting the footage under the selected zoom makes it `null`:
the preview returns to the result view and the inspector to the Detection panel, all
without extra code. `selectedZoomId` itself is **deliberately not cleared** (doc 07's
stale-selection effect only fires when the segment leaves `scene.zoomSegments`, which a
cut never does) — so undoing the cut brings the zoom back _still selected_, camera box
and all.

**Per-frame, no React.** `useVideoFrameClock(videoRef, onTime, trigger)` calls back with
the **source** media time of each presented frame (`requestVideoFrameCallback` →
`metadata.mediaTime`), plus `seeked`/`timeupdate` for paused scrubbing and jsdom. The
camera writes `style.transform` directly. The camera box writes its own
`left/top/width/height`. Frame-exact matters most for PR 8: a redaction that turns on
one rAF late would flash the secret in the preview.

**Transform math** (`cameraTransform`): with `transform-origin: 0 0`,
`scale(s) translate(−x·100%, −y·100%)` maps the window's top-left to the element's
top-left and its size to the element's size (`x, y` = the crop rect's origin).

**Pointer mapping** needs no change: `VideoAnnotationLayer` normalizes pointer positions
with `getBoundingClientRect()` of its own element, which **is** transformed, so a point
under the pointer maps to the right place in the original frame. Handles and hit
tolerances scale with the zoom (visually bigger) — accepted.

**`.content` is sized from the decoded frame ratio, not shrink-wrapped.** Today `.stage`
wraps the `<video>`, whose `width/height: auto` + `max-height: 46vh` + `max-width: 64vw`
make its box track the real aspect. That stops working once a wrapper exists: when the
**height** cap binds (a tall window, a 4:3 recording), a shrink-to-fit `.content` takes
its width from `max-content` and ignores the height cap, so the wrapper ends up wider
than the picture. Everything the camera box does is a percentage of `.content` —
position, size, and the `clientX → normalized` conversion in the drag — so the box would
frame a rectangle that is not the frame, and the scrim would darken the wrong strip.
Fix: `.content` carries the caps and an explicit `aspect-ratio` taken from
`videoWidth / videoHeight` at `loadedmetadata`, with `width: min(64vw, 46vh × ratio)` so
**both** caps bind without breaking the ratio; the `<video>` fills it at `100% / 100%`.
The wrapper is then the picture, by construction. `.stage` keeps shrink-wrapping
`.content`, which matters because the camera box lives in the `chrome` slot and is
therefore positioned against `.stage` — the two rectangles must stay identical. Slides
keep their own `object-fit: contain` + black backdrop inside that box, exactly as today.

**`.stage { overflow: hidden }` is a real, accepted regression.** It is what clips the
zoomed content layer, and it also clips anything an annotation draws _outside_ the frame:
the four resize handles of an overlay flush against an edge are drawn half outside, and
the inline text input (`min-width: 60px`, positioned at the click point) is cut off when
the user clicks near the right edge. Both were previously allowed to spill past the
video. Decision: **accept for v2** — the alternative (a transparent inset on `.stage` big
enough for a handle, ~8 px, with the clip moved to a dedicated inner element) buys a few
pixels of handle and costs a second sizing chain to keep in sync with the camera math.
Revisit if users report losing the end of a label typed at the right edge.

**Camera box** (zoom edit view): size `1/scale` of the frame; center = the fixed anchor,
or the simulated follow camera at the playhead clamped into the segment's time range.
Dragging calls `zooms.begin()` / `zooms.liveLock(id, center)` / `zooms.end()`: one undo
step, and the segment becomes `fixed` + `manual` (doc 05). **Only the box's frame is
draggable**: the box covers up to the whole picture, so a hit-testable interior would
swallow every click meant for an annotation underneath it (and the spec still calls for
clicking a region to select it). The box element is `pointer-events: none` and four edge
strips along its border are `pointer-events: auto`; the handlers stay on the box and
receive the bubbled events, and the pointer capture taken on pointerdown is what keeps
the drag alive once the pointer leaves those thin strips.

**Hold to compare**: pointer-down/up (and Space/Enter while focused, with
`stopPropagation` so Space does not also toggle play). While held: no camera, no box, no
privacy regions, chip shown.

## Files

| Action | Path (under `apps/kaipu-record/src/renderer/src/features/video-editor/`)  |
| ------ | ------------------------------------------------------------------------- |
| Create | `use-video-frame-clock.ts` + `.test.ts`                                   |
| Create | `zoom/camera-css.ts` + `.test.ts`, `zoom/use-camera-preview.ts`           |
| Create | `components/camera-box.tsx` + `.module.css`                               |
| Create | `components/hold-original-button.tsx` + `.module.css`                     |
| Create | `components/preview-chrome.test.tsx`                                      |
| Create | `zoom/use-camera-path.test.ts`                                            |
| Modify | `zoom/use-camera-path.ts` (throttle live rebuilds — Task 2)               |
| Modify | `components/preview-stage.tsx` + `.module.css`                            |
| Modify | `components/inspector/zoom-inspector.tsx`, `inspector/inspector.test.tsx` |
| Modify | `pages/video-editor/video-editor-page.tsx` (`src/renderer/src/pages/…`)   |

`zoom/use-camera-path.ts` comes from [05 Task 2](/plans/video-editor-v2/05-camera-path-model/#task-2--memo-hook)
(PR 4); Task 2 below changes how often it rebuilds, not what it builds.

i18n keys for this PR. The last five are the Follow / Lock control's, deferred here from
PR 6 ([08](/plans/video-editor-v2/08-editor-layout-and-tracks/)) because locking needs the
camera path:

| Key                | es                                                                                   | en                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `holdOriginal`     | Mantén para ver el original                                                          | Hold to see original                                                            |
| `originalChip`     | ORIGINAL · SIN EDITAR                                                                | ORIGINAL · UNEDITED                                                             |
| `cameraChipFollow` | {level}× · SIGUE                                                                     | {level}× · FOLLOW                                                               |
| `cameraChipLocked` | {level}× · FIJO                                                                      | {level}× · LOCKED                                                               |
| `zoomMode`         | Modo                                                                                 | Mode                                                                            |
| `zoomFollow`       | Seguir cursor                                                                        | Follow cursor                                                                   |
| `zoomLock`         | Fijar aquí                                                                           | Lock here                                                                       |
| `zoomFollowNote`   | La cámara empieza a moverse ~200 ms antes de cada clic, para que se vea intencional. | The camera starts moving ~200 ms before each click, so it reads as intentional. |
| `zoomLockNote`     | Fijado en el recuadro que colocaste en la vista previa. Arrástralo para reencuadrar. | Locked to the box you positioned on the preview. Drag it to re-aim.             |

Paste into `packages/i18n/messages/es.json` → `"videoEditor"` (without the outer braces):

```json
{
  "holdOriginal": "Mantén para ver el original",
  "originalChip": "ORIGINAL · SIN EDITAR",
  "cameraChipFollow": "{level}× · SIGUE",
  "cameraChipLocked": "{level}× · FIJO",
  "zoomMode": "Modo",
  "zoomFollow": "Seguir cursor",
  "zoomLock": "Fijar aquí",
  "zoomFollowNote": "La cámara empieza a moverse ~200 ms antes de cada clic, para que se vea intencional.",
  "zoomLockNote": "Fijado en el recuadro que colocaste en la vista previa. Arrástralo para reencuadrar."
}
```

and into `packages/i18n/messages/en.json` → `"videoEditor"`:

```json
{
  "holdOriginal": "Hold to see original",
  "originalChip": "ORIGINAL · UNEDITED",
  "cameraChipFollow": "{level}× · FOLLOW",
  "cameraChipLocked": "{level}× · LOCKED",
  "zoomMode": "Mode",
  "zoomFollow": "Follow cursor",
  "zoomLock": "Lock here",
  "zoomFollowNote": "The camera starts moving ~200 ms before each click, so it reads as intentional.",
  "zoomLockNote": "Locked to the box you positioned on the preview. Drag it to re-aim."
}
```

## Tasks

### Task 1 — frame clock

**`apps/kaipu-record/src/renderer/src/features/video-editor/use-video-frame-clock.ts`**

```ts
/**
 * Calls `onTime(sourceSeconds)` for every presented video frame and after every seek,
 * WITHOUT re-rendering React. Preview layers that depend on source time (camera
 * transform, redaction visibility, camera box) write to the DOM from this callback.
 *
 * `requestVideoFrameCallback` gives the exact media time of the frame on screen, so the
 * camera and redactions change on the same frame the picture does — a redaction that
 * appeared one rAF late would flash the secret. `seeked`/`timeupdate` cover paused
 * scrubbing and environments without rVFC (jsdom).
 *
 * Two effects on purpose. The subscription depends only on the element: `onTime` is held
 * in a ref (it is a new closure on every render) and `trigger` is NOT a dependency of
 * it. If it were, a camera-box drag — which produces a new camera path per pointermove —
 * would cancel and re-request the frame callback dozens of times a second, and a
 * cancel/request pair straddling a presented frame simply loses that frame. The second
 * effect is the whole point of `trigger`: re-apply the CURRENT callback at once, so a
 * new path reaches the DOM without waiting for the next frame.
 */
import { useEffect, useRef } from "react";

export function useVideoFrameClock(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onTime: (sourceSeconds: number) => void,
  /** Re-run the callback immediately when this value changes (e.g. a new camera path). */
  trigger?: unknown,
): void {
  const callback = useRef(onTime);
  callback.current = onTime;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    callback.current(video.currentTime);
    let stopped = false;
    let handle = 0;
    const hasFrameCallback = typeof video.requestVideoFrameCallback === "function";
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (stopped) return;
      callback.current(metadata.mediaTime);
      handle = video.requestVideoFrameCallback(onFrame);
    };
    if (hasFrameCallback) handle = video.requestVideoFrameCallback(onFrame);
    const onSeek = (): void => callback.current(video.currentTime);
    video.addEventListener("seeked", onSeek);
    video.addEventListener("timeupdate", onSeek);
    return () => {
      stopped = true;
      if (hasFrameCallback) video.cancelVideoFrameCallback(handle);
      video.removeEventListener("seeked", onSeek);
      video.removeEventListener("timeupdate", onSeek);
    };
  }, [videoRef]);

  // Live updates land here, not in the subscription above: same loop, fresh callback.
  useEffect(() => {
    const video = videoRef.current;
    if (video) callback.current(video.currentTime);
  }, [videoRef, trigger]);
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/use-video-frame-clock.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVideoFrameClock } from "./use-video-frame-clock";

describe("useVideoFrameClock (no rVFC, like jsdom)", () => {
  it("fires on mount and on seeked/timeupdate with the source time", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 0, writable: true });
    const onTime = vi.fn();
    const { unmount } = renderHook(() => useVideoFrameClock({ current: video }, onTime));
    expect(onTime).toHaveBeenLastCalledWith(0);
    video.currentTime = 4.2;
    video.dispatchEvent(new Event("seeked"));
    expect(onTime).toHaveBeenLastCalledWith(4.2);
    unmount();
    video.currentTime = 9;
    video.dispatchEvent(new Event("timeupdate"));
    expect(onTime).toHaveBeenLastCalledWith(4.2);
  });

  it("uses requestVideoFrameCallback media time when available", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 0, writable: true });
    let frame: VideoFrameRequestCallback | null = null;
    video.requestVideoFrameCallback = (cb) => {
      frame = cb;
      return 1;
    };
    video.cancelVideoFrameCallback = vi.fn();
    const onTime = vi.fn();
    renderHook(() => useVideoFrameClock({ current: video }, onTime));
    frame!(0, { mediaTime: 7.5 } as VideoFrameCallbackMetadata);
    expect(onTime).toHaveBeenLastCalledWith(7.5);
  });

  it("re-applies the callback on a new trigger without re-subscribing", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "currentTime", { value: 3, writable: true });
    const request = vi.fn(() => 1);
    const cancel = vi.fn();
    video.requestVideoFrameCallback = request;
    video.cancelVideoFrameCallback = cancel;
    const onTime = vi.fn();
    // Hoisted, NOT `{ current: video }` inline: a fresh ref object per render changes the
    // subscription effect's own dependency, so the hook would re-subscribe for that reason
    // and the assertion below would prove nothing about `trigger`. The page passes
    // `playback.videoRef`, which is a stable useRef.
    const videoRef = { current: video };
    const { rerender } = renderHook(
      ({ trigger }) => useVideoFrameClock(videoRef, onTime, trigger),
      { initialProps: { trigger: {} } },
    );
    expect(request).toHaveBeenCalledTimes(1);
    // A live gesture produces a new trigger per pointermove. The rVFC loop must survive
    // it — tearing it down and re-requesting can drop the frame in between.
    rerender({ trigger: {} });
    rerender({ trigger: {} });
    expect(request).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    // 4, not 3: on mount BOTH effects apply the callback (subscribe, then trigger). The
    // double apply is idempotent — it only writes the DOM — and the property this test
    // exists for is `request === 1 && cancel === 0`.
    expect(onTime).toHaveBeenCalledTimes(4);
    expect(onTime).toHaveBeenLastCalledWith(3);
  });
});
```

### Task 2 — camera transform and one path rebuild per frame

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/camera-css.ts`**

```ts
/**
 * CSS transform that shows the camera window of `cam` filling the element. Apply with
 * `transform-origin: 0 0`. A point p (px) maps to s · (p − x·W): translate first (by
 * the window's offset, as a % of the element's own size), then scale.
 */
import { type CameraState, cropRect } from "./camera-path";

export function cameraTransform(cam: CameraState): string {
  const r = cropRect(cam);
  return `scale(${cam.scale}) translate(${-r.x * 100}%, ${-r.y * 100}%)`;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/camera-css.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { cameraTransform } from "./camera-css";

describe("cameraTransform", () => {
  it("maps the window's top-left to the element's top-left", () => {
    // 2× centered on (0.75, 0.25): window x = 0.5, y = 0.
    expect(cameraTransform({ cx: 0.75, cy: 0.25, scale: 2 })).toBe("scale(2) translate(-50%, 0%)");
  });
  it("is a no-op at 1×, centered", () => {
    expect(cameraTransform({ cx: 0.5, cy: 0.5, scale: 1 })).toBe("scale(1) translate(0%, 0%)");
  });
});
```

PR 4's `useCameraPath` is a bare `useMemo`, which was the right call when nothing dragged
yet. This PR makes three things change the path **continuously**: the Level and
Smoothness sliders, the zoom-lane edge handles and the camera box itself. Each live
update replaces `scene.zoomSegments`, so the memo misses and `buildCameraPath` re-runs
over the **whole source** — [05](/plans/video-editor-v2/05-camera-path-model/) measures
26 ms and 2.6 MB for a one-hour recording. At pointermove rate that is a frozen preview
and a GC storm on long recordings, while at most one of those rebuilds per frame is ever
displayed.

Throttle the rebuild to one per animation frame, keeping doc 05's invariant intact — one
simulation, one path, every consumer sampling it. The first build stays synchronous (no
frame of un-zoomed video on open); every later change is applied on the next frame from
the **latest** inputs, so intermediate pointermove positions are skipped, not queued.

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/use-camera-path.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import type { CursorTrack } from "@shared/cursor-track";
import { buildCameraPath, type CameraPath } from "./camera-path";
import type { ZoomSegment } from "./zoom-model";

interface Inputs {
  segments: ZoomSegment[];
  track: CursorTrack | null;
  sourceDurationSeconds: number;
}

/**
 * The camera path for the current scene: ONE simulation shared by the preview and the
 * export (doc 05). Rebuilt at most once per animation frame.
 *
 * buildCameraPath walks the entire source — 26 ms / 2.6 MB for an hour of recording —
 * and `zoomSegments` is replaced on every live update of a slider, an edge drag or the
 * camera box. Rebuilding synchronously per pointermove would spend all of it on paths
 * that are never drawn. Coalescing to one rebuild per frame from the latest inputs
 * costs at most one frame of staleness and bounds the work at what the screen can show.
 */
export function useCameraPath(
  segments: ZoomSegment[],
  track: CursorTrack | null,
  sourceDurationSeconds: number,
): CameraPath {
  const latest = useRef<Inputs>({ segments, track, sourceDurationSeconds });
  latest.current = { segments, track, sourceDurationSeconds };
  // Synchronous first build: the very first painted frame is already zoomed correctly.
  const built = useRef<Inputs>(latest.current);
  const [path, setPath] = useState<CameraPath>(() =>
    buildCameraPath(segments, track, sourceDurationSeconds),
  );
  const frame = useRef(0);

  // No dependency array: this compares references itself, because the point is to react
  // to input changes WITHOUT scheduling work for each one.
  useEffect(() => {
    const now = latest.current;
    const done = built.current;
    if (
      done.segments === now.segments &&
      done.track === now.track &&
      done.sourceDurationSeconds === now.sourceDurationSeconds
    ) {
      return;
    }
    if (frame.current !== 0) return; // a rebuild is already queued; it will read `latest`
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const inputs = latest.current;
      built.current = inputs;
      setPath(buildCameraPath(inputs.segments, inputs.track, inputs.sourceDurationSeconds));
    });
  });

  useEffect(() => {
    return () => {
      if (frame.current !== 0) cancelAnimationFrame(frame.current);
    };
  }, []);

  return path;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/use-camera-path.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { cameraAt } from "./camera-path";
import { useCameraPath } from "./use-camera-path";
import type { ZoomSegment } from "./zoom-model";

const seg = (scale: number): ZoomSegment => ({
  id: "z",
  start: 0,
  end: 4,
  scale,
  mode: "fixed",
  anchor: { x: 0.5, y: 0.5 },
  smoothing: 0,
  origin: "manual",
  trigger: null,
});

/** requestAnimationFrame under our control, so "one rebuild per frame" is observable. */
function manualFrames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return {
    pending: () => queue.length,
    flush: () => {
      for (const cb of queue.splice(0)) cb(0);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useCameraPath", () => {
  it("builds synchronously on mount", () => {
    manualFrames();
    const { result } = renderHook(() => useCameraPath([seg(2)], null, 4));
    expect(cameraAt(result.current, 3).scale).toBeGreaterThan(1);
  });

  it("coalesces a burst of live updates into one rebuild of the last inputs", () => {
    const frames = manualFrames();
    const { result, rerender } = renderHook(
      ({ segments }) => useCameraPath(segments, null, 4),
      { initialProps: { segments: [] as ZoomSegment[] } },
    );
    const first = result.current;

    // Three pointermove ticks inside one frame — the hook must schedule exactly once.
    rerender({ segments: [seg(1.5)] });
    rerender({ segments: [seg(2)] });
    rerender({ segments: [seg(3)] });
    expect(frames.pending()).toBe(1);
    expect(result.current).toBe(first); // still the previous path, not yet rebuilt

    act(() => frames.flush());
    expect(result.current).not.toBe(first);
    // The LAST inputs won; the intermediate scales were skipped, not queued.
    expect(cameraAt(result.current, 3).scale).toBeCloseTo(3, 5);
    expect(frames.pending()).toBe(0);
  });
});
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/use-camera-preview.ts`**

```ts
/**
 * Result view: applies the camera of the current frame to the preview content element
 * as a CSS transform — no re-encode, no React re-render per frame (UI spec rule 6).
 * `enabled = false` (a zoom is being edited, the original is held, a slide is showing)
 * clears the transform so the full original frame is visible.
 */
import { useMemo } from "react";
import { useVideoFrameClock } from "../use-video-frame-clock";
import { type CameraPath, cameraAt, isIdentity } from "./camera-path";
import { cameraTransform } from "./camera-css";

export function useCameraPreview(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  path: CameraPath,
  enabled: boolean,
): void {
  const trigger = useMemo(() => ({ path, enabled }), [path, enabled]);
  useVideoFrameClock(
    videoRef,
    (t) => {
      const el = contentRef.current;
      if (!el) return;
      const cam = cameraAt(path, t);
      el.style.transform = enabled && !isIdentity(cam) ? cameraTransform(cam) : "";
    },
    trigger,
  );
}
```

### Task 3 — camera box and hold button

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/camera-box.tsx`**

```tsx
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
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/camera-box.module.css`**

```css
/* UI spec § 4.2 — frame, ticks, scrim, chip. */
.box {
  position: absolute;
  border: 1.5px solid var(--accent-primary);
  /* Scrim: darkens everything outside the window without fully hiding it. */
  box-shadow: 0 0 0 9999px rgba(8, 8, 10, 0.5);
  /* The interior is transparent to the pointer: at 1.2× the box is nearly the whole
     picture, and an opaque interior would swallow every click meant for an annotation
     under it. Only .edge is hit-testable; events bubble from it to this element's
     handlers, and the pointer capture taken on pointerdown carries the rest of the drag. */
  pointer-events: none;
  touch-action: none;
  z-index: 4;
}

/* Draggable frame: a 14 px strip straddling each border, wide enough to grab. */
.edge {
  position: absolute;
  pointer-events: auto;
  cursor: move;
  touch-action: none;
}

.edgeTop {
  top: -6px;
  left: -6px;
  right: -6px;
  height: 14px;
}

.edgeBottom {
  bottom: -6px;
  left: -6px;
  right: -6px;
  height: 14px;
}

.edgeLeft {
  top: -6px;
  bottom: -6px;
  left: -6px;
  width: 14px;
}

.edgeRight {
  top: -6px;
  bottom: -6px;
  right: -6px;
  width: 14px;
}

.chip {
  position: absolute;
  top: -11px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: rgba(8, 8, 10, 0.85);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
}

.tick {
  position: absolute;
  width: 10px;
  height: 10px;
  border-color: var(--accent-primary);
  border-style: solid;
  pointer-events: none;
}

.tl {
  top: -4px;
  left: -4px;
  border-width: 3px 0 0 3px;
}

.tr {
  top: -4px;
  right: -4px;
  border-width: 3px 3px 0 0;
}

.bl {
  bottom: -4px;
  left: -4px;
  border-width: 0 0 3px 3px;
}

.br {
  bottom: -4px;
  right: -4px;
  border-width: 0 3px 3px 0;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/hold-original-button.tsx`**

```tsx
/**
 * "Hold to see original" (UI spec § 4.5): while pressed, the preview shows the raw frame —
 * no camera, no camera box, no privacy regions, no annotations — and an
 * "ORIGINAL · UNEDITED" chip. The only honest way to judge the edit, and the only state
 * where a secret is readable.
 */
import { Eye } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./hold-original-button.module.css";

export function HoldOriginalButton({
  holding,
  onHoldChange,
}: {
  holding: boolean;
  onHoldChange(holding: boolean): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const release = (): void => onHoldChange(false);
  return (
    <>
      {holding && <span className={styles.chip}>{t("originalChip")}</span>}
      <button
        type="button"
        aria-pressed={holding}
        className={holding ? `${styles.button} ${styles.active}` : styles.button}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          onHoldChange(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        // Fallback only, and only while actually holding: once setPointerCapture
        // succeeds the pointer never "leaves" the button, so pointerup/pointercancel
        // end every real hold. Unguarded, this fired a state write on every hover-out.
        onPointerLeave={() => {
          if (holding) onHoldChange(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== " " && event.key !== "Enter") return;
          // Keep Space from also reaching the page's play/pause shortcut.
          event.preventDefault();
          event.stopPropagation();
          onHoldChange(true);
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") release();
        }}
      >
        <Eye size={14} />
        {t("holdOriginal")}
      </button>
    </>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/hold-original-button.module.css`**

```css
.button {
  position: absolute;
  right: var(--space-sm);
  bottom: var(--space-sm);
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, #fff 18%, transparent);
  border-radius: 999px;
  background: rgba(8, 8, 10, 0.45);
  backdrop-filter: blur(8px);
  color: #fff;
  font-size: var(--font-size-xs);
  cursor: pointer;
  user-select: none;
  touch-action: none;
}

.active {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.chip {
  position: absolute;
  top: var(--space-sm);
  left: var(--space-sm);
  z-index: 5;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: rgba(8, 8, 10, 0.85);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 10px;
  pointer-events: none;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-chrome.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildCameraPath } from "../zoom/camera-path";
import type { ZoomSegment } from "../zoom/zoom-model";
import { boxCenterAt, CameraBox } from "./camera-box";
import { HoldOriginalButton } from "./hold-original-button";

const FIXED: ZoomSegment = {
  id: "z",
  start: 1,
  end: 4,
  scale: 2,
  mode: "fixed",
  anchor: { x: 0.9, y: 0.5 },
  smoothing: 70,
  origin: "manual",
  trigger: null,
};

function videoAt(t: number): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "currentTime", { value: t, writable: true });
  return video;
}

describe("boxCenterAt", () => {
  it("uses the clamped anchor for fixed segments", () => {
    expect(boxCenterAt(FIXED, buildCameraPath([], null, 5), 2)).toEqual({ x: 0.75, y: 0.5 });
  });
  it("follows the simulated camera for follow segments", () => {
    const seg = { ...FIXED, mode: "follow" as const, anchor: null };
    expect(boxCenterAt(seg, buildCameraPath([], null, 5), 2)).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("CameraBox", () => {
  it("is sized 1/scale and placed at the anchor", () => {
    render(
      <div>
        <CameraBox
          videoRef={{ current: videoAt(2) }}
          path={buildCameraPath([], null, 5)}
          segment={FIXED}
          onBegin={vi.fn()}
          onMove={vi.fn()}
          onEnd={vi.fn()}
        />
      </div>,
    );
    const box = screen.getByTestId("camera-box");
    expect(box.style.width).toBe("50%");
    expect(box.style.left).toBe("50%");
    expect(screen.getByText("2.0× · LOCKED")).toBeInTheDocument();
  });

  it("drags as begin → move (clamped center) → end", () => {
    const onBegin = vi.fn();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const { container } = render(
      <div>
        <CameraBox
          videoRef={{ current: videoAt(2) }}
          path={buildCameraPath([], null, 5)}
          segment={FIXED}
          onBegin={onBegin}
          onMove={onMove}
          onEnd={onEnd}
        />
      </div>,
    );
    const stage = container.firstElementChild as HTMLElement;
    stage.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
        right: 1000,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const box = screen.getByTestId("camera-box");
    // The drag starts on an edge strip — the interior is pointer-transparent — and
    // bubbles to the box, which owns the handlers and the pointer capture.
    const edge = box.querySelector('[data-camera-edge="top"]') as HTMLElement;
    fireEvent.pointerDown(edge, { pointerId: 1, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(box, { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerUp(box, { pointerId: 1 });
    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenLastCalledWith({ x: 0.55, y: 0.75 });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends the drag when the pointer capture is lost, and only once", () => {
    const onEnd = vi.fn();
    const { container } = render(
      <div>
        <CameraBox
          videoRef={{ current: videoAt(2) }}
          path={buildCameraPath([], null, 5)}
          segment={FIXED}
          onBegin={vi.fn()}
          onMove={vi.fn()}
          onEnd={onEnd}
        />
      </div>,
    );
    const stage = container.firstElementChild as HTMLElement;
    stage.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 1000,
        height: 500,
        right: 1000,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const box = screen.getByTestId("camera-box");
    fireEvent.pointerDown(box, { pointerId: 1, clientX: 500, clientY: 250 });
    // No pointerup: the gesture is taken away. Without the abort handlers the scene
    // controller would stay `interacting` and every later commit would no-op.
    fireEvent.lostPointerCapture(box, { pointerId: 1 });
    fireEvent.pointerCancel(box, { pointerId: 1 });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("HoldOriginalButton", () => {
  it("holds while pressed and shows the chip", () => {
    const onHoldChange = vi.fn();
    const { rerender } = render(<HoldOriginalButton holding={false} onHoldChange={onHoldChange} />);
    const button = screen.getByRole("button", { name: /Hold to see original/ });
    fireEvent.pointerDown(button, { pointerId: 1 });
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    rerender(<HoldOriginalButton holding onHoldChange={onHoldChange} />);
    expect(screen.getByText("ORIGINAL · UNEDITED")).toBeInTheDocument();
    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });

  it("ignores pointerleave when it is not holding", () => {
    const onHoldChange = vi.fn();
    render(<HoldOriginalButton holding={false} onHoldChange={onHoldChange} />);
    fireEvent.pointerLeave(screen.getByRole("button"), { pointerId: 1 });
    expect(onHoldChange).not.toHaveBeenCalled();
  });

  it("Space holds without reaching window listeners", () => {
    const onHoldChange = vi.fn();
    const windowKey = vi.fn();
    window.addEventListener("keydown", windowKey);
    render(<HoldOriginalButton holding={false} onHoldChange={onHoldChange} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: " " });
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    expect(windowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", windowKey);
  });
});
```

### Task 4 — zoom inspector: Follow / Lock

The spec's Mode control (§ 7.1) was held back from PR 6 because "Lock here" has to pin
the camera **where the user is currently looking**, and that position is
`cameraAt(cameraPath, …)` — which did not exist yet. Committing a bare
`{ mode: "fixed" }` would let `updateZoom` fill the missing anchor with `{0.5, 0.5}` and
snap the camera to the frame centre, contradicting the button's own copy ("Locked to the
box you positioned on the preview"). Now that the path exists, the inspector takes an
`anchorNow()` prop and commits mode **and** anchor together, in one undoable step.

`anchorNow` is supplied by the page as `boxCenterAt(segment, cameraPath, sourceTime)` —
literally "where the camera box is right now", already clamped into the frame — so
pressing Lock never moves the picture. Going back to Follow clears the anchor.

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/zoom-inspector.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/zoom-inspector.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/zoom-inspector.tsx
@@ -1,11 +1,12 @@
 /**
  * Inspector for a selected zoom (UI spec § 7.1): origin badge, range, Level, Smoothness
- * and Remove. Every control edits through ZoomEditing, which flips the segment to
- * `origin: "manual"`.
- *
- * The spec's Follow / Lock Mode control is NOT here yet: "Lock here" has to pin the
- * camera where the user is currently looking, and that position only exists once the
- * camera path does. It ships with the preview in PR 7 (plans/video-editor-v2/09).
+ * Mode and Remove. Every control edits through ZoomEditing, which flips the segment to
+ * `origin: "manual"`.
+ *
+ * "Lock here" commits the mode AND the anchor in one step: `anchorNow()` is where the
+ * camera box sits at this instant, so locking freezes the picture the user is looking
+ * at. Without the anchor, updateZoom would fall back to the frame centre and the camera
+ * would jump (plans/video-editor-v2/09).
  */
-import { Trash2 } from "lucide-react";
+import { Crosshair, Lock, Trash2 } from "lucide-react";
 import { useTranslations } from "@kaipu/i18n";
@@ -20,14 +21,17 @@
 export function ZoomInspector({
   segment,
   index,
   layout,
   zooms,
+  anchorNow,
   onRemoved,
 }: {
   segment: ZoomSegment;
   /** 1-based position among the visible zooms, for the "Zoom 2" header. */
   index: number;
   layout: LayoutEntry[];
   zooms: ZoomEditing;
+  /** Where the camera box is right now, normalized and clamped — the anchor Lock pins. */
+  anchorNow(): { x: number; y: number };
   onRemoved(): void;
 }): React.JSX.Element {
@@ -60,6 +64,28 @@
         onCommit={(smoothing) => zooms.commitPatch(segment.id, { smoothing })}
       />
-      {/* PR 7 inserts the Follow / Lock Mode control and its note here. */}
+      <div className={styles.segmented} role="group" aria-label={t("zoomMode")}>
+        <button
+          type="button"
+          aria-pressed={segment.mode === "follow"}
+          className={segment.mode === "follow" ? styles.segmentActive : styles.segment}
+          onClick={() => zooms.commitPatch(segment.id, { mode: "follow", anchor: null })}
+        >
+          <Crosshair size={14} />
+          {t("zoomFollow")}
+        </button>
+        <button
+          type="button"
+          aria-pressed={segment.mode === "fixed"}
+          className={segment.mode === "fixed" ? styles.segmentActive : styles.segment}
+          onClick={() => zooms.commitPatch(segment.id, { mode: "fixed", anchor: anchorNow() })}
+        >
+          <Lock size={14} />
+          {t("zoomLock")}
+        </button>
+      </div>
+      <p className={styles.note}>
+        {segment.mode === "follow" ? t("zoomFollowNote") : t("zoomLockNote")}
+      </p>
       <button
         type="button"
         className={styles.dangerButton}
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/inspector.test.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/inspector.test.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/inspector.test.tsx
@@ -60,11 +60,12 @@
 describe("ZoomInspector", () => {
   it("renders header, badge, range and the two sliders", () => {
     render(
       <ZoomInspector
         segment={SEGMENT}
         index={2}
         layout={layout}
         zooms={zooms()}
+        anchorNow={() => ({ x: 0.5, y: 0.5 })}
         onRemoved={vi.fn()}
       />,
     );
@@ -73,16 +74,23 @@
     expect(screen.getByRole("slider", { name: "Level" })).toBeInTheDocument();
     expect(screen.getByRole("slider", { name: "Smoothness" })).toBeInTheDocument();
   });
-  it("has no Mode control until PR 7 supplies the camera path", () => {
+  it("locks at the camera box's current position, not the frame centre", () => {
+    const z = zooms();
     render(
       <ZoomInspector
         segment={SEGMENT}
         index={1}
         layout={layout}
-        zooms={zooms()}
+        zooms={z}
+        anchorNow={() => ({ x: 0.82, y: 0.31 })}
         onRemoved={vi.fn()}
       />,
     );
-    expect(screen.queryByRole("button", { name: /Lock here/ })).toBeNull();
+    fireEvent.click(screen.getByRole("button", { name: /Lock here/ }));
+    expect(z.commitPatch).toHaveBeenCalledWith("z1", {
+      mode: "fixed",
+      anchor: { x: 0.82, y: 0.31 },
+    });
+    expect(screen.getByText(/200 ms before each click/)).toBeInTheDocument();
   });
   it("removes and clears the selection", () => {
```

The "removes and clears the selection" case also needs the new prop; add
`anchorNow={() => ({ x: 0.5, y: 0.5 })}` to its `<ZoomInspector>` exactly as above.

### Task 5 — preview stage layers

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.tsx
@@ -1,3 +1,4 @@
+import { useState } from "react";
 import type { PreviewPlayback } from "../use-preview-playback";
 import styles from "./preview-stage.module.css";

@@ -6,6 +7,9 @@
   mediaUrl,
   slideUrl,
   overlay,
+  underlay,
+  chrome,
+  contentRef,
   expanded = false,
 }: {
   playback: PreviewPlayback;
@@ -18,31 +22,56 @@
    *  position:relative wrapper, which (per preview-stage.module.css) shrinks to
    *  exactly the video's own rendered box, so the overlay covers it exactly. */
   overlay?: React.ReactNode;
+  /** Privacy regions (video-editor v2): inside the content layer, UNDER the annotations,
+   *  so they zoom with the footage — export order frame → redactions → overlays → crop. */
+  underlay?: React.ReactNode;
+  /** Stage-level UI that must NOT zoom: camera box, hold-to-compare button and chip. */
+  chrome?: React.ReactNode;
+  /** The content layer (video + slide + underlay + overlay); the camera transform is
+   *  written to it per frame by useCameraPreview. */
+  contentRef?: React.Ref<HTMLDivElement>;
   /** In fullscreen the bounded (contained-player) size caps are lifted so the video
    *  fills the screen. Off by default — normal editing keeps the compact player. */
   expanded?: boolean;
 }): React.JSX.Element {
+  // The content layer is sized from the DECODED frame ratio, not shrink-wrapped around
+  // the <video>: with a height cap binding, a shrink-to-fit wrapper keeps its max-content
+  // width and ends up wider than the picture, which would misplace the camera box (all
+  // of whose geometry is a % of this element) and its scrim. 16:9 until metadata lands.
+  const [ratio, setRatio] = useState(16 / 9);
   return (
     <div className={styles.stage}>
-      <video
-        ref={playback.videoRef}
-        className={expanded ? `${styles.video} ${styles.videoExpanded}` : styles.video}
-        src={mediaUrl}
-        onTimeUpdate={playback.onVideoTimeUpdate}
-        onEnded={playback.onVideoEnded}
-        // Keep `playing` in sync with what the element actually does — a rejected play()
-        // (e.g. interrupted by a seek) leaves it paused, and these events stop the
-        // transport from getting stuck showing "pause" while nothing plays.
-        onPlay={playback.onVideoPlay}
-        onPause={playback.onVideoPause}
-        // Dead in practice — the overlay above is a full-cover sibling that always
-        // wins the hit-test, so this click never reaches the video. Kept as a
-        // harmless fallback for any future render path without an overlay; the real
-        // toggle-on-click now comes from VideoAnnotationLayer's onBackgroundClick.
-        onClick={playback.toggle}
-      />
-      {slideUrl && <img className={styles.slide} src={slideUrl} alt="" draggable={false} />}
-      {overlay}
+      <div
+        ref={contentRef}
+        className={expanded ? `${styles.content} ${styles.contentExpanded}` : styles.content}
+        style={{ "--frame-ratio": ratio } as React.CSSProperties}
+      >
+        <video
+          ref={playback.videoRef}
+          className={styles.video}
+          src={mediaUrl}
+          onTimeUpdate={playback.onVideoTimeUpdate}
+          onEnded={playback.onVideoEnded}
+          onLoadedMetadata={(event) => {
+            const { videoWidth, videoHeight } = event.currentTarget;
+            if (videoWidth > 0 && videoHeight > 0) setRatio(videoWidth / videoHeight);
+          }}
+          // Keep `playing` in sync with what the element actually does — a rejected play()
+          // (e.g. interrupted by a seek) leaves it paused, and these events stop the
+          // transport from getting stuck showing "pause" while nothing plays.
+          onPlay={playback.onVideoPlay}
+          onPause={playback.onVideoPause}
+          // Dead in practice — the overlay above is a full-cover sibling that always
+          // wins the hit-test, so this click never reaches the video. Kept as a
+          // harmless fallback for any future render path without an overlay; the real
+          // toggle-on-click now comes from VideoAnnotationLayer's onBackgroundClick.
+          onClick={playback.toggle}
+        />
+        {slideUrl && <img className={styles.slide} src={slideUrl} alt="" draggable={false} />}
+        {underlay}
+        {overlay}
+      </div>
+      {chrome}
     </div>
   );
 }
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.module.css`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.module.css
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/preview-stage.module.css
@@ -1,31 +1,50 @@
 .stage {
   /* Relative so plan 04 can layer the annotation SVG over the video. */
   position: relative;
   max-width: 100%;
   max-height: 100%;
+  /* v2: clips the zoomed content layer to the frame. Known consequence: an annotation's
+     resize handles right at the frame edge, and the inline text input opened near the
+     right edge, are clipped too — accepted, see the "overflow: hidden is a real
+     regression" decision in plans/video-editor-v2/09. */
+  overflow: hidden;
 }

-.video {
-  display: block;
-  /* Contained-player sizing (CapCut-style): the video is a compact, centered box, NOT
-     the full-width protagonist, so the toolbar/transport/timeline stay comfortable.
-     Caps are viewport-relative on purpose — a `max-height: 100%` here resolves against
-     this element's auto-height wrapper and is ignored, which let the video stretch to
-     full width. `vh`/`vw` always resolve, so both dimensions actually bind. width/height
-     stay auto so the element box tracks the video's real aspect (no internal letterbox),
-     keeping the annotation overlay aligned to the wrapper. */
-  width: auto;
-  height: auto;
-  max-height: 46vh;
-  max-width: 64vw;
-  object-fit: contain;
-}
-
-/* Fullscreen: lift the compact caps so the video fills the screen. */
-.videoExpanded {
-  max-height: 100vh;
-  max-width: 100vw;
-}
+/* v2: everything that belongs to the FOOTAGE (video, slide, privacy regions,
+   annotations) lives here and receives the camera transform.
+
+   It also takes over the contained-player caps that used to sit on .video, plus an
+   explicit aspect-ratio fed from the decoded frame size (--frame-ratio, set inline on
+   loadedmetadata). Shrink-wrapping the <video> is not enough: when the HEIGHT cap binds,
+   a max-content wrapper keeps its full width while the video letterboxes inside it, and
+   the camera box — positioned, sized and drag-converted in percentages of THIS element —
+   would frame a rectangle that is not the picture. `width: min(capW, capH × ratio)` lets
+   both caps bind while keeping the ratio exact, so this box IS the picture. */
+.content {
+  position: relative;
+  transform-origin: 0 0;
+  aspect-ratio: var(--frame-ratio);
+  width: min(64vw, calc(46vh * var(--frame-ratio)));
+  max-width: 64vw;
+  max-height: 46vh;
+}
+
+/* Fullscreen: lift the compact caps, keep the ratio. */
+.contentExpanded {
+  width: min(100vw, calc(100vh * var(--frame-ratio)));
+  max-width: 100vw;
+  max-height: 100vh;
+}
+
+/* The video fills a box that already has its exact aspect ratio, so there is nothing to
+   letterbox; object-fit stays `contain` as a guard for the frames decoded before
+   loadedmetadata reports the real size. */
+.video {
+  display: block;
+  width: 100%;
+  height: 100%;
+  object-fit: contain;
+}

 /* Slide image: covers the video's rendered box exactly (the .stage wrapper shrinks to
    it). Black backdrop + object-fit: contain so any aspect ratio letterboxes cleanly
```

`.videoExpanded` disappears with this diff — `expanded` now switches `.content`, which is
what carries the caps. The slide rule is unchanged: it is `inset: 0` inside `.content`,
which is still exactly the picture's box.

### Task 6 — page wiring

On top of PR 6's page. Adds `contentRef`, `holdingOriginal`, the camera path, the
camera preview hook (enabled only in the result view, off slides, not while holding), and
the chrome (camera box in the zoom edit view + hold button).

**Diff — `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
+++ b/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
@@ -59,6 +59,10 @@
 import { EditorInspector } from "@renderer/features/video-editor/components/inspector/editor-inspector";
 import { DetectionPanel } from "@renderer/features/video-editor/components/inspector/detection-panel";
 import { ZoomInspector } from "@renderer/features/video-editor/components/inspector/zoom-inspector";
+import { boxCenterAt, CameraBox } from "@renderer/features/video-editor/components/camera-box";
+import { HoldOriginalButton } from "@renderer/features/video-editor/components/hold-original-button";
+import { useCameraPath } from "@renderer/features/video-editor/zoom/use-camera-path";
+import { useCameraPreview } from "@renderer/features/video-editor/zoom/use-camera-preview";
 import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
 import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
 import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
@@ -280,6 +284,9 @@
     sourceDuration: source.durationSeconds,
     cursorTrack,
   });
+  // One camera simulation shared by the preview (useCameraPreview) and the export (doc 05).
+  // Declared before any callback that closes over it (handleExport).
+  const cameraPath = useCameraPath(scene.zoomSegments, cursorTrack, source.durationSeconds);
   // Evidence for the Activity lane — depends only on the (immutable) track.
   const activity = useMemo(
     () => (cursorTrack ? activityMarks(cursorTrack, source.durationSeconds) : []),
@@ -629,6 +636,17 @@
   const selectedZoom = selectedZoomId
     ? (zooms.visibleZooms.find((z) => z.id === selectedZoomId) ?? null)
     : null;
+
+  // Preview camera (doc 09). Result view applies the camera; selecting a zoom switches to
+  // the zoom-edit view (full frame + camera box); holding "original" shows the raw frame.
+  const contentRef = useRef<HTMLDivElement | null>(null);
+  const [holdingOriginal, setHoldingOriginal] = useState(false);
+  useCameraPreview(
+    playback.videoRef,
+    contentRef,
+    cameraPath,
+    !holdingOriginal && selectedZoom === null && playback.activeSlideId === null,
+  );

   useEffect(() => {
     const onKey = (e: KeyboardEvent): void => {
@@ -730,6 +748,26 @@
               mediaUrl={mediaUrl}
               slideUrl={slideUrl}
               expanded={isFullscreen}
+              contentRef={contentRef}
+              chrome={
+                <>
+                  {selectedZoom && !holdingOriginal && playback.activeSlideId === null && (
+                    <CameraBox
+                      videoRef={playback.videoRef}
+                      path={cameraPath}
+                      segment={selectedZoom}
+                      onBegin={zooms.begin}
+                      onMove={(center) => zooms.liveLock(selectedZoom.id, center)}
+                      onEnd={zooms.end}
+                    />
+                  )}
+                  <HoldOriginalButton holding={holdingOriginal} onHoldChange={setHoldingOriginal} />
+                </>
+              }
-              overlay={
-                <VideoAnnotationLayer
-                  overlays={scene.overlays}
+              // "Hold to see original" must show the ORIGINAL: the chip says UNEDITED,
+              // so the annotation layer goes with the camera and the privacy regions.
+              // The hold owns the pointer, so no in-progress draw can be interrupted.
+              overlay={
+                !holdingOriginal && (
+                  <VideoAnnotationLayer
+                    overlays={scene.overlays}
@@ -812,6 +850,13 @@
               index={zooms.visibleZooms.indexOf(selectedZoom) + 1}
               layout={layout}
               zooms={zooms}
+              anchorNow={() =>
+                boxCenterAt(
+                  selectedZoom,
+                  cameraPath,
+                  sourceTimeAtTimeline(layout, playback.timelineTime) ?? selectedZoom.start,
+                )
+              }
               onRemoved={() => selectKind("zoom", null)}
             />
           ) : (
```

The rest of the `<VideoAnnotationLayer …>` block is re-indented by two spaces inside the
new `!holdingOriginal && ( … )`, and its closing `/>` gains a `)`. Nothing else about it
changes.

The last hunk hands the inspector the anchor "Lock here" should pin (Task 4). It is the
camera box's current position, so locking never moves the picture; off a clip
(`sourceTimeAtTimeline` → `null`) it falls back to the segment's own start.

### Task 7 — verify

- [ ] Checks (audit rule 4). Verified before publishing: with PRs 5–7 applied to `main`,
      `check-types:web` is clean and the renderer suite passes (the video editor + page
      folders, including the unchanged page test). The count moved with the tests this
      revision adds — take the suite's own number, not a figure from this document.
- [ ] Manual (PR 2 recording, a few detected zooms):
  - Play with nothing selected: the preview zooms in ~200 ms before each click, follows
    the pointer, eases out; no stepping at 30/60 fps.
  - Scrub while paused: the zoom matches the playhead on every seek.
  - Select a zoom: full frame + box with scrim and `2.0× · SIGUE`; drag the box → the chip
    reads `FIJO`, the inspector shows "Fijar aquí" active; ⌘Z restores it in one step.
  - Press "Fijar aquí" in the inspector **without** dragging: the picture must not move.
    (This is the H1 regression: a mode-only commit would recentre the camera.)
  - Click inside the camera box on an annotation under it: the annotation is selected —
    the box's interior does not eat the click; only its frame drags.
  - Abort a box drag (switch app mid-drag): the drag ends and undo/redo still work.
  - Draw an annotation while zoomed (deselect the zoom first): it lands under the pointer
    and moves with the content.
  - Hold the button: raw frame + chip, **no annotations and no privacy regions**;
    release: everything back.
  - **Shrink the window until the video is height-capped** (or open a 4:3 recording):
    the camera box must still frame the picture exactly — its border on the picture's
    edges, the scrim only outside them. This is the case a shrink-wrapped `.content`
    got wrong.
  - A slide: never zoomed. Fullscreen: zoom still clipped to the video.
  - **Performance, on the longest recording available (≥ 30 min):** drag Level end to end
    and drag the camera box across the frame. The preview must stay smooth and the drag
    must not lag behind the pointer.

## Acceptance criteria

- Preview camera and export camera come from the same `CameraPath` (no second
  implementation).
- No React state update per video frame (check with the React profiler: playback does
  not re-render `VideoEditor` at frame rate).
- **Camera path rebuild budget: at most one `buildCameraPath` call per animation frame**
  during any live gesture, however many pointermove events arrive. The call costs 26 ms
  and allocates 2.6 MB per hour of recording ([05](/plans/video-editor-v2/05-camera-path-model/)),
  so one per pointermove would freeze the preview on a long recording. Pinned by
  `use-camera-path.test.ts` ("coalesces a burst of live updates into one rebuild").
- The rVFC subscription is **not** re-established by a live update: a new camera path
  re-applies the callback, it does not cancel and re-request the frame callback. Pinned
  by `use-video-frame-clock.test.ts`.
- Every pointer gesture in the preview chrome ends exactly once, including when the
  capture is lost (`preview-chrome.test.tsx`). A stranded `interacting` flag silently
  disables every commit, undo and redo in the editor.

## Non-goals

A canvas-based preview, motion blur, previewing the drawn cursor (doc 12), zoom
transitions across a cut (the camera follows source time; a cut is a cut), resizing the
camera box (Level is the only way to change the window size), and un-clipping the
annotation handles/text input at the frame edge (see the `overflow: hidden` decision).

## Reopen if

- `backdrop-filter` blur regions (PR 8) do not render under the transformed layer on a
  supported platform — then switch the preview to a single canvas compositor that reuses
  the export's per-frame code
  ([10 § PR 8 Task 3](/plans/video-editor-v2/10-redactions-rendering-and-leaks/#task-3--preview-layer-underlay)).
- One rebuild per frame is still too slow on very long recordings — then make
  `buildCameraPath` incremental (re-simulate only from the edited segment's start) rather
  than throttling harder; the current design keeps the whole path correct at every frame.
- Users report losing the end of a text label typed at the right edge of the frame — then
  move the clip off `.stage` onto a dedicated inner element with a small transparent
  inset.
