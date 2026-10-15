---
title: "27 · Video editor re-render"
description: "Closes VID-A4 and VID-A8: the whole 1,545-line editor re-renders on every playhead update because usePreviewPlayback returns a new object each render and keeps the time in React state; the loader runs its two IPCs and the asset restores serially."
---

# Video editor re-render — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playback and scrubbing re-render only the components that show the time; the editor opens one IPC round trip and (N−1) image decodes sooner.

**Architecture:** In `usePreviewPlayback` the playhead time lives in a ref and is pushed through `emitTime` to subscribers; `timelineTime` state and the 250 ms slide `setInterval` disappear (the rAF tick already emits the slide time every frame); the hook returns a `useMemo`'d object (every callback is already stable) and a new `getTime()`. A new `useTimeSelector(playback, select)` (`useSyncExternalStore`) lets the page's render-time consumers (`visibleIds`, `splitDisabled`, `drawWindow`, a small `TimeDisplay`) re-render only when a derived **primitive** changes; handlers call `getTime()`; `VideoAnnotationLayer` takes `getPlayheadTime`. `TimelineStrip` keeps writing the playhead via `subscribeTime`. The loader starts the cursor-track and session IPCs together and restores assets with `Promise.allSettled`. `useCameraPath` gets real deps (a tidy-up, not a win: it already coalesces). Corrections to the finding: `detectZoomSegments` runs in the loader's `open()`, not on first render, and stays there (opening is not an edit); `PreviewStage` memo gains nothing (its props are inline JSX).

**Tech Stack:** React 18 `useSyncExternalStore`, vitest `renderHook` with the hook's fake-timer harness, React DevTools Profiler for the before/after.

**Spec:** [Audit report](/audits/2026-10-15/report/) → VID-A4, VID-A8 in [video lens A](/audits/2026-10-15/findings/video-a/). Closes: **VID-A4, VID-A8**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- `timelineTime` is **removed** from `PreviewPlayback`, so any leftover render-time read fails the type check by design; fix each site, never re-add the field. Nine consumers are listed in Task 2.
- `useSyncExternalStore` snapshots must be primitives (string/number/boolean/null); an object snapshot loops.
- Every former `setTimelineTime` site must `emitTime` (paused UI depends on it now). The `internalSeekRef` early return in `onVideoTimeUpdate` correctly skips the emit because `seek()` already emitted.
- Behaviour change (an improvement): `visibleIds` and `splitDisabled` flip exactly at boundaries instead of at the next ~250 ms tick.
- Parallel `restoreAsset` makes `entries()` completion-ordered; the only consumer keys by `assetId`.
- Plan 03 edits the same loader block (per-asset try/catch, `persist` flag); plan 09 edits the export `onSaved` saves. Rebase: keep plan 03's per-asset `captureException` inside the `allSettled` mapper.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Playing a clip for 1 s re-renders the hook's host ≤ 3 times (play flips `playing`; nothing per frame) — Task 1 test (the VID-A4 regression guard).
2. The hook returns the same object across a `rerender()` and a new one after `play()` — Task 1 test.
3. The slide clock reaches subscribers without the interval — Task 1 test.
4. `useTimeSelector` with `Math.floor` re-renders on 2.0 but not on 1.1 → 1.9 — Task 2 test.
5. The loader requests the cursor track and the session in the same tick — Task 3 test.

---

### Task 1: `usePreviewPlayback` — time in a ref, stable return, `useTimeSelector`

**Files:**

- Modify: `features/video-editor/use-preview-playback.ts:17`, `:85`, `:99-104`, every `setTimelineTime` site (`:153-154`, `:165`, `:210`, `:252-253`, `:341`, `:344`, `:354`, `:360`), `:200-213` (delete), `:385-402`
- Create: `features/video-editor/use-time-selector.ts`
- Test: `features/video-editor/use-preview-playback.test.ts`, create `features/video-editor/use-time-selector.test.tsx`

**Interfaces:**

- Produces: `PreviewPlayback.getTime(): number` (replaces `timelineTime`); `useTimeSelector<T extends string | number | boolean | null>(playback: Pick<PreviewPlayback, "subscribeTime" | "getTime">, select: (t: number) => T): T`.

- [ ] **Step 1: Write the failing tests** (the suite has `makeVideo()`, `advance(ms)`, a `layout` with a 3 s slide at 5–8; change its three `result.current.timelineTime` reads to `result.current.getTime()`)

