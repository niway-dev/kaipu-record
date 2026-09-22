---
title: "Video editor v2 — 01 clock and pause mapping"
description: "How cursor samples taken in the main process are mapped onto the MP4's video time: mediabunny's synced-zero base, a renderer→main clock handshake, the private first-media timestamp, and pause removal. Fixes audit W1–W3."
sidebar:
  order: 1
---

# 01 — Clock and pause mapping

> **Status: 🔵 Proposed** (2026-09-21). Part of PR 2 ("Cursor position track") in the
> [audit](/plans/video-editor-v2/00-audit/). Fixes W1, W2, W3. Implement together with
> [02](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/).

## Problem

A cursor sample is useful only if we know which video frame it belongs to. Three facts
of the current code make the overview's `sample.t = now − t0` wrong:

1. **The file's time base belongs to the renderer.** `recorder-engine.ts` encodes with
   `MediaStreamVideoTrackSource` / `MediaStreamAudioTrackSource` using mediabunny's default
   `timestampBase: "synced-zero"`. In mediabunny 1.49 (`dist/modules/src/media-source.js`,
   `addVideoFrame`), the first sample either track accepts sets
   `output._firstMediaStreamTimestamp = performance.now() / 1000` **of the renderer**, and
   every later sample is stamped relative to it. Video time 0 = that instant.
2. **Pause removes time from the file.** `pauseRecording()` → `engine.pause()` →
   `videoSource.pause()`. While paused, mediabunny drops frames and subtracts each
   dropped frame's delta from `timestampOffset`, so the paused stretch collapses to about
   one frame in the MP4. A main-clock sample taken after the first pause is late by the
   whole paused duration unless we subtract it too.
3. **The poller is in another process.** `screen.getCursorScreenPoint()` exists only in
   main. `performance.timeOrigin + performance.now()` is not a safe shared clock: each
   process fixes `timeOrigin` at launch and the monotonic clock stops during sleep, so a
   renderer created after a sleep (window re-created, renderer crash + reload) disagrees
   with main by the sleep length.

The overview also proposed stamping t0 with `requestVideoFrameCallback` on the element
used by `captureThumbnail`. That element is created **after** `await output.start()` and
then waits 150 ms (`recorder-engine.ts:232`, `:248`), so it is not the first encoded frame.

## Decision

- **Main's `performance.now()` is the only clock samples are stored in** while recording.
- The **renderer measures its offset to main once** per recording with an NTP-style
  handshake (`measureClockOffset`, smallest-RTT of 7 pings; error ≤ RTT/2, typically
  < 1 ms over local IPC). Every time the renderer reports (t0, pause, resume) is converted
  to main clock **in the renderer** before it is sent. Main never learns the renderer clock.
- **t0 = mediabunny's `_firstMediaStreamTimestamp`** (renderer ms), read defensively
  with a fallback to "renderer clock right after `output.start()`" (error ≤ one frame).
  The quality is persisted (`anchor: "exact" | "estimated"`). A unit test guards the
  private field against mediabunny upgrades.
- **Pauses are intervals in main clock**; `toVideoTimeMs` subtracts every pause that
  ended before a sample and drops samples inside a pause. An open pause at stop is
  closed at finalize.
- **Conversion happens once, in main, at finalize** (`buildCursorTrack`). The persisted
  file is already in video time; the editor never sees clocks or pauses.
- **The handshake is time-boxed and runs beside the engine.** `beginCursorTrackSession`
  is started **in parallel** with `startEngine` (main's `cursorTrackStart` handler awaits
  `desktopCapturer.getSources()`, 100–500 ms) and the whole body is raced against a
  500 ms timer. A stalled main — `getSources()` behind a permission dialog, a busy
  encoder — yields a no-op session instead of leaving the recorder store in `starting`
  forever. Starting the tracker a few hundred ms early is free: samples before t0 are
  dropped at finalize.

Residual error, accepted and documented: mediabunny quantizes pause removal to frame
deltas, so each pause can shift later samples by at most one frame (33 ms at 30 fps).
The camera path smooths over it; nothing in v2 draws on the cursor at frame precision
(see [12](/plans/video-editor-v2/12-capture-resolution-and-cursor-sprite/)).

## Rejected alternatives

