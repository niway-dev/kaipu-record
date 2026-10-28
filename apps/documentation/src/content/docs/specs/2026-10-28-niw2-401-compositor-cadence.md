---
title: "NIW2-401: 25 Compositor cadence — approved spec"
description: "The compositor draws at most once per source frame, never faster than the capture frame rate, and not at all while the take is paused."
---

# NIW2-401: 25 Compositor cadence

> Approved spec, committed **before** implementation (ADR-0010). Source: audit plan `apps/documentation/src/content/docs/plans/audit-2026-10-15/25-compositor-cadence.md` on `main` @ `f10e39a4`, copied below unchanged except the heading level. Linear: https://linear.app/niway/issue/NIW2-401. Where they disagree, **this file wins**.
> Path: `apps/documentation/src/content/docs/specs/2026-10-28-niw2-401-compositor-cadence.md` · Approved: 2026-10-28 (Cristian, all proposed defaults) · Batch 5 — recording failure paths (parent NIW2-385) · Closes: REC-A7

## Compositor cadence — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The compositor draws at most once per source frame, never faster than the capture frame rate, and not at all while the take is paused.

**Architecture:** `draw()`'s body is unchanged. A frame source — `video.requestVideoFrameCallback` when present (the `use-video-frame-clock.ts` precedent), else `requestAnimationFrame` — calls `onFrame(now)`, which draws only if at least `1000 / frameRate − 2` ms passed since the last draw. A 1 s heartbeat redraws a static screen so `captureStream` keeps emitting (it only emits on repaint). `RecordingCompositor` gains `pause()`/`resume()`; the engine's `pause`/`resume` call them. The measurement is part of the plan: the finding is "plausible", the real rAF rate was never measured.

**Tech Stack:** `requestVideoFrameCallback`, `canvas.captureStream`, vitest with manual fakes (the compositor has no test today; jsdom lacks `getContext`, `captureStream`, `MediaStream`, `play`).

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-A7 in [record lens A](/audits/2026-10-15/findings/record-a/). Also read [recording compositor performance](/backlog/recording-compositor-perf/). Closes: **REC-A7**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/features/recording/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- **R1 (output behaviour):** `captureStream` emits only on repaint. Source-driven draws on a static screen could leave MP4 timestamp gaps (VFR). The heartbeat bounds them to about 1.25 s (1 s threshold, checked every 250 ms); if the manual `ffprobe` check shows gaps that hurt scrubbing or export, set the heartbeat to `minIntervalMs` (constant-rate output; keeps only the pause and over-refresh savings).
- **R2:** not confirmed that rVFC fires on a detached `<video>` fed by a `MediaStream` in the hidden window with background throttling off. Include the 500 ms switch to rAF if no rVFC callback has fired after start, and keep the optional draws/s counter during measurement.
- Measure **before** merging: if draws/s is already ≈30 on the current code, the change only buys the pause saving — say so in the PR.
- Add one paragraph to `backlog/recording-compositor-perf.md`: "Cadence: draws follow source frames, capped at frameRate, none while paused."
- Commit messages in English, conventional-commit style.

## Review Focus

1. One draw up front, then one per source frame; never more than `frameRate` per second even when frames arrive at 60 Hz — Task 1 tests (a), (b).
2. No draw while paused; one draw on resume; pause/resume idempotent and inert after stop — Task 1 tests (c), (d).
3. Without rVFC the rAF fallback keeps the same throttle — Task 1 test (f).
4. The heartbeat redraws a static screen once per second — Task 1 test (g).
5. Engine pause/resume reach the compositor, and do not throw when there is no compositor — Task 2 tests.

---

### Task 1: Source-driven, throttled, pausable draw loop

**Files:**

- Modify: `recording-compositor.ts:18-22`, `:75-116`
- Create: `recording-compositor.test.ts`

**Interfaces:**

- Produces: `RecordingCompositor.pause(): void`, `RecordingCompositor.resume(): void`.