```ts
it("getTime follows seek without a re-render", () => {
  let renders = 0;
  const { result } = renderHook(() => { renders += 1; return usePreviewPlayback(layout); });
  result.current.videoRef.current = makeVideo();
  const before = renders;
  act(() => result.current.seek(2));
  expect(result.current.getTime()).toBe(2);
  expect(renders).toBe(before);
});

it("playing a clip does not re-render the host per frame", () => {
  let renders = 0;
  const { result } = renderHook(() => { renders += 1; return usePreviewPlayback(layout); });
  const video = makeVideo();
  result.current.videoRef.current = video;
  act(() => result.current.play());
  const after = renders;
  for (let i = 0; i < 30; i++) { video.currentTime += 1 / 30; advance(1000 / 30); }
  expect(renders - after).toBeLessThanOrEqual(2);
});

it("returns a stable object until something it exposes changes", () => {
  const { result, rerender } = renderHook(() => usePreviewPlayback(layout));
  const a = result.current;
  rerender();
  expect(result.current).toBe(a);
  result.current.videoRef.current = makeVideo();
  act(() => result.current.play());
  expect(result.current).not.toBe(a);
});

it("the slide clock reaches subscribers without the interval", () => {
  const { result } = renderHook(() => usePreviewPlayback(layout));
  result.current.videoRef.current = makeVideo();
  act(() => result.current.seek(6));
  const spy = vi.fn();
  result.current.subscribeTime(spy);
  act(() => result.current.play());
  advance(500);
  expect(spy.mock.calls.at(-1)![0]).toBeCloseTo(6.5, 1);
  expect(result.current.getTime()).toBeCloseTo(6.5, 1);
});
```

`use-time-selector.test.tsx`:

```tsx
it("re-renders only when the selected primitive changes", () => {
  const listeners = new Set<(t: number) => void>();
  let time = 1.1;
  const playback = { subscribeTime: (l: (t: number) => void) => { listeners.add(l); return () => listeners.delete(l); }, getTime: () => time };
  let renders = 0;
  const { result } = renderHook(() => { renders += 1; return useTimeSelector(playback, (t) => Math.floor(t)); });
  expect(result.current).toBe(1);
  for (const t of [1.5, 1.9]) act(() => { time = t; listeners.forEach((l) => l(t)); });
  expect(renders).toBe(1);
  act(() => { time = 2; listeners.forEach((l) => l(2)); });
  expect(result.current).toBe(2);
  expect(renders).toBe(2);
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/features/video-editor/use-preview-playback.test.ts src/renderer/src/features/video-editor/use-time-selector.test.tsx` → FAIL (`getTime` missing; ≥30 renders while playing).

- [ ] **Step 3: Implement**

Replace the state + ref block:

```ts
  // Playhead time lives in a ref and is pushed to subscribers. As React state it re-rendered
  // the whole editor on every update (VID-A4). Read it on demand with getTime().
  const timelineTimeRef = useRef(0);
  const emitTime = useCallback((t: number) => {
    timelineTimeRef.current = t;
    for (const listener of listenersRef.current) listener(t);
  }, []);
  const getTime = useCallback(() => timelineTimeRef.current, []);
```

Replace every `setTimelineTime(x)` with `emitTime(x)` (where the old code did `setTimelineTime(end); emitTime(end);` keep one call). In the `advanceFrom` next-entry path and the three `onVideoTimeUpdate` paths also set `lastValidTimeRef.current = <that time>`. Delete the slide `setInterval` effect. Interface: remove `timelineTime: number;`, add

```ts
  /** Current playhead (timeline seconds), read on demand. Never causes a re-render;
   *  render-time consumers use subscribeTime or useTimeSelector. */
  getTime(): number;
```

Stable return:

```ts
  return useMemo(
    () => ({
      videoRef, playing, muted, duration, activeSlideId, getTime,
      play, pause, toggle, toggleMute, seek,
      onVideoTimeUpdate, onVideoEnded, onVideoPlay, onVideoPause, subscribeTime,
    }),
    [playing, muted, duration, activeSlideId, getTime, play, pause, toggle, toggleMute, seek,
      onVideoTimeUpdate, onVideoEnded, onVideoPlay, onVideoPause, subscribeTime],
  );
```

New file:

```ts
// features/video-editor/use-time-selector.ts
import { useSyncExternalStore } from "react";
import type { PreviewPlayback } from "./use-preview-playback";

/**
 * Re-renders only when `select(t)` returns a different primitive. `select` must be pure and
 * cheap: it runs on every emitted time (60 Hz while playing).
 */
export function useTimeSelector<T extends string | number | boolean | null>(
  playback: Pick<PreviewPlayback, "subscribeTime" | "getTime">,
  select: (t: number) => T,
): T {
  const { subscribeTime, getTime } = playback;
  return useSyncExternalStore(
    (onChange) => subscribeTime(() => onChange()),
    () => select(getTime()),
  );
}
```

Reword the test harness comment that mentions the slide `setInterval`.

- [ ] **Step 4: Run and commit** — both files → PASS. (The page and strip will fail the type check until Task 2; commit the hook first anyway, the suite for this file is green.)