| Alternative                                        | Why not                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `timeOrigin + now()` in both processes             | Not comparable across processes after sleep / window re-creation (above).                     |
| Stamp events on arrival in main (no offset)        | IPC latency is unbounded when main is busy writing chunks; t0 is still unknown to main.       |
| `timestampBase: "zero"` / `"unix"` on the sources  | `zero` makes each track start at 0 independently (A/V desync); `unix` writes epoch-sized PTS. |
| Sample the cursor in the renderer                  | No `screen` module in the renderer; forwarding each point from main costs an IPC per sample.  |
| `requestVideoFrameCallback` on the thumbnail video | Different element, created after start, 150 ms late.                                          |

## Files

| Action | Path (under `apps/kaipu-record/`)                                           |
| ------ | --------------------------------------------------------------------------- |
| Create | `src/main/recording/cursor-clock.ts` + `.test.ts`                           |
| Create | `src/renderer/src/features/recording/clock-sync.ts` + `.test.ts`            |
| Create | `src/renderer/src/features/recording/first-media-timestamp.ts` + `.test.ts` |
| Create | `src/renderer/src/features/recording/cursor-track-session.ts` + `.test.ts`  |
| Modify | `src/renderer/src/features/recording/recorder-engine.ts`                    |
| Modify | `src/renderer/src/features/recording/recorder-store.ts` + `.test.ts`        |