- [ ] **Step 1: Write the failing tests** (harness: `ctx` fake via `vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx)`; `HTMLCanvasElement.prototype.captureStream = vi.fn(() => ({ getVideoTracks: () => [{ stop: vi.fn() }] }))`; `play`/`pause` spies on `HTMLMediaElement.prototype`; `globalThis.MediaStream = class { constructor(public tracks) {} getVideoTracks() { return this.tracks; } }`; rVFC fake on `HTMLVideoElement.prototype` storing `pending` with a `fireFrame(t)` helper; `performance.now` spied with a controllable clock; restore in `afterEach`)

```ts
it("draws once up front, then once per source frame", async () => {
  await start({ frameRate: 30 });
  expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  clock = 40; fireFrame(40);
  expect(ctx.drawImage).toHaveBeenCalledTimes(2);
});
it("never draws faster than the capture frame rate", async () => {
  await start({ frameRate: 30 });
  for (let t = 16.7; t <= 100; t += 16.7) { clock = t; fireFrame(t); }
  expect(ctx.drawImage.mock.calls.length).toBeLessThanOrEqual(1 + 4);
});
it("does not draw while paused and redraws once on resume", async () => {
  const c = await start({ frameRate: 30 });
  c.pause();
  expect(HTMLVideoElement.prototype.cancelVideoFrameCallback).toHaveBeenCalled();
  expect(pending).toBeNull();
  const before = ctx.drawImage.mock.calls.length;
  c.resume();
  expect(ctx.drawImage).toHaveBeenCalledTimes(before + 1);
  expect(pending).not.toBeNull();
});
it("pause/resume are idempotent and inert after stop", async () => {
  const c = await start({ frameRate: 30 });
  c.pause(); c.pause(); c.resume(); c.resume();
  const n = ctx.drawImage.mock.calls.length;
  c.stop(); c.resume();
  expect(ctx.drawImage).toHaveBeenCalledTimes(n);
});
it("stop cancels the pending callback and stops the track", async () => {
  const c = await start({ frameRate: 30 });
  c.stop();
  expect(pending).toBeNull();
  expect(c.track.stop).toHaveBeenCalled();
});
it("falls back to requestAnimationFrame without requestVideoFrameCallback", async () => {
  delete (HTMLVideoElement.prototype as never)["requestVideoFrameCallback"];
  const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => { rafPending = cb; return 1; });
  await start({ frameRate: 30 });
  for (let t = 8; t <= 100; t += 8) { clock = t; rafPending?.(t); }
  expect(ctx.drawImage.mock.calls.length).toBeLessThanOrEqual(1 + 4);
  raf.mockRestore();
});
it("heartbeat redraws a static screen", async () => {
  vi.useFakeTimers();
  await start({ frameRate: 30 });
  clock = 1000;
  vi.advanceTimersByTime(1000);
  expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
```

