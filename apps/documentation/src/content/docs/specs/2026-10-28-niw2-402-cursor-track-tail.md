---
title: "NIW2-402: 26 Cursor track tail — approved spec"
description: "The cursor follows the pointer to the last frame of every recording: the tail cut is computed in video time."
---

# NIW2-402: 26 Cursor track tail

> Approved spec, committed **before** implementation (ADR-0010). Source: audit plan `apps/documentation/src/content/docs/plans/audit-2026-10-15/26-cursor-track-tail.md` on `main` @ `f10e39a4`, copied below unchanged except the heading level. Linear: https://linear.app/niway/issue/NIW2-402. Where they disagree, **this file wins**.
> Path: `apps/documentation/src/content/docs/specs/2026-10-28-niw2-402-cursor-track-tail.md` · Approved: 2026-10-28 (Cristian, all proposed defaults) · Batch 5 — recording failure paths (parent NIW2-385) · Closes: REC-B8

## Cursor track tail — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cursor follows the pointer to the last frame of every recording: the tail cut is computed in video time.

**Architecture:** Diagnosis: `maxMs = meta.durationMs + 250` in `recording-hub.ts`, but `durationMs` is `elapsedMs(clock, Date.now())` from a wall clock started **after** `startEngine` resolved — i.e. after `captureThumbnail` (150 ms sleep + play + JPEG) — while samples are in video time from `t0` (mediabunny's first media sample). The two bases differ by Δ ≥ 150 ms (typically 200–350), which eats the +250 margin. Fix: the store keeps a second clock, `videoClock`, started at `firstMediaTimestamp.rendererMs` (the same `t0` the cursor track is anchored to) on `performance.now()`, fed the same pause/resume instants as the cursor track, and read at Stop for `durationMs`; falls back to the wall clock when `t0` never resolved. The wall `clock` stays for the bar timer and `durationSeconds`. No IPC, main or builder change — only comments. Rejected: enlarging the margin (hides an unbounded Δ) and "no cut" (leaves 0.6–2 s of "Saving…" samples; the editor does not clamp them).

**Tech Stack:** The existing `elapsed.ts` `ElapsedState` helpers, vitest (store harness with fake timers; fixture test in `main/recording`).

**Spec:** [Audit report](/audits/2026-10-15/report/) → REC-B8 in [record lens B](/audits/2026-10-15/findings/record-b/). Closes: **REC-B8**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- The existing "finalizes with the unfloored elapsed time in durationMs" test uses `rendererMs: 0` with fake `performance.now()` ≈ 3000 at recording start; after this change it must use `rendererMs: 3000` (t0 = the moment recording starts) or it would report 5400. Confirm the fake clock's start value on the first run.
- Known gap (state in the PR): a pause issued before `firstMediaTimestamp` resolves (< one frame; the UI cannot hit it) is not applied to `videoClock`; the cursor tracker has the same limitation.
- `durationSeconds` (library metadata, "Saved" card) stays the wall-clock floor, so it can be up to ~Δ shorter than the file. Out of scope; mention in the PR.
- Plan 24 removes the thumbnail await from the start path, which shrinks Δ but does not remove it (the cursor handshake and `output.start()` still sit before the wall clock). This plan is still needed.
- Commit messages in English, conventional-commit style.

## Review Focus

1. `t0` 350 ms before the bar clock → `durationMs` = elapsed + 350 — Task 1 test.
2. A 1 s pause inside the take is excluded from `durationMs` — Task 1 test.
3. `t0` never resolves → `durationMs` falls back to the wall clock (no worse than today) — Task 1 test.
4. A late `firstMediaTimestamp` from a previous take cannot leak into the next (`engine === handle` guard) — Task 1 code; reviewer confirms the variable name in scope.
5. Builder contract: samples in the last 150 ms survive when `maxMs` is video duration + margin — Task 2 fixture test.

---

### Task 1: `videoClock` in the store

**Files:**

- Modify: `renderer/src/features/recording/recorder-store.ts:64-66`, `:216-221`, `:305-320`, `:326-333`, `:372-378`, `:245-247`
- Modify (comments only): `main/recording/recording-hub.ts:205-218`, `shared/types/ipc.ts:467-473`
- Test: `renderer/src/features/recording/recorder-store.test.ts`

- [ ] **Step 1: Update the existing test and write the failing ones**

Change the existing durationMs test to `fakeEngine({ firstMediaTimestamp: Promise.resolve({ rendererMs: 3000, quality: "exact" as const }) })`. Add:

```ts
it("reports durationMs in video time: measured from the first media sample, not from when the bar started", async () => {
  // t0 (first frame) is 350 ms BEFORE the bar's clock starts (thumbnail capture ran in between).
  const engine = fakeEngine({ firstMediaTimestamp: Promise.resolve({ rendererMs: 3000 - 350, quality: "exact" as const }) });
  startEngineMock.mockResolvedValue(engine);
  store.requestStartRecording(() => input);
  await vi.advanceTimersByTimeAsync(3000); // countdown → recording starts (performance.now() = 3000)
  await vi.advanceTimersByTimeAsync(2400);
  await stopAndSettle();
  expect(window.electronAPI.recordingFinalize).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ durationSeconds: 2, durationMs: 2400 + 350 }),
  );
});

it("excludes a pause from the video-time duration", async () => {
  const engine = fakeEngine({ firstMediaTimestamp: Promise.resolve({ rendererMs: 3000, quality: "exact" as const }) });
  startEngineMock.mockResolvedValue(engine);
  store.requestStartRecording(() => input);
  await vi.advanceTimersByTimeAsync(3000);
  await vi.advanceTimersByTimeAsync(1000);
  store.pauseRecording();
  await vi.advanceTimersByTimeAsync(1000);
  store.resumeRecording();
  await vi.advanceTimersByTimeAsync(1400);
  await stopAndSettle();
  expect(window.electronAPI.recordingFinalize).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ durationMs: 2400 }));
});

it("falls back to the wall clock when the first media timestamp never resolves", async () => {
  const engine = fakeEngine({ firstMediaTimestamp: new Promise(() => {}) });
  startEngineMock.mockResolvedValue(engine);
  store.requestStartRecording(() => input);
  await vi.advanceTimersByTimeAsync(3000);
  await vi.advanceTimersByTimeAsync(2400);
  await stopAndSettle();
  expect(window.electronAPI.recordingFinalize).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ durationMs: 2400 }));
});
```

- [ ] **Step 2: Run to verify** — `node_modules/.bin/vitest run src/renderer/src/features/recording/recorder-store.test.ts` → the "video time" test FAILS (reports 2400).

- [ ] **Step 3: Implement**

After `let clock: ElapsedState | null = null;`:

```ts
/** Video-time clock: zero = the MP4's first media sample, renderer `performance.now()`, pauses removed. */
let videoClock: ElapsedState | null = null;
```

In `beginEngine`, replace the `firstMediaTimestamp` hookup:

```ts
    const activeTrack = cursorTrack;
    void handle.firstMediaTimestamp.then(({ rendererMs, quality }) => {
      activeTrack?.anchor(rendererMs, quality);
      // Same t0 the cursor track is anchored to. Skip if the take already ended.
      if (engine === handle) videoClock = startElapsed(rendererMs);
    });
    clock = startElapsed(Date.now());
```

`pauseRecording` / `resumeRecording` (reuse the `performance.now()` values already taken):

```ts
  cursorTrack?.pause(pausedAt);
  if (videoClock) videoClock = pauseElapsed(videoClock, pausedAt);
  clock = pauseElapsed(clock, Date.now());
```

```ts
  cursorTrack?.resume(resumedAt);
  if (videoClock) videoClock = resumeElapsed(videoClock, resumedAt);
  clock = resumeElapsed(clock, Date.now());
```

`stopRecording`:

```ts
  const wallMs = clock ? elapsedMs(clock, Date.now()) : 0;
  const durationSeconds = Math.floor(wallMs / 1000);
  // Video length at the stop request, measured from the MP4's first media sample (t0), not
  // from when the bar started: the thumbnail capture delays the bar's clock by >= 150 ms,
  // which the cursor tracker's tail cut cannot absorb. Falls back to the wall clock when
  // t0 never resolved (cursor track off, or the first-media wait timed out).
  const durationMs = videoClock ? elapsedMs(videoClock, performance.now()) : wallMs;
```

Reset `videoClock = null;` next to `clock = null;` in the teardown and in the start-failure path. Comments: in `recording-hub.ts` say the cut uses "the recording's VIDEO duration at the stop request (measured from the first media sample, see recorder-store `videoClock`)" and that `+ 250` covers the frames flushed by `output.finalize()` after the request plus jitter; in `ipc.ts` document `durationMs` as "video time (ms since the MP4's first media sample, pauses removed) when Stop was requested — not the bar's wall-clock timer."

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/recording/recorder-store.test.ts && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/recording/recorder-store.ts src/renderer/src/features/recording/recorder-store.test.ts src/main/recording/recording-hub.ts src/shared/types/ipc.ts
git commit -m "fix(desktop): the cursor track's tail cut uses video time, so the last samples survive"
```

### Task 2: Fixture test pinning the builder contract

**Files:**

- Create: `main/recording/cursor-track-tail.fixture.test.ts`

- [ ] **Step 1: Write the test** (real fixture + 19 synthetic tail samples at the 8 ms poll interval; the fixture has 1226 samples, true media ≈ 25 900 ms)

```ts
/**
 * REC-B8: the tail cut must be computed in VIDEO time. Uses the real 25 s fixture's samples and appends
 * the final 150 ms of synthetic samples at the 8 ms poll interval.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCursorTrack } from "@shared/cursor-track";
import { buildCursorTrack } from "./build-cursor-track";

const FIXTURES_DIR = join(__dirname, "..", "..", "shared", "__fixtures__");
const fixture = parseCursorTrack(readFileSync(join(FIXTURES_DIR, "real-screen-2026-09-22.cursor.json"), "utf8"));

const T0 = 10_000; // main-clock ms of video time 0 (arbitrary)
const MEDIA_MS = 25_900; // true media length of the fixture (1245 frames at 48 fps)
const TAIL = Array.from({ length: 19 }, (_, i) => 25_752 + i * 8); // 25 752 … 25 896

function build(maxMs: number) {
  if (!fixture) throw new Error("fixture did not parse");
  return buildCursorTrack({
    raw: {
      t: [...fixture.t, ...TAIL].map((v) => v + T0),
      x: [...fixture.x, ...TAIL.map(() => 0.9)],
      y: [...fixture.y, ...TAIL.map(() => 0.9)],
      clicks: [],
    },
    anchor: { t0: T0, pauses: [] },
    anchorQuality: "exact",
    clicksAvailable: false,
    display: fixture.display,
    maxMs,
  });
}

describe("cursor track tail (REC-B8)", () => {
  it("keeps every sample in the last 150 ms when maxMs is the video duration + margin", () => {
    const track = build(MEDIA_MS + 250);
    expect(track.t).toHaveLength(1226 + TAIL.length);
    expect(track.t.at(-1)).toBe(25_896);
  });

  it("drops the final ~100 ms when maxMs comes from a clock that started 350 ms late (the old bug)", () => {
    const track = build(MEDIA_MS - 350 + 250);
    expect(track.t.at(-1)).toBe(25_800);
    expect(track.t).toHaveLength(1226 + 7);
  });
});
```

(The builder cannot know which clock produced `maxMs`; this file guards the builder contract, Task 1 is the real regression guard. The second case documents the bug and may be dropped once closed.)

- [ ] **Step 2: Run and commit**

Run: `node_modules/.bin/vitest run src/main/recording/cursor-track-tail.fixture.test.ts src/main/recording/build-cursor-track.test.ts src/shared/cursor-track.fixture.test.ts` → PASS.

```bash
git add src/main/recording/cursor-track-tail.fixture.test.ts
git commit -m "test(desktop): pin the cursor-track tail cut against the real fixture"
```

### Task 3: Ship

- [ ] Open a PR titled `fix(desktop): cursor track keeps its last samples (audit REC-B8)` linking this plan and the finding; state the known gap and the `durationSeconds` note. End with **How to test it yourself** (dev build):
  1. Record ~5 s; right before pressing Stop move the pointer to a screen corner. Open the recording in the editor → the cursor follows to the last frame instead of freezing 0.1–0.3 s early.
  2. Compare the last `t` in `<vault>/.kaipu/<id>.cursor.json` with the video duration → within ~50 ms (before: 100–350 ms short).
  3. Record with a pause in the middle → the cursor track still lines up after the pause.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.

## Dependencies

- No open `blocked by` relation. Independent of the other audit plans.
- Plan 24 (NIW2-421) later shrinks the wall-clock/video-time gap but does not remove it; this plan is still needed.
- Linear lists this ticket as blocking NIW2-387 (plan 01).

## Approved decisions

1. **Approval.** Cristian approved this ticket on 2026-10-28 with every proposed default; this file is the contract. Where the Linear description disagrees, this file wins.
2. **Failing test first.** Each task starts with a failing test, run before the fix. Selector names, helper names and line numbers were written by reading the code, not by running it: adapt them to today's code.
3. **Stop, don't improvise.** If a Review Focus line or a flagged assumption does not hold on today's `main`, stop and report it in a comment on the Linear ticket instead of improvising.
4. **One PR.** One PR for this ticket. It links NIW2-402, ends with a "How to test it yourself" section, and deletes the plan file `apps/documentation/src/content/docs/plans/audit-2026-10-15/26-cursor-track-tail.md` plus its row in `00-index.md`.
5. **Tooling.** Never run the Playwright desktop E2E suite locally (CI runs it). Use the pinned tools (`apps/kaipu-record/node_modules/.bin/vitest`, `bun run check-types`), never `bunx`.
6. **Human merge.** The ticket carries `needs-human-merge`: the PR is not auto-landed; Cristian reviews and merges it.
7. **Repo rule: no remote side effects.** No remote `db:push`/migrations against any real or dev database, no deploys, no releases or tags, no changes to remote storage or secrets. Local tests and fixtures only.
8. **Suggested model:** Sonnet.
9. **Approach (plan default):** a second `videoClock` anchored at `firstMediaTimestamp.rendererMs`, read at Stop for `durationMs`, falling back to the wall clock when `t0` never resolved. Enlarging the margin and "no cut" stay rejected.
10. **Out of scope (plan default):** `durationSeconds` stays the wall-clock floor; state the known pre-`t0` pause gap in the PR.

## Change log

- 2026-10-28: Spec approved by Cristian with all proposed defaults; committed as the first commit of `feature/niw2-402-…` from audit plan `26-cursor-track-tail` (`main` @ `f10e39a4`).