The IPC methods these call (`cursorTrackStart`, `cursorClockNow`, `cursorTrackAnchor`,
`cursorTrackPause`, `cursorTrackResume`) are defined in
[02 § IPC](/plans/video-editor-v2/02-cursor-track-capture-and-persistence/#ipc).

## Tasks

### Task 1 — `cursor-clock.ts` (main, pure)

- [ ] Create the file with exactly this content:

**`apps/kaipu-record/src/main/recording/cursor-clock.ts`**

```ts
/**
 * Maps MAIN-process clock readings (`performance.now()` in main, ms) onto the
 * recording's VIDEO time (ms since the MP4's first media sample, pauses removed).
 *
 * Why this exists: the cursor poller runs in main, the encoder runs in the recorder
 * renderer. mediabunny stamps the file with `performance.now()` of the RENDERER and
 * drops paused time (MediaStreamVideoTrackSource subtracts every frame it discards
 * while paused). So a main-clock sample maps to video time as
 *
 *     video = main − t0 − (sum of pause intervals that ended before `main`)
 *
 * where `t0` and every pause edge have already been converted into the main clock by
 * the renderer (it measured the renderer→main offset with `measureClockOffset`).
 * Samples inside a pause (or before t0) have no video frame and map to null.
 */

export interface PauseInterval {
  /** Main-clock ms when `engine.pause()` ran. */
  start: number;
  /** Main-clock ms when `engine.resume()` ran; null while still paused. */
  end: number | null;
}

export interface ClockAnchor {
  /** Main-clock ms of the MP4's first media sample (video time 0). */
  t0: number;
  /** Chronological, non-overlapping. */
  pauses: PauseInterval[];
}

export function toVideoTimeMs(mainMs: number, anchor: ClockAnchor): number | null {
  if (mainMs < anchor.t0) return null;
  let paused = 0;
  for (const p of anchor.pauses) {
    if (mainMs < p.start) break;
    if (p.end === null || mainMs < p.end) return null; // inside a pause: not in the file
    paused += p.end - p.start;
  }
  return mainMs - anchor.t0 - paused;
}

/** Close a still-open pause (the user stopped while paused). Returns a new anchor. */
export function closeOpenPause(anchor: ClockAnchor, atMainMs: number): ClockAnchor {
  return {
    t0: anchor.t0,
    pauses: anchor.pauses.map((p) => (p.end === null ? { start: p.start, end: atMainMs } : p)),
  };
}
```

- [ ] Create the test:

**`apps/kaipu-record/src/main/recording/cursor-clock.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { closeOpenPause, toVideoTimeMs } from "./cursor-clock";

describe("toVideoTimeMs", () => {
  const anchor = { t0: 1000, pauses: [{ start: 3000, end: 5000 }] };

  it("is null before t0", () => {
    expect(toVideoTimeMs(999, anchor)).toBeNull();
  });
  it("is main − t0 before any pause", () => {
    expect(toVideoTimeMs(1000, anchor)).toBe(0);
    expect(toVideoTimeMs(2500, anchor)).toBe(1500);
  });
  it("is null inside a pause (start inclusive, end exclusive)", () => {
    expect(toVideoTimeMs(3000, anchor)).toBeNull();
    expect(toVideoTimeMs(4999, anchor)).toBeNull();
  });
  it("removes the paused duration after a pause", () => {
    expect(toVideoTimeMs(5000, anchor)).toBe(2000);
    expect(toVideoTimeMs(6000, anchor)).toBe(3000);
  });
  it("treats an open pause as extending forever, until closed", () => {
    const open = { t0: 0, pauses: [{ start: 100, end: null }] };
    expect(toVideoTimeMs(10_000, open)).toBeNull();
    const closed = closeOpenPause(open, 400);
    expect(closed.pauses[0].end).toBe(400);
    expect(toVideoTimeMs(500, closed)).toBe(200);
  });
  it("sums several pauses", () => {
    const a = {
      t0: 0,
      pauses: [
        { start: 100, end: 200 },
        { start: 300, end: 600 },
      ],
    };
    expect(toVideoTimeMs(700, a)).toBe(300);
  });
});
```

- [ ] `cd apps/kaipu-record && bunx vitest run src/main/recording/cursor-clock.test.ts` → 6 passing.

### Task 2 — `clock-sync.ts` (renderer, pure)

- [ ] Create:

**`apps/kaipu-record/src/renderer/src/features/recording/clock-sync.ts`**

```ts
/**
 * Renderer → main clock offset, NTP style: ask main for its `performance.now()` a
 * few times, keep the round trip with the smallest RTT, and assume main read its
 * clock halfway through it. `mainMs ≈ rendererMs + offset`.
 *
 * Why not compare `performance.timeOrigin + performance.now()` across processes:
 * each process fixes `timeOrigin` from the wall clock when it starts, and the
 * monotonic clock does not advance during system sleep. A renderer created after a
 * sleep (window re-created, renderer crash) then disagrees with main by the whole
 * sleep duration. A handshake measured at record time has no such failure mode.
 */

export interface ClockOffset {
  /** Add to a renderer `performance.now()` reading to get the main-clock reading. */
  offset: number;
  /** Round trip of the winning ping, ms — the offset's error is at most rtt / 2. */
  rtt: number;
}

export async function measureClockOffset(
  pingMain: () => Promise<number>,
  now: () => number = () => performance.now(),
  rounds = 7,
): Promise<ClockOffset> {
  let best: ClockOffset = { offset: 0, rtt: Number.POSITIVE_INFINITY };
  for (let i = 0; i < rounds; i++) {
    const sentAt = now();
    const mainNow = await pingMain();
    const receivedAt = now();
    const rtt = receivedAt - sentAt;
    if (rtt < best.rtt) best = { offset: mainNow - (sentAt + receivedAt) / 2, rtt };
  }
  return best;
}
```

- [ ] Test:

**`apps/kaipu-record/src/renderer/src/features/recording/clock-sync.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { measureClockOffset } from "./clock-sync";

describe("measureClockOffset", () => {
  it("keeps the ping with the smallest round trip", async () => {
    // Renderer clock = main clock − 250. Round trips: 10, 2 (best), 6.
    let rendererNow = 0;
    const script = [10, 2, 6];
    let call = 0;
    const now = (): number => rendererNow;
    const ping = async (): Promise<number> => {
      const rtt = script[call++];
      rendererNow += rtt / 2;
      const main = rendererNow + 250;
      rendererNow += rtt / 2;
      return main;
    };
    const result = await measureClockOffset(ping, now, 3);
    expect(result.rtt).toBe(2);
    expect(result.offset).toBe(250);
  });
});
```

### Task 3 — `first-media-timestamp.ts` (renderer)

- [ ] Create:

**`apps/kaipu-record/src/renderer/src/features/recording/first-media-timestamp.ts`**

```ts
/**
 * Reads the renderer-clock time of the MP4's first media sample (video time 0).
 *
 * mediabunny's default `timestampBase: "synced-zero"` stores
 * `performance.now() / 1000` of the first video/audio sample it accepts in the
 * PRIVATE field `Output._firstMediaStreamTimestamp` and stamps every later sample
 * relative to it. That field is the exact t0 the cursor track needs. It is private,
 * so: (1) read it defensively, (2) fall back to an estimate, (3) a unit test
 * (first-media-timestamp.test.ts) fails loudly if a mediabunny upgrade removes it.
 */

export interface FirstMediaTimestamp {
  /** Renderer `performance.now()` ms of video time 0. */
  rendererMs: number;
  quality: "exact" | "estimated";
}

interface OutputProbe {
  _firstMediaStreamTimestamp?: number | null;
}

export async function waitForFirstMediaTimestamp(
  output: object,
  /** Renderer ms captured right after `await output.start()` — used if the field never fills. */
  fallbackMs: number,
  options: {
    timeoutMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<FirstMediaTimestamp> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const probe = output as OutputProbe;
  if (!("_firstMediaStreamTimestamp" in probe))
    return { rendererMs: fallbackMs, quality: "estimated" };
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const seconds = probe._firstMediaStreamTimestamp;
    if (typeof seconds === "number") return { rendererMs: seconds * 1000, quality: "exact" };
    await sleep(16);
  }
  return { rendererMs: fallbackMs, quality: "estimated" };
}
```

- [ ] Test. The first case constructs a real mediabunny `Output` (works in jsdom — no
      WebCodecs is touched before `start()`); it is the upgrade guard:

**`apps/kaipu-record/src/renderer/src/features/recording/first-media-timestamp.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { BufferTarget, Mp4OutputFormat, Output } from "mediabunny";
import { waitForFirstMediaTimestamp } from "./first-media-timestamp";

describe("waitForFirstMediaTimestamp", () => {
  it("mediabunny still exposes the private field (upgrade guard)", () => {
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    // If this fails after a mediabunny upgrade, the cursor track silently degrades to
    // "estimated" anchors — find the new field in media-source.js before upgrading.
    expect("_firstMediaStreamTimestamp" in output).toBe(true);
  });

  it("returns the field in ms once mediabunny fills it", async () => {
    const output: { _firstMediaStreamTimestamp: number | null } = {
      _firstMediaStreamTimestamp: null,
    };
    let clock = 0;
    const result = await waitForFirstMediaTimestamp(output, 999, {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        if (clock >= 48) output._firstMediaStreamTimestamp = 12.5;
      },
    });
    expect(result).toEqual({ rendererMs: 12_500, quality: "exact" });
  });

  it("falls back to the estimate when the field never fills", async () => {
    let clock = 0;
    const result = await waitForFirstMediaTimestamp({ _firstMediaStreamTimestamp: null }, 777, {
      timeoutMs: 100,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(result).toEqual({ rendererMs: 777, quality: "estimated" });
  });

  it("falls back immediately when the field does not exist", async () => {
    expect(await waitForFirstMediaTimestamp({}, 5)).toEqual({
      rendererMs: 5,
      quality: "estimated",
    });
  });
});
```

### Task 4 — `cursor-track-session.ts` (renderer)

- [ ] Create:

**`apps/kaipu-record/src/renderer/src/features/recording/cursor-track-session.ts`**

```ts
/**
 * Renderer half of the cursor track: tells main to start sampling for a writer
 * session, measures the renderer→main clock offset once, and forwards the clock
 * anchor and every pause/resume edge ALREADY CONVERTED to main-clock ms.
 * Main never needs to know anything about the renderer's clock.
 *
 * Every call is best-effort: a failure here must never break a recording, so all
 * IPC errors are swallowed and the session degrades to "no cursor track". The whole
 * opening handshake is also raced against a timeout: main's `cursorTrackStart` handler
 * resolves the captured display through `desktopCapturer.getSources()`, and main can be
 * blocked for an unbounded time (a permission dialog, a busy encoder). Without the race
 * a stalled IPC would leave the recorder store in "starting" forever.
 */
import { measureClockOffset } from "./clock-sync";

export interface CursorTrackApi {
  cursorTrackStart(sessionId: string, sourceId: string): Promise<{ enabled: boolean }>;
  cursorClockNow(): Promise<number>;
  cursorTrackAnchor(sessionId: string, t0MainMs: number, quality: "exact" | "estimated"): void;
  cursorTrackPause(sessionId: string, atMainMs: number): void;
  cursorTrackResume(sessionId: string, atMainMs: number): void;
}

export interface CursorTrackSession {
  anchor(t0RendererMs: number, quality: "exact" | "estimated"): void;
  pause(atRendererMs: number): void;
  resume(atRendererMs: number): void;
}

export interface CursorTrackSessionOptions {
  /** Renderer clock; injected by the tests. */
  now?: () => number;
  /** Budget for `cursorTrackStart` + the ping handshake together. */
  timeoutMs?: number;
}

/**
 * Generous for `desktopCapturer.getSources()` on a healthy machine, short enough that a
 * blocked main process costs the cursor track and not the take.
 */
export const CURSOR_TRACK_START_TIMEOUT_MS = 500;

const NOOP_SESSION: CursorTrackSession = {
  anchor: () => {},
  pause: () => {},
  resume: () => {},
};

export async function beginCursorTrackSession(
  api: CursorTrackApi,
  sessionId: string,
  sourceId: string,
  options: CursorTrackSessionOptions = {},
): Promise<CursorTrackSession> {
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? CURSOR_TRACK_START_TIMEOUT_MS;
  const open = async (): Promise<CursorTrackSession> => {
    try {
      const { enabled } = await api.cursorTrackStart(sessionId, sourceId);
      if (!enabled) return NOOP_SESSION;
      const { offset } = await measureClockOffset(() => api.cursorClockNow(), now);
      return {
        anchor: (t0, quality) => api.cursorTrackAnchor(sessionId, t0 + offset, quality),
        pause: (at) => api.cursorTrackPause(sessionId, at + offset),
        resume: (at) => api.cursorTrackResume(sessionId, at + offset),
      };
    } catch (error) {
      console.warn("cursor track unavailable for this recording", error);
      return NOOP_SESSION;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<CursorTrackSession>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`cursor track start timed out after ${timeoutMs} ms`);
      resolve(NOOP_SESSION);
    }, timeoutMs);
  });
  try {
    return await Promise.race([open(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] Test:

**`apps/kaipu-record/src/renderer/src/features/recording/cursor-track-session.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { beginCursorTrackSession, type CursorTrackApi } from "./cursor-track-session";

/**
 * Fully deterministic: the renderer clock only moves when the fake IPC moves it, and
 * every `cursorClockNow` round trip costs exactly 2 ms (1 ms each way), so the measured
 * offset is exactly `mainMinusRenderer`. No `performance.now()`, no tolerances.
 */
function fakeApi(enabled: boolean, mainMinusRenderer: number) {
  const calls: unknown[][] = [];
  let clock = 0;
  const now = (): number => clock;
  const api: CursorTrackApi = {
    cursorTrackStart: async () => ({ enabled }),
    cursorClockNow: async () => {
      clock += 1; // request in flight
      const mainNow = clock + mainMinusRenderer;
      clock += 1; // reply in flight
      return mainNow;
    },
    cursorTrackAnchor: (...args) => void calls.push(["anchor", ...args]),
    cursorTrackPause: (...args) => void calls.push(["pause", ...args]),
    cursorTrackResume: (...args) => void calls.push(["resume", ...args]),
  };
  return { api, calls, now };
}

describe("beginCursorTrackSession", () => {
  it("converts renderer times to main clock", async () => {
    const { api, calls, now } = fakeApi(true, 10_000);
    const session = await beginCursorTrackSession(api, "session-1", "screen:1:0", { now });
    session.anchor(100, "exact");
    session.pause(200);
    session.resume(300);
    expect(calls).toEqual([
      ["anchor", "session-1", 10_100, "exact"],
      ["pause", "session-1", 10_200],
      ["resume", "session-1", 10_300],
    ]);
  });

  it("is a no-op when main declines (window source, unknown display)", async () => {
    const { api, calls, now } = fakeApi(false, 0);
    const session = await beginCursorTrackSession(api, "s", "window:42:0", { now });
    session.anchor(1, "exact");
    session.pause(2);
    expect(calls).toEqual([]);
  });

  it("never throws when IPC fails", async () => {
    const { api, now } = fakeApi(true, 0);
    api.cursorTrackStart = async () => {
      throw new Error("no handler");
    };
    const session = await beginCursorTrackSession(api, "s", "screen:1:0", { now });
    expect(() => session.pause(1)).not.toThrow();
  });

  it("gives up when main never answers, instead of hanging the store", async () => {
    const { api, calls, now } = fakeApi(true, 0);
    // A handler blocked behind a permission dialog: the invoke never settles.
    api.cursorTrackStart = () => new Promise<{ enabled: boolean }>(() => {});
    const session = await beginCursorTrackSession(api, "s", "screen:1:0", {
      now,
      timeoutMs: 10,
    });
    session.anchor(1, "exact");
    session.pause(2);
    expect(calls).toEqual([]);
  });
});
```

### Task 5 — expose t0 from the engine

In `src/renderer/src/features/recording/recorder-engine.ts`:

- [ ] Import: `import { waitForFirstMediaTimestamp, type FirstMediaTimestamp } from "./first-media-timestamp";`
- [ ] Add to `EngineHandle`:

  ```ts
  /**
   * Renderer-clock time of video time 0 (the MP4's first media sample). Resolves
   * within ~1 frame of start; "estimated" if mediabunny's private field is missing.
   */
  firstMediaTimestamp: Promise<FirstMediaTimestamp>;
  ```

- [ ] Replace the line `await output.start();` with:

  ```ts
  await output.start();
  // Fallback anchor if mediabunny's private first-media timestamp is unavailable:
  // the first frame is accepted within one frame period of start() resolving.
  const startedAt = performance.now();
  const firstMediaTimestamp = waitForFirstMediaTimestamp(output, startedAt);
  ```

- [ ] Add `firstMediaTimestamp,` to the returned handle object (next to `thumbnail,`).
- [ ] Do **not** change `pause()` / `resume()`; the store stamps them (Task 6).

### Task 6 — wire the store

In `src/renderer/src/features/recording/recorder-store.ts`:

- [ ] Import `beginCursorTrackSession, type CursorTrackSession` from
      `@renderer/features/recording/cursor-track-session`. This file reaches its own
      siblings through the `@renderer` alias (`@renderer/features/recording/elapsed`,
      `…/recorder-engine`), not `./` — match it. At 100 columns the import wraps over
      four lines; see the diff.
- [ ] Module state next to `let engine`: `let cursorTrack: CursorTrackSession | null = null;`
- [ ] In `beginEngine`, start the session **concurrently with the engine**, never before
      it. Main's `cursorTrackStart` handler awaits `displayIdForSource` →
      `desktopCapturer.getSources()`, which costs 100–500 ms; today's code deliberately
      fires that same call as `void` so it cannot delay the start
      (`recording-hub.ts:155`). Replace `const handle = await startEngine({ … });` with:

  ```ts
  // Best-effort, and started CONCURRENTLY with the engine: main resolves the
  // captured display through desktopCapturer.getSources(), which costs
  // 100–500 ms, and the recording must never wait for it. The call never
  // throws — it resolves to a no-op session when main declines (window source,
  // unknown display), when IPC fails, or after its own 500 ms timeout.
  const [track, handle] = await Promise.all([
    beginCursorTrackSession(window.electronAPI, id, input.sourceId),
    startEngine({
      /* …every existing option, re-indented by two spaces… */
    }),
  ]);
  cursorTrack = track;
  ```

  The diff below is authoritative for the re-indentation. Sampling therefore starts a
  little **before** video time 0; those samples have no frame and `toVideoTimeMs` drops
  them at finalize, so nothing has to be trimmed by hand.

- [ ] Right after `engine = handle;` add:

  ```ts
  const activeTrack = cursorTrack;
  void handle.firstMediaTimestamp.then(({ rendererMs, quality }) =>
    activeTrack?.anchor(rendererMs, quality),
  );
  ```

- [ ] In `pauseRecording()`, **before** `engine.pause();`:
      `const pausedAt = performance.now();` and **after** it: `cursorTrack?.pause(pausedAt);`
- [ ] In `resumeRecording()`, same pattern with `resumedAt` / `cursorTrack?.resume(resumedAt);`
- [ ] Set `cursorTrack = null;` on **every** path that ends a session — there are three,
      not two: the start-failure `catch`, the end of `stopRecording` (both right after
      `engine = null;`), and the **cancel branch** inside `beginEngine`
      (`recorder-store.ts:188-196`), which returns before `engine` is ever assigned. On
      that cancel path nothing subscribes to `handle.firstMediaTimestamp`, so no anchor
      is ever sent; its polling loop is left unobserved and stops by itself at the 3 s
      timeout in `waitForFirstMediaTimestamp`. Main discards the tracker when the same
      branch calls `recordingAbort(id)`.
- [ ] In `recorder-store.test.ts`, the `fakeEngine()` factory must satisfy the new
      `EngineHandle` field, or four tests fail at runtime (`undefined.then`):
      add `firstMediaTimestamp: Promise.resolve({ rendererMs: 0, quality: "estimated" as const }),`
      after `thumbnail: null,`.

### Tasks 5 + 6 as diffs (authoritative)

Generated against `main` at `d18dbbd`, so the hunk offsets are exact. The engine diff is
the one that was verified end-to-end; the store diff was regenerated after this plan was
reviewed (concurrent start, timeout, cancel-branch reset), so after applying it re-run
`bun run check-types && bun run test` — the recording suite (101 tests) must stay green.

**Diff — `apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts
+++ b/apps/kaipu-record/src/renderer/src/features/recording/recorder-engine.ts
@@ -15,6 +15,7 @@
 import type { WatermarkConfig } from "@renderer/features/watermark/watermark";
 import { startRecordingCompositor, type RecordingCompositor } from "./recording-compositor";
 import { levelsFromTimeDomain } from "./audio-levels";
+import { waitForFirstMediaTimestamp, type FirstMediaTimestamp } from "./first-media-timestamp";

 export interface EngineHandle {
   pause(): void;
@@ -25,6 +26,11 @@
   readLevels(): number[];
   /** A still JPEG frame of the screen captured at start. */
   thumbnail: ArrayBuffer | null;
+  /**
+   * Renderer-clock time of video time 0 (the MP4's first media sample). Resolves
+   * within ~1 frame of start; "estimated" if mediabunny's private field is missing.
+   */
+  firstMediaTimestamp: Promise<FirstMediaTimestamp>;
 }

 export interface EngineOptions {
@@ -230,6 +236,10 @@
     output.addAudioTrack(audioSource);
   }
   await output.start();
+  // Fallback anchor if mediabunny's private first-media timestamp is unavailable:
+  // the first frame is accepted within one frame period of start() resolving.
+  const startedAt = performance.now();
+  const firstMediaTimestamp = waitForFirstMediaTimestamp(output, startedAt);

   // Surface mid-recording failures so the caller tears down cleanly (otherwise the
   // app gets stuck: window hidden, bar showing, no real recording). Fires at most
@@ -261,6 +271,7 @@
       return levelsFromTimeDomain(levelBuffer, 5);
     },
     thumbnail,