(`start(opts)` builds `startRecordingCompositor(new MediaStream([{}]), { width: 100, height: 100 }, null, opts.frameRate)`. Follow `use-video-frame-clock.test.ts`'s style: plain `it`, no Testing Library.)

- [ ] **Step 2: Run to verify they fail** — no `pause`/`resume`; draws on every frame.

- [ ] **Step 3: Implement**

Interface:

```ts
export interface RecordingCompositor {
  /** The composited video track to encode instead of the raw screen track. */
  track: MediaStreamVideoTrack;
  /** Stop redrawing (the take is paused). Idempotent. */
  pause(): void;
  /** Redraw once and follow the source again. No-op after `stop()`. */
  resume(): void;
  stop(): void;
}
```

Replace the draw loop / `captureStream` / return block:

```ts
  // Cadence: one draw per NEW source frame, never faster than the capture rate.
  // `requestVideoFrameCallback` fires only when the <video> presents a new frame;
  // without it fall back to rAF, throttled by the same interval. The 2 ms slack
  // keeps a 30 fps source on a 60 Hz clock from skipping every other frame.
  const minIntervalMs = 1000 / Math.max(1, frameRate) - 2;
  // A static screen produces no source frames, and captureStream only emits when
  // the canvas changes, so redraw at least this often to keep the encoder fed.
  const HEARTBEAT_MS = 1000;
  // Tick faster than the bound: a 1 s tick that skips because a frame drew 500 ms earlier
  // would leave a ~2 s gap. A 250 ms tick keeps every gap under HEARTBEAT_MS + 250 ms.
  const HEARTBEAT_TICK_MS = 250;
  let hasVideoFrameCallback = typeof video.requestVideoFrameCallback === "function";
  let handle = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let paused = false;
  let stopped = false;
  let lastDrawAt = Number.NEGATIVE_INFINITY;
  let sourceFrames = 0;

  const draw = (): void => {
    // ...existing body: fit + drawImage + watermark stamp (no requestAnimationFrame line)...
    lastDrawAt = performance.now();
  };
  const onFrame = (now: number): void => {
    sourceFrames += 1;
    if (stopped || paused) return;
    if (now - lastDrawAt >= minIntervalMs) draw();
    schedule();
  };
  const schedule = (): void => {
    handle = hasVideoFrameCallback ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame);
  };
  const halt = (): void => {
    if (hasVideoFrameCallback) video.cancelVideoFrameCallback(handle);
    else cancelAnimationFrame(handle);
    clearInterval(heartbeat);
  };
  const start = (): void => {
    schedule();
    heartbeat = setInterval(() => {
      if (performance.now() - lastDrawAt >= HEARTBEAT_MS) draw();
    }, HEARTBEAT_TICK_MS);
  };

  draw(); // the first frame must exist before captureStream is created
  start();
  // R2 guard: if rVFC never fires on this detached <video>, fall back to rAF.
  if (hasVideoFrameCallback) {
    setTimeout(() => {
      if (!stopped && !paused && sourceFrames === 0) {
        video.cancelVideoFrameCallback(handle);
        hasVideoFrameCallback = false;
        schedule();
      }
    }, 500);
  }

  const stream = canvas.captureStream(frameRate);
  const track = stream.getVideoTracks()[0];

  return {
    track,
    pause: () => {
      if (paused || stopped) return;
      paused = true;
      halt();
    },
    resume: () => {
      if (!paused || stopped) return;
      paused = false;
      draw();
      start();
    },
    stop: () => {
      stopped = true;
      halt();
      track.stop();
      video.pause();
      video.srcObject = null;
    },
  };
```

(Optional during measurement: count draws in `draw()` and `console.debug` draws/s in `stop()`; remove afterwards.)

- [ ] **Step 4: Run and commit** — `node_modules/.bin/vitest run src/renderer/src/features/recording/recording-compositor.test.ts && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/recording/recording-compositor.ts src/renderer/src/features/recording/recording-compositor.test.ts
git commit -m "perf(desktop): the recording compositor draws per source frame, capped at the capture rate, and pauses"
```

### Task 2: Engine pause/resume reach the compositor

**Files:**

- Modify: `recorder-engine.ts:310-318`
- Test: `recorder-engine.test.tsx` (the compositor mock gains `pause: vi.fn(), resume: vi.fn()`)

- [ ] **Step 1: Write the failing tests**

```tsx
it("pauses and resumes the compositor with the take", async () => {
  screenVideoTrack.getSettings = vi.fn(() => ({ width: 3024, height: 1964 }));
  const handle = await startEngine(baseOptions());
  const c = await vi.mocked(startRecordingCompositor).mock.results.at(-1)!.value;
  handle.pause();
  expect(c.pause).toHaveBeenCalled();
  handle.resume();
  expect(c.resume).toHaveBeenCalled();
});
it("pause/resume do not throw without a compositor", async () => {
  const handle = await startEngine(baseOptions());
  expect(() => { handle.pause(); handle.resume(); }).not.toThrow();
});
```

- [ ] **Step 2: Run to verify the first fails.**

- [ ] **Step 3: Implement**

```ts
    pause: () => {
      videoSource.pause();
      audioSource?.pause();
      compositor?.pause();
    },
    resume: () => {
      compositor?.resume(); // a fresh frame is on the canvas before the source resumes sampling
      videoSource.resume();
      audioSource?.resume();
    },
```

- [ ] **Step 4: Run and commit** — PASS.

```bash
git add src/renderer/src/features/recording/recorder-engine.ts src/renderer/src/features/recording/recorder-engine.test.tsx
git commit -m "perf(desktop): pausing a take pauses the compositor"
```

### Task 3: Measure, document, ship

- [ ] **Measure** on a ProMotion MacBook (120 Hz), non-16:9 screen (compositor active), 30 fps balanced, once without and once with a watermark; two builds (before/after, two worktrees — never a bare `git stash`):
  1. Record 60 s of a looping video and 60 s of a static desktop; in one take pause 10 s mid-way.
  2. Renderer CPU %: `top -pid <renderer pid> -l 12 -s 5` averaged, before vs after; note the GPU process too. Expect lower, near zero during the pause.
  3. Draws/s from the counter: before ≈ refresh rate (if the finding is right), after ≤ 30.
  4. `ffprobe -v error -select_streams v -count_frames -show_entries stream=nb_read_frames,avg_frame_rate,duration file.mp4` before vs after, especially on the static take (R1); scrub the file in the editor and export it.
- [ ] Add the cadence paragraph to `apps/documentation/src/content/docs/backlog/recording-compositor-perf.md` with the measured numbers.
- [ ] Open a PR titled `perf(desktop): compositor draws at the capture rate and pauses (audit REC-A7)` linking this plan, the finding and the backlog note; include the measurements and the R1/R2 outcome. End with **How to test it yourself** = the measurement steps 1–4 in short form.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.

## Dependencies

- No open `blocked by` relation. Independent of the other audit plans.
- Linear lists this ticket as blocking NIW2-387 (plan 01). Plan 01's telemetry helps measure the draw rate but is not required first.

## Approved decisions

1. **Approval.** Cristian approved this ticket on 2026-10-28 with every proposed default; this file is the contract. Where the Linear description disagrees, this file wins.
2. **Failing test first.** Each task starts with a failing test, run before the fix. Selector names, helper names and line numbers were written by reading the code, not by running it: adapt them to today's code.
3. **Stop, don't improvise.** If a Review Focus line or a flagged assumption does not hold on today's `main`, stop and report it in a comment on the Linear ticket instead of improvising.
4. **One PR.** One PR for this ticket. It links NIW2-401, ends with a "How to test it yourself" section, and deletes the plan file `apps/documentation/src/content/docs/plans/audit-2026-10-15/25-compositor-cadence.md` plus its row in `00-index.md`.
5. **Tooling.** Never run the Playwright desktop E2E suite locally (CI runs it). Use the pinned tools (`apps/kaipu-record/node_modules/.bin/vitest`, `bun run check-types`), never `bunx`.
6. **Human merge.** The ticket carries `needs-human-merge`: the PR is not auto-landed; Cristian reviews and merges it.
7. **Repo rule: no remote side effects.** No remote `db:push`/migrations against any real or dev database, no deploys, no releases or tags, no changes to remote storage or secrets. Local tests and fixtures only.
8. **Suggested model:** Sonnet.
9. **Verify in the app before changing the cadence:** measure the current draw rate vs the capture rate first. The plan assumes `requestVideoFrameCallback` keeps firing on a hidden/offscreen `<video>` in the recorder window; if rVFC stalls when hidden, stop and report on the ticket before changing the cadence.
10. **Re-check the finding against mediabunny 1.61.4** (the auditor used a stale 1.49.0 install). If the finding no longer applies, report instead of changing code.

## Change log

- 2026-10-28: Spec approved by Cristian with all proposed defaults; committed as the first commit of `feature/niw2-401-…` from audit plan `25-compositor-cadence` (`main` @ `f10e39a4`).