```bash
git add src/renderer/src/features/video-editor/use-preview-playback.ts src/renderer/src/features/video-editor/use-preview-playback.test.ts src/renderer/src/features/video-editor/use-time-selector.ts src/renderer/src/features/video-editor/use-time-selector.test.tsx
git commit -m "perf(desktop): playhead time leaves React state; usePreviewPlayback returns a stable object"
```

### Task 2: Consumers read time on demand or through a selector

**Files:**

- Modify: `pages/video-editor/video-editor-page.tsx` (`visibleIds` `:515-519`, `splitDisabled` `:531`, handlers at `:540`, `:556`, `:587-590`, `:911`, `:922-933`, `:936-940`, `:994-1003`, `drawWindow` `:979`, `playheadTime` `:1253`, time display `:1300-1302`, ZoomInspector `:1360`)
- Modify: `features/video-editor/annotations/video-annotation-layer.tsx:86-87`, `:268`, `:379`
- Modify: `features/video-editor/components/timeline-strip.tsx:78-91`
- Modify: test stubs `components/timeline-strip.test.tsx:13` and `components/preview-stage.test.tsx` (`timelineTime: 0` → `getTime: vi.fn(() => 0)`)
- Test: `components/timeline-strip.test.tsx`

- [ ] **Step 1: Write the failing strip test**

```tsx
it("positions the playhead from getTime on mount and from subscribeTime afterwards", () => {
  let listener: ((t: number) => void) | null = null;
  const playback = makePlayback({ duration: 10, getTime: vi.fn(() => 5), subscribeTime: vi.fn((l) => { listener = l; return () => {}; }) });
  const { container } = render(<TimelineStrip {...props(twoClipLayout, vi.fn(), { playback })} />);
  const playhead = container.querySelector("[data-playhead]") as HTMLElement; // use the selector the suite already uses
  expect(playhead.style.left).toBe("50%");
  act(() => listener!(2.5));
  expect(playhead.style.left).toBe("25%");
});
```

- [ ] **Step 2: Run the type check** — `bun run check-types` lists every `playback.timelineTime` read; fix each as below.

- [ ] **Step 3: Implement**

Page (import `useTimeSelector`):

```ts
  const visibleKey = useTimeSelector(playback, (t) =>
    scene.overlays.filter((o) => t >= o.start && t <= o.end).map((o) => o.id).join("|"),
  );
  const visibleIds = useMemo(() => new Set(visibleKey === "" ? [] : visibleKey.split("|")), [visibleKey]);
  const splitDisabled = useTimeSelector(playback, (t) => entryAt(layout, t)?.kind !== "clip");
  const drawStart = useTimeSelector(playback, (t) => (privacyTool ? (redactionEdits.windowAt(t)?.start ?? null) : null));
  const drawWindow = privacyTool && drawStart !== null ? redactionEdits.windowAt(playback.getTime()) : null;
```

(Overlay ids come from `newId()`; assert in a test that they never contain `|`.) Handlers (`handleSplit`, `handleDeleteSelected`, add-image, `handleSelectZoom`, `handleAddZoom`, `handleAddMute`, `handleCreateRegion`, ZoomInspector `anchorNow`): use `playback.getTime()` and replace `playback.timelineTime` in deps with `playback`. Annotation layer: prop `playheadTime: number` → `getPlayheadTime: () => number`; both uses `overlayWindow(getPlayheadTime(), timelineDuration)`; page passes `getPlayheadTime={playback.getTime}`. Time display:

```tsx
function TimeDisplay({ playback }: { playback: PreviewPlayback }): React.JSX.Element {
  const label = useTimeSelector(playback, (t) => formatTime(t));
  return (
    <span className={styles.timeDisplay}>
      {label} / {formatTime(playback.duration)}
    </span>
  );
}
```

Strip — replace both playhead effects with one:

```tsx
  useEffect(() => {
    const place = (t: number): void => {
      const el = playheadRef.current;
      if (el) el.style.left = `${timeToFraction(t, duration) * 100}%`;
    };
    place(playback.getTime());
    return playback.subscribeTime(place);
  }, [playback, duration]);
```

- [ ] **Step 4: Run and commit**

Run: `bun run check-types && node_modules/.bin/vitest run src/renderer/src/features/video-editor src/renderer/src/pages/video-editor` → PASS.

```bash
git add src/renderer/src/pages/video-editor/video-editor-page.tsx src/renderer/src/features/video-editor/annotations/video-annotation-layer.tsx src/renderer/src/features/video-editor/components
git commit -m "perf(desktop): editor consumers read the playhead on demand or through useTimeSelector"
```

### Task 3: Loader parallelism and `useCameraPath` deps (VID-A8)

**Files:**