+    firstMediaTimestamp,
     async stop() {
       teardownStarted = true; // stopping the tracks below would otherwise fire onError
       await output.finalize();
```

**Diff — `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts
+++ b/apps/kaipu-record/src/renderer/src/features/recording/recorder-store.ts
@@ -1,4 +1,8 @@
 import type { LocalRecording } from "@shared/types";
+import {
+  beginCursorTrackSession,
+  type CursorTrackSession,
+} from "@renderer/features/recording/cursor-track-session";
 import {
   elapsedMs,
   pauseElapsed,
@@ -57,6 +61,7 @@

 let snapshot: RecorderSnapshot = { status: "idle", countdown: null };
 let engine: EngineHandle | null = null;
+let cursorTrack: CursorTrackSession | null = null;
 let sessionId: string | null = null;
 let clock: ElapsedState | null = null;
 let tickTimer: ReturnType<typeof setInterval> | null = null;
@@ -161,41 +166,55 @@
   window.electronAPI.recordingStart({ sourceId: input.sourceId, sourceName: input.sourceName });
   try {
     await window.electronAPI.recordingCreate(id);
-    const handle = await startEngine({
-      sourceId: input.sourceId,
-      microphoneDeviceId: input.microphoneDeviceId,
-      systemAudio: input.systemAudio,
-      width: input.width,
-      height: input.height,
-      frameRate: input.frameRate,
-      videoBitrate: input.videoBitrate,
-      watermark: input.watermark,
-      onChunk: (data, position) => window.electronAPI.recordingWrite(id, data, position),
-      // A failure mid-recording (encoder error or the screen capture ending)
-      // runs the same robust stop — finalize-or-abort + always restore the
-      // window/Dock/bar — so the app never gets stuck.
-      onError: (error) => {
-        reportError(runtimeT()("record.errorStopped"), error, {
-          context: { sourceId: input.sourceId, phase: "mid-recording" },
-          retry: () => {
-            if (lastResolveInput) requestStartRecording(lastResolveInput);
-          },
-        });
-        void stopRecording();
-      },
-    });
+    // Best-effort, and started CONCURRENTLY with the engine: main resolves the
+    // captured display through desktopCapturer.getSources(), which costs
+    // 100–500 ms, and the recording must never wait for it. The call never
+    // throws — it resolves to a no-op session when main declines (window source,
+    // unknown display), when IPC fails, or after its own 500 ms timeout.
+    const [track, handle] = await Promise.all([
+      beginCursorTrackSession(window.electronAPI, id, input.sourceId),
+      startEngine({
+        sourceId: input.sourceId,
+        microphoneDeviceId: input.microphoneDeviceId,
+        systemAudio: input.systemAudio,
+        width: input.width,
+        height: input.height,
+        frameRate: input.frameRate,
+        videoBitrate: input.videoBitrate,
+        watermark: input.watermark,
+        onChunk: (data, position) => window.electronAPI.recordingWrite(id, data, position),
+        // A failure mid-recording (encoder error or the screen capture ending)
+        // runs the same robust stop — finalize-or-abort + always restore the
+        // window/Dock/bar — so the app never gets stuck.
+        onError: (error) => {
+          reportError(runtimeT()("record.errorStopped"), error, {
+            context: { sourceId: input.sourceId, phase: "mid-recording" },
+            retry: () => {
+              if (lastResolveInput) requestStartRecording(lastResolveInput);
+            },
+          });
+          void stopRecording();
+        },
+      }),
+    ]);
+    cursorTrack = track;

     if (cancelRequested) {
       cancelRequested = false;
       await handle.stop();
       await window.electronAPI.recordingAbort(id);
       window.electronAPI.recordingStop(); // undo the early hide
+      cursorTrack = null;
       sessionId = null;
       update({ status: "idle", countdown: null });
       return;
     }

     engine = handle;
+    const activeTrack = cursorTrack;
+    void handle.firstMediaTimestamp.then(({ rendererMs, quality }) =>
+      activeTrack?.anchor(rendererMs, quality),
+    );
     clock = startElapsed(Date.now());
     update({ status: "recording", countdown: null });

@@ -221,6 +240,7 @@
     // leave it hidden with nothing recording.
     window.electronAPI.recordingStop();
     engine = null;
+    cursorTrack = null;
     sessionId = null;
     // Back to idle (not a separate "error" state) so the Start button is
     // immediately usable again; the toast above carries the retry action.
@@ -230,14 +250,18 @@

 export function pauseRecording(): void {
   if (!engine || !clock) return;
+  const pausedAt = performance.now();
   engine.pause();
+  cursorTrack?.pause(pausedAt);
   clock = pauseElapsed(clock, Date.now());
   update({ status: "paused" });
 }

 export function resumeRecording(): void {
   if (!engine || !clock) return;
+  const resumedAt = performance.now();
   engine.resume();
+  cursorTrack?.resume(resumedAt);
   clock = resumeElapsed(clock, Date.now());
   update({ status: "recording" });
 }
@@ -290,6 +314,7 @@
   if (recording) for (const listener of completeListeners) listener(recording);
   window.electronAPI.recordingStop();
   engine = null;
+  cursorTrack = null;
   sessionId = null;
   clock = null;
   stopping = false;
```

**Diff — `apps/kaipu-record/src/renderer/src/features/recording/recorder-store.test.ts`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/recording/recorder-store.test.ts
+++ b/apps/kaipu-record/src/renderer/src/features/recording/recorder-store.test.ts
@@ -60,6 +60,7 @@
     stop: vi.fn(async () => {}),
     readLevels: vi.fn(() => [0, 0, 0, 0, 0]),
     thumbnail: null,
+    firstMediaTimestamp: Promise.resolve({ rendererMs: 0, quality: "estimated" as const }),
   };
 }

```

- [ ] Nothing else. Finalize / abort already reach main, which finishes or discards the
      tracker by session id (doc 02).

### Task 7 — verify

- [ ] `bunx oxfmt --check .` · `cd apps/kaipu-record && bun run check-types && bun run test`.
- [ ] Manual, macOS (after doc 02 is also done): record 20 s of screen, pausing twice for
      ~3 s each; move the pointer in a big circle the whole time. Open
      `<vault>/.kaipu/<id>.cursor.json`: `anchor` is `"exact"`, the last `t` is within
      ±100 ms of the recording's duration × 1000, and there is no gap of ≥ 2500 ms
      between consecutive `t` values (pauses were removed, not left as gaps).

## Acceptance criteria

- Samples after N pauses are not shifted by the paused time (unit test + manual check).
- A mediabunny upgrade that renames `_firstMediaStreamTimestamp` fails
  `first-media-timestamp.test.ts` instead of silently degrading.
- The cursor track never delays the start of a recording: `beginCursorTrackSession` runs
  inside the same `Promise.all` as `startEngine`, so the start costs
  `max(engine, handshake)` and the handshake is itself capped at 500 ms. Sampling begins
  before video time 0 and those early samples are dropped at finalize, so the early start
  is invisible in the file.
- A cursor-track failure of any kind — main declines, IPC throws, main never answers —
  leaves the recording exactly as it is today, and never leaves the store in `starting`.

## Non-goals

- Frame-exact (< 1 frame) alignment across pauses.
- Handling a system sleep **during** a recording (the recording itself is not defined
  across sleep today).

## Reopen if

mediabunny exposes a public first-sample timestamp or pause-offset API (switch to it and
drop the private read), or v2.1 draws a cursor sprite (see doc 12), which needs < 1 frame
error across pauses.