- Modify: `pages/video-editor/video-editor-page.tsx:279-312` (loader)
- Modify: `features/video-editor/zoom/use-camera-path.ts:36-55`
- Test: `pages/video-editor/video-editor-page.test.tsx`, `features/video-editor/zoom/use-camera-path.test.ts`

- [ ] **Step 1: Write the failing tests**

Page:

```tsx
it("requests the cursor track and the session in the same tick", async () => {
  const track = vi.spyOn(window.electronAPI, "loadCursorTrack").mockImplementation(() => new Promise(() => {}));
  const session = vi.spyOn(window.electronAPI, "loadVideoEditSession").mockImplementation(() => new Promise(() => {}));
  await renderEditor();
  await Promise.resolve();
  expect(track).toHaveBeenCalledTimes(1);
  expect(session).toHaveBeenCalledTimes(1);
});
```

Camera path (the suite's `manualFrames()` stubs rAF):

```ts
it("does not schedule a frame when re-rendered with identical inputs", () => {
  const frames = manualFrames();
  const segments: ZoomSegment[] = [];
  const { rerender } = renderHook(({ s }) => useCameraPath(s, null, 10), { initialProps: { s: segments } });
  frames.flush();
  rerender({ s: segments });
  expect(frames.pending()).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail** — today the session IPC fires only after the track resolves.

- [ ] **Step 3: Implement**

Loader:

```ts
      const trackPromise = window.electronAPI
        .loadCursorTrack(source.id)
        .then((json) => (json ? parseCursorTrack(json) : null))
        .catch(() => null);
      const sessionPromise = window.electronAPI.loadVideoEditSession(source.id);
      sessionPromise.catch(() => {}); // avoid an unhandled rejection while trackPromise is awaited
      const cursorTrack = await trackPromise;
      if (cancelled) return;
      // ...inside the existing try/catch:
      const saved = await sessionPromise;
```

Assets:

```ts
            const results = await Promise.allSettled(
              saved.assets.map(async ({ assetId, bytes }) => {
                if (cancelled) return;
                await assetStoreRef.current.restoreAsset(assetId, bytes, "image/png");
                loadedIds.add(assetId);
              }),
            );
            if (cancelled) return;
            if (results.some((r) => r.status === "rejected")) throw new Error("restore-failed");
```

(With plan 03: catch per asset inside the mapper with `captureException` instead of throwing.) `use-camera-path.ts`: close the effect with `}, [segments, track, sourceDurationSeconds]);` and reword the "No dependency array" comment: the ref comparison stays the coalescing guard; the deps only skip renders where the inputs are unchanged.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/pages/video-editor src/renderer/src/features/video-editor/zoom && bun run check-types` → PASS.

```bash
git add src/renderer/src/pages/video-editor/video-editor-page.tsx src/renderer/src/pages/video-editor/video-editor-page.test.tsx src/renderer/src/features/video-editor/zoom
git commit -m "perf(desktop): the editor loader fetches the track and the session together and restores assets in parallel"
```

### Task 4: Measure, optional `TimelineStrip` memo, ship

- [ ] **Measure** (React DevTools Profiler, dev build): open a ~10 min recording with ≥5 zooms, 2 redactions, 1 mute, 1 slide. Record while pressing Play for 10 s; note `VideoEditor` commit count and total render ms. Repeat with the playhead crossing the slide, and while dragging the ruler for 3 s. Expectation: playback from ~40+ `VideoEditor` commits in 10 s to ≤ 3 (plus `TimeDisplay`-only commits at 1 Hz); ruler scrub ≈ 0 `VideoEditor` commits. For A8, temporary `performance.mark` at route entry and in a `VideoEditor` mount effect, on a recording with a large cursor track and 3 slides.
- [ ] If the profile still shows lane cost: `React.memo(TimelineStrip)` with `slideUrlFor` as a `useCallback` and `extraLanes` as a `useMemo` over the lane inputs — **only** after verifying each input member is already memoized (`grep -n useCallback` in `zoom/use-zoom-editing.ts`, `use-mute-editing.ts`, the privacy hook); if one is unstable, stop and report instead of forcing it. Skip `PreviewStage` and the inspector.
- [ ] Open a PR titled `perf(desktop): the video editor no longer re-renders per frame (audit VID-A4, VID-A8)` linking this plan and both findings with the before/after table. End with **How to test it yourself**:
  1. Open a long recording; press Play; with React DevTools Profiler running, `VideoEditor` commits stay in single digits over 10 s.
  2. Scrub the ruler → the playhead and preview follow smoothly; the clock text updates once per second.
  3. Seek into a slide and play → the playhead advances through the slide; split is disabled on the slide and enabled on clips.
  4. Open a recording with 3 slides → the editor appears sooner than before (compare the marks).
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
