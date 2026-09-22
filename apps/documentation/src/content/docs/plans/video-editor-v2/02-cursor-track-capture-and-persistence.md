---
title: "Video editor v2 — 02 cursor track capture and persistence"
description: "Main-process cursor sampling for screen recordings: which sources get a track, display resolution, de-duplicated columnar storage instead of a ring buffer, the session-id lifecycle from recordingCreate to finalize, the vault sidecar and its cleanup. Fixes audit W4–W6."
sidebar:
  order: 2
---

# 02 — Cursor track capture and persistence

> **Status: 🔵 Proposed** (2026-09-21). PR 2 ("Cursor position track") in the
> [audit](/plans/video-editor-v2/00-audit/), together with
> [01](/plans/video-editor-v2/01-clock-and-pause-mapping/). Fixes W4, W5, W6.
> No native module and no UI in this PR: clicks arrive in PR 3
> ([03](/plans/video-editor-v2/03-click-hook-permissions-and-gating/)).

## Problem

- **W4 — scope.** The overview normalizes to "the captured display's bounds via
  `displayIdForSource`". That helper returns `undefined` for every `window:` source
  (`recording-hub.ts:208`) and Electron has no API for another app's window bounds, which
  also change while recording. Empty `display_id` values exist on some platforms.
- **W5 — storage.** "Ring-buffers samples" silently drops the start of long recordings.
  At 125 Hz an idle pointer produces thousands of identical points; format and size are
  unspecified.
- **W6 — lifecycle.** `recordingStart` is sent **before** `recordingCreate` and carries
  no session id (`recorder-store.ts:161-163`). The recording id is minted only inside
  `writer.finalize` (`recording-writer.ts`). The same writer serves editor exports
  (`export-…` session ids). `LibraryVault.remove` deletes only the video, sidecar and
  thumbnail (`library-vault.ts:274`), so a new sidecar would be orphaned.

## Decisions

| Topic              | Decision                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which recordings   | **Screen sources only.** `window:` sources, unknown displays and failures → no track; the editor opens exactly as today.                                                                                                                                        |
| Display            | desktopCapturer `display_id` ↔ `String(Display.id)`; if `display_id` is empty and there is exactly one display, use it. Normalize with `Display.bounds` (not `workArea`: the capture includes the menu bar / taskbar).                                          |
| Coordinates        | `screen.getCursorScreenPoint()` (DIP) minus `bounds.x/y`, divided by `bounds.width/height`. Values outside 0–1 = pointer on another display; kept.                                                                                                              |
| Rate               | `setInterval` 8 ms in main — 125 Hz. Real timestamps are stored, so jitter is harmless.                                                                                                                                                                         |
| Storage in memory  | `CursorSampleBuffer`: growable arrays, rounding to 1e-4, duplicate suppression that keeps the last duplicate before a move, hard cap 1 000 000 samples (~2.2 h of constant motion at 125 Hz) after which sampling stops.                                        |
| Tail after stop    | The tracker samples until `recordingFinalize`, which runs after `output.finalize()` and the recorder's `MIN_SAVING_MS` dwell — 0.6–2 s of samples and clicks with no frame behind them. `buildCursorTrack` drops everything past `meta.durationSeconds * 1000`. |
| Truncation         | When the cap is hit, the video-time ms of the first dropped sample is persisted as `truncatedAtMs`. The v2 editor ignores the field; it exists so a support report can tell "the pointer stopped moving" from "we stopped recording it".                        |
| Correlation        | Keyed by the **writer session id** (`session-N`). The renderer calls `cursorTrackStart(sessionId, sourceId)` right after `recordingCreate`. Export sessions never call it, so they never have a tracker.                                                        |
| When it is written | In the `recordingFinalize` handler, **after** `writer.finalize` returns the recording (that is when the id exists). Written atomically (`tmp` + rename). A write failure is logged and never fails the finalize.                                                |
| Where              | `<vault>/.kaipu/<recordingId>.cursor.json`, beside `<id>.json` / `<id>.jpg` / `<id>.edit.json`.                                                                                                                                                                 |
| Deletion           | `LibraryVault.remove` deletes it. `removeLocalCopy` keeps it (same rule as the edit session: the item may be downloaded back).                                                                                                                                  |
| Cloud              | Never uploaded (the cloud upload only sends the media file today; nothing to change — just do not add it).                                                                                                                                                      |
| Abort / crash      | `recordingAbort` discards the tracker. `forceReset` (renderer gone) discards all. A main-process crash loses the track (the video survives without zooms) — accepted.                                                                                           |
| Size (measured)    | 1 h recording, pointer moving half the time: 225 k samples, **4.9 MB** JSON. Idle recordings are a few KB.                                                                                                                                                      |

## File format

`src/shared/cursor-track.ts` is shared by main (writer) and renderer (editor). Columnar
arrays, video-time integer ms, normalized positions:

```json
{
  "version": 1,
  "display": { "id": "2", "width": 2560, "height": 1440, "scaleFactor": 1 },
  "anchor": "exact",
  "clicksAvailable": false,
  "t": [0, 16, 24],
  "x": [0.5, 0.5, 0.5012],
  "y": [0.4, 0.4, 0.4003],
  "clicks": []
}
```

`clicksAvailable: false` means "no click hook ran", so an empty `clicks` is **unknown**,
not "the user never clicked" — the detector then relies on dwells only.

One optional key is not shown above: `truncatedAtMs`, the video time at which sampling
stopped because `MAX_CURSOR_SAMPLES` was reached. It is absent from every normal
recording, `parseCursorTrack` accepts it as optional, and **the v2 editor ignores it** —
it is written so that a two-hour take with a frozen-looking pointer is diagnosable.

## Files

| Action | Path (under `apps/kaipu-record/`)                             |
| ------ | ------------------------------------------------------------- |
| Create | `src/shared/cursor-track.ts` + `.test.ts`                     |
| Create | `src/main/recording/cursor-sample-buffer.ts` + `.test.ts`     |
| Create | `src/main/recording/build-cursor-track.ts` + `.test.ts`       |
| Create | `src/main/recording/cursor-tracker.ts` + `.test.ts`           |
| Create | `src/main/recording/captured-display.ts` + `.test.ts`         |
| Modify | `src/main/library/library-vault.ts` + `library-vault.test.ts` |
| Modify | `src/main/recording/recording-hub.ts`                         |
| Modify | `src/main/library/index.ts`                                   |
| Modify | `src/shared/types/ipc.ts`, `src/shared/types/electron-api.ts` |
| Modify | `src/preload/index.ts`, `src/renderer/src/test/setup.ts`      |

## Tasks

### Task 1 — shared format

- [ ] Create:

**`apps/kaipu-record/src/shared/cursor-track.ts`**

```ts
/**
 * Cursor event track — the sidecar the recorder writes next to a screen recording
 * (`.kaipu/<id>.cursor.json`). Shared by main (writer) and renderer (editor).
 *
 * Time: VIDEO time in integer milliseconds — 0 is the first media sample of the MP4,
 * and recorder pauses are already removed (main rebases every sample at finalize, see
 * main/recording/cursor-clock.ts). Consumers never deal with clocks or pauses.
 *
 * Space: x/y are normalized 0–1 of the captured display's bounds. Values outside
 * [0, 1] are legal — the pointer was on another display.
 *
 * Storage is columnar (`t`, `x`, `y` parallel arrays) to keep the JSON small.
 */

export const CURSOR_TRACK_VERSION = 1;

/** 0 = primary (left), 1 = middle, 2 = secondary (right) — same as DOM MouseEvent.button. */
export type CursorButton = 0 | 1 | 2;

export interface CursorClick {
  t: number;
  x: number;
  y: number;
  button: CursorButton;
}

export interface CursorTrack {
  version: 1;
  /** The captured display, in DIP. `id` is Electron's `Display.id` as a string. */
  display: { id: string; width: number; height: number; scaleFactor: number };
  /**
   * "exact" when t0 came from mediabunny's first-media timestamp; "estimated" when
   * the fallback (renderer clock right after `output.start()`) was used.
   */
  anchor: "exact" | "estimated";
  /** False when no click hook ran — an empty `clicks` then means "unknown", not "none". */
  clicksAvailable: boolean;
  t: number[];
  x: number[];
  y: number[];
  clicks: CursorClick[];
  /**
   * Video time at which sampling stopped because MAX_CURSOR_SAMPLES was reached.
   * Absent on every normal recording. The v2 editor ignores it: it exists so that a
   * very long take whose pointer "freezes" halfway is diagnosable from the sidecar.
   */
  truncatedAtMs?: number;
}

export interface CursorPoint {
  x: number;
  y: number;
}

export function serializeCursorTrack(track: CursorTrack): string {
  return JSON.stringify(track);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNumArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every(isNum);
}

/**
 * Structural validation (no zod — same convention as video-editor/session.ts).
 * Returns null for anything malformed so the editor silently opens without zooms.
 */
export function parseCursorTrack(json: string): CursorTrack | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== CURSOR_TRACK_VERSION) return null;

  const d = r.display as Record<string, unknown> | null | undefined;
  if (typeof d !== "object" || d === null) return null;
  if (typeof d.id !== "string" || !isNum(d.width) || !isNum(d.height) || !isNum(d.scaleFactor))
    return null;
  if (d.width <= 0 || d.height <= 0) return null;

  if (r.anchor !== "exact" && r.anchor !== "estimated") return null;
  if (typeof r.clicksAvailable !== "boolean") return null;
  // Optional: absent unless the sample cap was hit. Present-but-malformed is a reject.
  if (r.truncatedAtMs !== undefined && !isNum(r.truncatedAtMs)) return null;

  if (!isNumArray(r.t) || !isNumArray(r.x) || !isNumArray(r.y)) return null;
  if (r.t.length !== r.x.length || r.t.length !== r.y.length) return null;
  for (let i = 1; i < r.t.length; i++) {
    if (r.t[i] < r.t[i - 1]) return null; // must be sorted for binary search
  }

  if (!Array.isArray(r.clicks)) return null;
  const clicks: CursorClick[] = [];
  for (const c of r.clicks as unknown[]) {
    if (typeof c !== "object" || c === null) return null;
    const cc = c as Record<string, unknown>;
    if (!isNum(cc.t) || !isNum(cc.x) || !isNum(cc.y)) return null;
    if (cc.button !== 0 && cc.button !== 1 && cc.button !== 2) return null;
    clicks.push({ t: cc.t, x: cc.x, y: cc.y, button: cc.button });
  }
  clicks.sort((a, b) => a.t - b.t);

  const track: CursorTrack = {
    version: 1,
    display: { id: d.id, width: d.width, height: d.height, scaleFactor: d.scaleFactor },
    anchor: r.anchor,
    clicksAvailable: r.clicksAvailable,
    t: r.t,
    x: r.x,
    y: r.y,
    clicks,
  };
  if (isNum(r.truncatedAtMs)) track.truncatedAtMs = r.truncatedAtMs;
  return track;
}

/** Index of the last sample with `t[i] <= tMs`, or -1 when `tMs` is before the first. */
export function lastIndexAtOrBefore(t: number[], tMs: number): number {
  let lo = 0;
  let hi = t.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= tMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Pointer position at video time `tMs` (linear interpolation between the two
 * surrounding samples; clamped to the first/last sample outside the track).
 * Returns null only for an empty track.
 */
export function sampleCursor(track: CursorTrack, tMs: number): CursorPoint | null {
  const n = track.t.length;
  if (n === 0) return null;
  const i = lastIndexAtOrBefore(track.t, tMs);
  if (i < 0) return { x: track.x[0], y: track.y[0] };
  if (i >= n - 1) return { x: track.x[n - 1], y: track.y[n - 1] };
  const t0 = track.t[i];
  const t1 = track.t[i + 1];
  const k = t1 === t0 ? 0 : (tMs - t0) / (t1 - t0);
  return {
    x: track.x[i] + (track.x[i + 1] - track.x[i]) * k,
    y: track.y[i] + (track.y[i + 1] - track.y[i]) * k,
  };
}

/** True when a normalized point lies on the captured display. */
export function isOnDisplay(p: CursorPoint): boolean {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}
```

- [ ] Test (runs in the `main` vitest project because it lives under `src/shared/`):

**`apps/kaipu-record/src/shared/cursor-track.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  lastIndexAtOrBefore,
  parseCursorTrack,
  sampleCursor,
  serializeCursorTrack,
  type CursorTrack,
} from "./cursor-track";

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

describe("parseCursorTrack", () => {
  it("round-trips a valid track", () => {
    const tr = track({ t: [0, 10], x: [0.1, 0.2], y: [0.3, 0.4] });
    expect(parseCursorTrack(serializeCursorTrack(tr))).toEqual(tr);
  });
  it("keeps truncatedAtMs when it is there, and omits it when it is not", () => {
    const tr = track({ t: [0], x: [0], y: [0], truncatedAtMs: 8_000_000 });
    expect(parseCursorTrack(serializeCursorTrack(tr))?.truncatedAtMs).toBe(8_000_000);
    expect(parseCursorTrack(serializeCursorTrack(track()))).not.toHaveProperty("truncatedAtMs");
  });
  it.each([
    ["bad json", "{"],
    ["wrong version", JSON.stringify({ ...track(), version: 2 })],
    ["ragged arrays", JSON.stringify(track({ t: [0, 1], x: [0], y: [0] }))],
    ["unsorted t", JSON.stringify(track({ t: [5, 1], x: [0, 0], y: [0, 0] }))],
    ["bad button", JSON.stringify(track({ clicks: [{ t: 0, x: 0, y: 0, button: 7 as 0 }] }))],
    ["zero display", JSON.stringify(track({ display: { ...DISPLAY, width: 0 } }))],
    ["non-numeric truncatedAtMs", JSON.stringify({ ...track(), truncatedAtMs: "yes" })],
  ])("rejects %s", (_label: string, json: string) => {
    expect(parseCursorTrack(json)).toBeNull();
  });
});

describe("sampleCursor", () => {
  const tr = track({ t: [0, 100, 200], x: [0, 1, 1], y: [0, 0, 1] });
  it("interpolates between samples", () => {
    expect(sampleCursor(tr, 50)).toEqual({ x: 0.5, y: 0 });
    expect(sampleCursor(tr, 150)).toEqual({ x: 1, y: 0.5 });
  });
  it("clamps outside the track", () => {
    expect(sampleCursor(tr, -10)).toEqual({ x: 0, y: 0 });
    expect(sampleCursor(tr, 999)).toEqual({ x: 1, y: 1 });
  });
  it("returns null for an empty track", () => {
    expect(sampleCursor(track(), 10)).toBeNull();
  });
  it("binary search finds the last index at or before t", () => {
    expect(lastIndexAtOrBefore([0, 10, 10, 20], 10)).toBe(2);
    expect(lastIndexAtOrBefore([0, 10], -1)).toBe(-1);
  });
});
```

### Task 2 — sample buffer

**`apps/kaipu-record/src/main/recording/cursor-sample-buffer.ts`**

```ts
/**
 * Growable, de-duplicating store for raw cursor samples (main clock, normalized
 * position). NOT a ring buffer: a ring buffer silently drops the start of any
 * recording longer than its capacity, and the detector needs the whole take.
 *
 * De-duplication: an idle pointer produces the same position 125 times a second.
 * Identical samples are skipped, BUT the last skipped one is written right before
 * the next different sample. Without that, interpolation would glide slowly from
 * the old position (seconds ago) to the new one instead of jumping when it moved.
 */

/** 1e-4 of the display ≈ 0.26 px on a 2560 px panel — below visible precision. */
const POSITION_DECIMALS = 1e4;

/** ~2.2 h at 125 Hz of constant motion. Past this, sampling stops (the file stays valid). */
export const MAX_CURSOR_SAMPLES = 1_000_000;

export class CursorSampleBuffer {
  readonly t: number[] = [];
  readonly x: number[] = [];
  readonly y: number[] = [];
  private pending: { t: number; x: number; y: number } | null = null;
  /**
   * Main-clock ms of the FIRST sample dropped because the cap was hit; null when the
   * cap was never reached. Persisted (rebased to video time) as `CursorTrack.truncatedAtMs`.
   */
  truncatedAtMs: number | null = null;

  push(t: number, x: number, y: number): void {
    if (this.t.length >= MAX_CURSOR_SAMPLES) {
      this.truncatedAtMs ??= t;
      return;
    }
    const rx = Math.round(x * POSITION_DECIMALS) / POSITION_DECIMALS;
    const ry = Math.round(y * POSITION_DECIMALS) / POSITION_DECIMALS;
    const n = this.t.length;
    if (n > 0 && this.x[n - 1] === rx && this.y[n - 1] === ry) {
      this.pending = { t, x: rx, y: ry };
      return;
    }
    if (this.pending) {
      this.append(this.pending.t, this.pending.x, this.pending.y);
      this.pending = null;
    }
    this.append(t, rx, ry);
  }

  /** Write the trailing duplicate (if any) so the last known position is timed correctly. */
  flush(): void {
    if (this.pending) {
      this.append(this.pending.t, this.pending.x, this.pending.y);
      this.pending = null;
    }
  }

  get length(): number {
    return this.t.length;
  }

  private append(t: number, x: number, y: number): void {
    this.t.push(t);
    this.x.push(x);
    this.y.push(y);
  }
}
```

**`apps/kaipu-record/src/main/recording/cursor-sample-buffer.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { CursorSampleBuffer, MAX_CURSOR_SAMPLES } from "./cursor-sample-buffer";

describe("CursorSampleBuffer", () => {
  it("skips duplicates but writes the last one before a move", () => {
    const b = new CursorSampleBuffer();
    b.push(0, 0.5, 0.5);
    b.push(8, 0.5, 0.5);
    b.push(16, 0.5, 0.5);
    b.push(24, 0.6, 0.5);
    expect(b.t).toEqual([0, 16, 24]);
    expect(b.x).toEqual([0.5, 0.5, 0.6]);
  });
  it("flush writes a trailing duplicate", () => {
    const b = new CursorSampleBuffer();
    b.push(0, 0.1, 0.1);
    b.push(500, 0.1, 0.1);
    b.flush();
    expect(b.t).toEqual([0, 500]);
  });
  it("rounds to 1e-4 so sub-pixel jitter counts as a duplicate", () => {
    const b = new CursorSampleBuffer();
    b.push(0, 0.12341, 0.5);
    b.push(8, 0.12344, 0.5);
    b.flush();
    expect(b.x).toEqual([0.1234, 0.1234]);
  });
  it("stops at the cap and records when it stopped", () => {
    const b = new CursorSampleBuffer();
    for (let i = 0; i <= MAX_CURSOR_SAMPLES; i++) b.push(i, (i % 2) / 2, 0);
    expect(b.length).toBe(MAX_CURSOR_SAMPLES);
    // One push per sample, t === i, so the first rejected sample is t = the cap.
    expect(b.truncatedAtMs).toBe(MAX_CURSOR_SAMPLES);
    b.push(MAX_CURSOR_SAMPLES + 50, 0, 0);
    expect(b.truncatedAtMs).toBe(MAX_CURSOR_SAMPLES); // first drop wins
  });
});
```

### Task 3 — build the persisted track

Depends on `cursor-clock.ts` from [01 Task 1](/plans/video-editor-v2/01-clock-and-pause-mapping/#task-1--cursor-clockts-main-pure).

**`apps/kaipu-record/src/main/recording/build-cursor-track.ts`**

```ts
/**
 * Folds the raw main-clock samples collected during a recording into the persisted
 * `CursorTrack` (video-time ms). Pure — the tracker calls it once, at finalize.
 */
import type { CursorButton, CursorClick, CursorTrack } from "@shared/cursor-track";
import { type ClockAnchor, toVideoTimeMs } from "./cursor-clock";

export interface RawCursorData {
  /** Parallel arrays, main clock ms (already de-duplicated by CursorSampleBuffer). */
  t: number[];
  x: number[];
  y: number[];
  /** Main clock ms; position already normalized to the captured display. */
  clicks: { t: number; x: number; y: number; button: CursorButton }[];
}

export interface BuildCursorTrackInput {
  raw: RawCursorData;
  anchor: ClockAnchor;
  anchorQuality: "exact" | "estimated";
  clicksAvailable: boolean;
  display: CursorTrack["display"];
  /**
   * Video time of the last frame in the file (`meta.durationSeconds * 1000`), when the
   * caller knows it. The tracker keeps sampling until `recordingFinalize`, which only
   * runs after `output.finalize()` and the recorder's MIN_SAVING_MS dwell — without
   * this cut the track carries 0.6–2 s of samples and clicks past the end of the media
   * (the user moving the pointer to the "Saving…" bar, or clicking Stop again).
   */
  maxMs?: number;
  /** `CursorSampleBuffer.truncatedAtMs` — main clock, null when the cap was never hit. */
  truncatedAtMainMs?: number | null;
}

export function buildCursorTrack(input: BuildCursorTrackInput): CursorTrack {
  const { maxMs } = input;
  const beyondEnd = (ms: number): boolean => maxMs !== undefined && ms > maxMs;
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < input.raw.t.length; i++) {
    const v = toVideoTimeMs(input.raw.t[i], input.anchor);
    if (v === null) continue;
    const ms = Math.round(v);
    if (beyondEnd(ms)) continue;
    // Rounding can make two samples share a millisecond; keep the later one only.
    if (t.length > 0 && t[t.length - 1] === ms) {
      x[x.length - 1] = input.raw.x[i];
      y[y.length - 1] = input.raw.y[i];
      continue;
    }
    t.push(ms);
    x.push(input.raw.x[i]);
    y.push(input.raw.y[i]);
  }

  const clicks: CursorClick[] = [];
  for (const c of input.raw.clicks) {
    const v = toVideoTimeMs(c.t, input.anchor);
    if (v === null) continue;
    const ms = Math.round(v);
    if (beyondEnd(ms)) continue;
    clicks.push({ t: ms, x: c.x, y: c.y, button: c.button });
  }
  clicks.sort((a, b) => a.t - b.t);

  const track: CursorTrack = {
    version: 1,
    display: input.display,
    anchor: input.anchorQuality,
    clicksAvailable: input.clicksAvailable,
    t,
    x,
    y,
    clicks,
  };
  if (input.truncatedAtMainMs != null) {
    const v = toVideoTimeMs(input.truncatedAtMainMs, input.anchor);
    // A cap hit inside a pause, or after the last frame, is not worth reporting.
    if (v !== null && !beyondEnd(Math.round(v))) track.truncatedAtMs = Math.round(v);
  }
  return track;
}
```

**`apps/kaipu-record/src/main/recording/build-cursor-track.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildCursorTrack } from "./build-cursor-track";

const DISPLAY = { id: "1", width: 1600, height: 1000, scaleFactor: 2 };

describe("buildCursorTrack", () => {
  it("rebases samples and clicks to video time and drops paused ones", () => {
    const result = buildCursorTrack({
      raw: {
        t: [900, 1000, 1500, 3500, 5200],
        x: [0.1, 0.2, 0.3, 0.4, 0.5],
        y: [0, 0, 0, 0, 0],
        clicks: [
          { t: 1200, x: 0.2, y: 0.2, button: 0 },
          { t: 4000, x: 0.3, y: 0.3, button: 0 },
        ],
      },
      anchor: { t0: 1000, pauses: [{ start: 3000, end: 5000 }] },
      anchorQuality: "exact",
      clicksAvailable: true,
      display: DISPLAY,
    });
    expect(result.t).toEqual([0, 500, 2200]);
    expect(result.x).toEqual([0.2, 0.3, 0.5]);
    expect(result.clicks).toEqual([{ t: 200, x: 0.2, y: 0.2, button: 0 }]);
    expect(result).not.toHaveProperty("truncatedAtMs");
  });

  it("cuts the tail sampled after the last frame (maxMs)", () => {
    const result = buildCursorTrack({
      raw: {
        t: [1000, 2000, 3500],
        x: [0.1, 0.2, 0.9],
        y: [0, 0, 0],
        clicks: [
          { t: 2500, x: 0.2, y: 0.2, button: 0 },
          { t: 3400, x: 0.9, y: 0.9, button: 0 },
        ],
      },
      anchor: { t0: 1000, pauses: [] },
      anchorQuality: "exact",
      clicksAvailable: true,
      display: DISPLAY,
      // The recording is 2 s long; everything after it was sampled while "Saving…".
      maxMs: 2000,
    });
    expect(result.t).toEqual([0, 1000]);
    expect(result.clicks).toEqual([{ t: 1500, x: 0.2, y: 0.2, button: 0 }]);
  });

  it("rebases the truncation point to video time", () => {
    const result = buildCursorTrack({
      raw: { t: [1000], x: [0.1], y: [0], clicks: [] },
      anchor: { t0: 1000, pauses: [] },
      anchorQuality: "exact",
      clicksAvailable: false,
      display: DISPLAY,
      maxMs: 10_000,
      truncatedAtMainMs: 4000,
    });
    expect(result.truncatedAtMs).toBe(3000);
  });
});
```

### Task 4 — tracker and registry

**`apps/kaipu-record/src/main/recording/cursor-tracker.ts`**

```ts
/**
 * Main-process cursor sampler for ONE recording (one writer session id). Pure-ish:
 * Electron is injected (`CursorTrackerDeps`) so the whole lifecycle is unit-tested.
 *
 * Lifecycle (driven by recording-hub.ts IPC handlers):
 *   start()            recorder called cursorTrackStart — sampling begins at once, so
 *                      the samples before the first frame exist and are trimmed later
 *   setAnchor(t0)      recorder measured video time 0 (main clock)
 *   pause()/resume()   recorder paused/resumed the encoder (main clock)
 *   addClick(button)   click hook fired (doc 03); position = poller's current point
 *   stop() + build()   at recordingFinalize — returns the persisted CursorTrack
 */
import type { CursorButton, CursorTrack } from "@shared/cursor-track";
import { buildCursorTrack } from "./build-cursor-track";
import { type ClockAnchor, closeOpenPause } from "./cursor-clock";
import { CursorSampleBuffer } from "./cursor-sample-buffer";

/**
 * 8 ms = 125 Hz. `screen.getCursorScreenPoint()` is a synchronous call on the same main
 * thread that serialises the recording's chunk writes, so this rate is a budget, not a
 * free choice — Task 9 measures it against a 5-minute high-quality take and says when to
 * back off to 16 ms (60 Hz), which is still twice the frame rate.
 */
export const CURSOR_SAMPLE_INTERVAL_MS = 8;

export interface CapturedDisplay {
  /** Electron `Display.id` as a string (desktopCapturer's `display_id`). */
  id: string;
  /** DIP, global desktop space — `Display.bounds` (NOT workArea: capture includes the menu bar). */
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export interface CursorTrackerDeps {
  /** Main-process `performance.now()`. */
  now(): number;
  /** `screen.getCursorScreenPoint()` — DIP, global desktop space. */
  cursorPoint(): { x: number; y: number };
  /** Run `fn` every `ms`; returns a function that stops it. */
  every(ms: number, fn: () => void): () => void;
}

export class CursorTracker {
  private readonly samples = new CursorSampleBuffer();
  private readonly clicks: { t: number; x: number; y: number; button: CursorButton }[] = [];
  private anchor: ClockAnchor | null = null;
  private anchorQuality: "exact" | "estimated" = "estimated";
  private stopTimer: (() => void) | null = null;

  constructor(
    readonly display: CapturedDisplay,
    private readonly deps: CursorTrackerDeps,
  ) {}

  start(): void {
    if (this.stopTimer) return;
    this.sample();
    this.stopTimer = this.deps.every(CURSOR_SAMPLE_INTERVAL_MS, () => this.sample());
  }

  setAnchor(t0MainMs: number, quality: "exact" | "estimated"): void {
    // Pauses recorded before the anchor (impossible in practice) are kept as-is.
    this.anchor = { t0: t0MainMs, pauses: this.anchor?.pauses ?? [] };
    this.anchorQuality = quality;
  }

  pause(atMainMs: number): void {
    const pauses = this.anchor?.pauses ?? [];
    if (pauses.some((p) => p.end === null)) return; // already paused
    this.anchor = {
      t0: this.anchor?.t0 ?? Number.NaN,
      pauses: [...pauses, { start: atMainMs, end: null }],
    };
  }

  resume(atMainMs: number): void {
    if (!this.anchor) return;
    this.anchor = {
      t0: this.anchor.t0,
      pauses: this.anchor.pauses.map((p) =>
        p.end === null ? { start: p.start, end: atMainMs } : p,
      ),
    };
  }

  addClick(button: CursorButton): void {
    if (!this.stopTimer) return;
    const p = this.normalized(this.deps.cursorPoint());
    this.clicks.push({ t: this.deps.now(), x: p.x, y: p.y, button });
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.samples.flush();
  }

  get truncatedAtMs(): number | null {
    return this.samples.truncatedAtMs;
  }

  /**
   * The persisted track, or null when the recorder never sent an anchor.
   * `maxMs` is the recording's duration in ms: this method runs at finalize, well after
   * the last frame, so everything sampled in between has to be cut.
   */
  build(clicksAvailable: boolean, maxMs?: number): CursorTrack | null {
    if (!this.anchor || !Number.isFinite(this.anchor.t0)) return null;
    const anchor = closeOpenPause(this.anchor, this.deps.now());
    return buildCursorTrack({
      raw: { t: this.samples.t, x: this.samples.x, y: this.samples.y, clicks: this.clicks },
      anchor,
      anchorQuality: this.anchorQuality,
      clicksAvailable,
      maxMs,
      truncatedAtMainMs: this.samples.truncatedAtMs,
      display: {
        id: this.display.id,
        width: this.display.bounds.width,
        height: this.display.bounds.height,
        scaleFactor: this.display.scaleFactor,
      },
    });
  }

  private sample(): void {
    const p = this.normalized(this.deps.cursorPoint());
    this.samples.push(this.deps.now(), p.x, p.y);
  }

  private normalized(p: { x: number; y: number }): { x: number; y: number } {
    const b = this.display.bounds;
    return { x: (p.x - b.x) / b.width, y: (p.y - b.y) / b.height };
  }
}

/** All live trackers, keyed by the recorder's writer session id. */
export class CursorTrackRegistry {
  private readonly trackers = new Map<string, CursorTracker>();

  constructor(private readonly deps: CursorTrackerDeps) {}

  start(sessionId: string, display: CapturedDisplay): CursorTracker {
    this.discard(sessionId);
    const tracker = new CursorTracker(display, this.deps);
    this.trackers.set(sessionId, tracker);
    tracker.start();
    return tracker;
  }

  get(sessionId: string): CursorTracker | undefined {
    return this.trackers.get(sessionId);
  }

  /** True while any recording is sampling — the click hook runs only then (doc 03). */
  get active(): boolean {
    return this.trackers.size > 0;
  }

  /** Every live tracker — the click hook fans a click out to all of them. */
  all(): CursorTracker[] {
    return [...this.trackers.values()];
  }

  /**
   * Stop and remove; returns the built track (null when never anchored or unknown id).
   * `maxMs` = the finished recording's duration in ms, so the tail sampled while the
   * file was being finalized is cut.
   */
  finish(sessionId: string, clicksAvailable: boolean, maxMs?: number): CursorTrack | null {
    const tracker = this.trackers.get(sessionId);
    if (!tracker) return null;
    tracker.stop();
    this.trackers.delete(sessionId);
    return tracker.build(clicksAvailable, maxMs);
  }

  discard(sessionId: string): void {
    this.trackers.get(sessionId)?.stop();
    this.trackers.delete(sessionId);
  }

  discardAll(): void {
    for (const id of [...this.trackers.keys()]) this.discard(id);
  }
}
```

**`apps/kaipu-record/src/main/recording/cursor-tracker.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  type CapturedDisplay,
  CursorTrackRegistry,
  type CursorTrackerDeps,
} from "./cursor-tracker";

const DISPLAY: CapturedDisplay = {
  id: "7",
  bounds: { x: 1000, y: 0, width: 1000, height: 500 },
  scaleFactor: 2,
};

/** Manual clock + manual timer: `tick(ms)` advances time and fires the interval. */
function fakeDeps() {
  let clock = 0;
  let point = { x: 1500, y: 250 };
  let fn: (() => void) | null = null;
  let interval = 0;
  let last = 0;
  const deps: CursorTrackerDeps = {
    now: () => clock,
    cursorPoint: () => point,
    every: (ms, f) => {
      fn = f;
      interval = ms;
      last = clock;
      return () => {
        fn = null;
      };
    },
  };
  return {
    deps,
    move: (x: number, y: number) => {
      point = { x, y };
    },
    tick: (ms: number) => {
      const end = clock + ms;
      while (fn && last + interval <= end) {
        last += interval;
        clock = last;
        fn();
      }
      clock = end;
    },
    running: () => fn !== null,
  };
}

describe("CursorTrackRegistry", () => {
  it("samples, normalizes to the display and rebases at finish", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("session-1", DISPLAY);
    f.tick(80);
    tracker.setAnchor(40, "exact");
    f.move(1750, 125);
    f.tick(80);
    const track = reg.finish("session-1", false)!;
    expect(f.running()).toBe(false);
    expect(track.display).toEqual({ id: "7", width: 1000, height: 500, scaleFactor: 2 });
    expect(track.anchor).toBe("exact");
    expect(track.clicksAvailable).toBe(false);
    // Idle 0..80 → only [0, 80] kept; t=0 is before the anchor and is dropped.
    expect(track.t[0]).toBe(40); // main 80 − t0 40
    expect(track.x[0]).toBe(0.5);
    expect(track.t.at(-1)).toBe(120); // main 160 − 40 (trailing duplicate flushed)
    expect(track.x.at(-1)).toBe(0.75);
    expect(track.y.at(-1)).toBe(0.25);
  });

  it("removes paused time and drops paused samples", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("s", DISPLAY);
    tracker.setAnchor(0, "exact");
    f.tick(100);
    tracker.pause(100);
    f.move(1100, 100);
    f.tick(1000);
    tracker.resume(1100);
    f.move(1200, 100);
    f.tick(100);
    const track = reg.finish("s", true)!;
    expect(track.t.at(-1)).toBe(200); // 1200 − 1000 paused
    expect(track.x).not.toContain(0.1); // the position only seen while paused
  });

  it("closes an open pause at finish", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("s", DISPLAY);
    tracker.setAnchor(0, "estimated");
    f.tick(50);
    tracker.pause(50);
    f.tick(500);
    const track = reg.finish("s", true)!;
    expect(Math.max(...track.t)).toBeLessThanOrEqual(50);
  });

  it("cuts the tail sampled between the last frame and finalize", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("s", DISPLAY);
    tracker.setAnchor(0, "exact");
    f.tick(1000);
    f.move(1900, 400);
    f.tick(1000); // the "Saving…" dwell: still sampled, but no frame exists for it
    const track = reg.finish("s", true, 1000)!;
    expect(Math.max(...track.t)).toBeLessThanOrEqual(1000);
    expect(track.x).not.toContain(0.9);
  });

  it("records clicks at the poller position", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("s", DISPLAY);
    tracker.setAnchor(0, "exact");
    f.tick(16);
    f.move(1250, 375);
    tracker.addClick(0);
    const track = reg.finish("s", true)!;
    expect(track.clicks).toEqual([{ t: 16, x: 0.25, y: 0.75, button: 0 }]);
  });

  it("returns null without an anchor and for unknown sessions", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    reg.start("s", DISPLAY);
    f.tick(40);
    expect(reg.finish("s", true)).toBeNull();
    expect(reg.finish("nope", true)).toBeNull();
  });

  it("discardAll stops every tracker", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    reg.start("a", DISPLAY);
    expect(reg.active).toBe(true);
    reg.discardAll();
    expect(reg.active).toBe(false);
    expect(f.running()).toBe(false);
  });
});
```

### Task 5 — display resolution

**`apps/kaipu-record/src/main/recording/captured-display.ts`**

```ts
/**
 * Which display a capture source records — the space cursor samples are normalized to.
 * Pure: the caller passes desktopCapturer's `display_id` and `screen.getAllDisplays()`.
 *
 * Only SCREEN sources get a cursor track in v2. A `window:` source has no display
 * mapping: Electron cannot read another app's window bounds, and the window can move or
 * resize mid-recording, so there is nothing stable to normalize against.
 */
import type { CapturedDisplay } from "./cursor-tracker";

export interface DisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

export function pickCapturedDisplay(
  sourceId: string,
  /** desktopCapturer source `display_id` ("" or undefined on some platforms). */
  displayId: string | undefined,
  displays: DisplayLike[],
): CapturedDisplay | null {
  if (!sourceId.startsWith("screen:")) return null;
  const byId = displayId ? displays.find((d) => String(d.id) === displayId) : undefined;
  // Some platforms report an empty display_id; with a single display it is unambiguous.
  const display = byId ?? (displays.length === 1 ? displays[0] : undefined);
  if (!display || display.bounds.width <= 0 || display.bounds.height <= 0) return null;
  return {
    id: String(display.id),
    bounds: { ...display.bounds },
    scaleFactor: display.scaleFactor,
  };
}
```

**`apps/kaipu-record/src/main/recording/captured-display.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { type DisplayLike, pickCapturedDisplay } from "./captured-display";

const A: DisplayLike = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, scaleFactor: 2 };
const B: DisplayLike = {
  id: 2,
  bounds: { x: 1512, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1,
};

describe("pickCapturedDisplay", () => {
  it("matches the display by desktopCapturer display_id", () => {
    expect(pickCapturedDisplay("screen:2:0", "2", [A, B])).toEqual({
      id: "2",
      bounds: B.bounds,
      scaleFactor: 1,
    });
  });
  it("falls back to the only display when display_id is empty", () => {
    expect(pickCapturedDisplay("screen:0:0", "", [A])?.id).toBe("1");
  });
  it("gives up when display_id is empty and there are several displays", () => {
    expect(pickCapturedDisplay("screen:0:0", "", [A, B])).toBeNull();
  });
  it("never tracks window sources", () => {
    expect(pickCapturedDisplay("window:123:0", "1", [A])).toBeNull();
  });
});
```

### Task 6 — vault sidecar

In `src/main/library/library-vault.ts`:

- [ ] Add `rename` to the existing `node:fs/promises` import if it is not there yet.
- [ ] After `thumbnailPath(id)` add:

  ```ts
  /** Cursor event track written at record time (video-editor v2 auto-zoom). */
  cursorTrackPath(id: string): string {
    return join(this.metaDirectory(), `${id}.cursor.json`);
  }
  ```

- [ ] After `writeThumbnail` add:

  ```ts
  /** Atomic (temp + rename): a crash mid-write never leaves a truncated track. */
  async writeCursorTrack(id: string, json: string): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    const target = this.cursorTrackPath(id);
    await writeFile(`${target}.tmp`, json, "utf-8");
    await rename(`${target}.tmp`, target);
  }

  /** The raw track JSON, or null when this recording has none. */
  async readCursorTrack(id: string): Promise<string | null> {
    try {
      return await readFile(this.cursorTrackPath(id), "utf-8");
    } catch {
      return null;
    }
  }
  ```

- [ ] In `remove(id)`, add **two** entries to the `Promise.allSettled([...])` list:
      `rm(this.cursorTrackPath(id), { force: true }),` and
      ``rm(`${this.cursorTrackPath(id)}.tmp`, { force: true }),``. The second one matters
      because `writeCursorTrack` writes `<id>.cursor.json.tmp` and then renames: a crash
      or a full disk between the two leaves the temp file in `.kaipu/`, and without this
      line deleting the recording would leave it behind forever. **Do not** touch
      `removeLocalCopy`.
- [ ] Add to `library-vault.test.ts` inside `describe("LibraryVault")`:

  ```ts
  it("writes, reads and removes the cursor track sidecar", async () => {
    await writeRecording("rec");
    expect(await vault.readCursorTrack("rec")).toBeNull();
    await vault.writeCursorTrack("rec", '{"version":1}');
    expect(await vault.readCursorTrack("rec")).toBe('{"version":1}');
    expect(await readdir(join(directory, ".kaipu"))).not.toContain("rec.cursor.json.tmp");
    await vault.remove("rec");
    expect(await vault.readCursorTrack("rec")).toBeNull();
  });

  it("removes a cursor track temp file left behind by an interrupted write", async () => {
    await writeRecording("rec");
    await vault.writeCursorTrack("rec", "{}");
    await writeFile(`${vault.cursorTrackPath("rec")}.tmp`, "half", "utf-8");
    await vault.remove("rec");
    expect(await readdir(join(directory, ".kaipu"))).not.toContain("rec.cursor.json.tmp");
  });

  it("keeps the cursor track when only the local copy is removed", async () => {
    await writeRecording("rec");
    await vault.writeCursorTrack("rec", "{}");
    await vault.removeLocalCopy("rec");
    expect(await vault.readCursorTrack("rec")).toBe("{}");
  });
  ```

  `writeFile`, `readdir` and `join` are already imported by that test file.

### Task 7 — IPC

- [ ] `src/shared/types/ipc.ts`, inside `IPC_CHANNELS` after `recordingStop`:

  ```ts
  // Cursor track (recorder renderer → main). Keyed by the writer session id. See
  // plans/video-editor-v2/02: main samples the pointer; the renderer sends the clock
  // anchor and pause edges already converted to main-clock ms.
  cursorTrackStart: "cursor-track:start",
  cursorClockNow: "cursor-track:clock-now",
  cursorTrackAnchor: "cursor-track:anchor",
  cursorTrackPause: "cursor-track:pause",
  cursorTrackResume: "cursor-track:resume",
  ```

- [ ] `src/shared/types/ipc.ts` again — `loadCursorTrack` is a `library:` channel and
      belongs with the other `library:` channels, **not** in the cursor-track block
      above. Add it right after `removeLocalCopy: "library:remove-local-copy",`, which is
      the last one of that group:

  ```ts
  // Editor: read a recording's cursor track sidecar (raw JSON or null).
  loadCursorTrack: "library:load-cursor-track",
  ```

- [ ] `src/shared/types/electron-api.ts`, in the "Recording engine" section after
      `recordingStop(): void;`:

  ```ts
  /** Start sampling the pointer for this writer session. `enabled: false` = no track (window source, unknown display). */
  cursorTrackStart(sessionId: string, sourceId: string): Promise<{ enabled: boolean }>;
  /** Main-process performance.now(), for the renderer→main clock handshake. */
  cursorClockNow(): Promise<number>;
  /** Video time 0 of this session, in main-clock ms. */
  cursorTrackAnchor(sessionId: string, t0MainMs: number, quality: "exact" | "estimated"): void;
  cursorTrackPause(sessionId: string, atMainMs: number): void;
  cursorTrackResume(sessionId: string, atMainMs: number): void;
  ```

  and in the "Video-editor session persistence" section:

  ```ts
  /** Raw `.cursor.json` for a recording, or null when it has none. Parse with parseCursorTrack. */
  loadCursorTrack(id: string): Promise<string | null>;
  ```

- [ ] `src/preload/index.ts`, next to `recordingStop`:

  ```ts
  cursorTrackStart: (sessionId, sourceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cursorTrackStart, sessionId, sourceId),
  cursorClockNow: () => ipcRenderer.invoke(IPC_CHANNELS.cursorClockNow),
  cursorTrackAnchor: (sessionId, t0MainMs, quality) =>
    ipcRenderer.send(IPC_CHANNELS.cursorTrackAnchor, sessionId, t0MainMs, quality),
  cursorTrackPause: (sessionId, atMainMs) =>
    ipcRenderer.send(IPC_CHANNELS.cursorTrackPause, sessionId, atMainMs),
  cursorTrackResume: (sessionId, atMainMs) =>
    ipcRenderer.send(IPC_CHANNELS.cursorTrackResume, sessionId, atMainMs),
  ```

  and next to `loadVideoEditSession`:

  ```ts
  loadCursorTrack: (id) => ipcRenderer.invoke(IPC_CHANNELS.loadCursorTrack, id),
  ```

- [ ] `src/renderer/src/test/setup.ts`, in the `electronAPI` stub next to `recordingStop`:

  ```ts
  cursorTrackStart: async () => ({ enabled: false }),
  cursorClockNow: async () => 0,
  cursorTrackAnchor: () => {},
  cursorTrackPause: () => {},
  cursorTrackResume: () => {},
  ```

  and next to `loadVideoEditSession`: `loadCursorTrack: async () => null,`

### Task 8 — main handlers

In `src/main/recording/recording-hub.ts`:

- [ ] Imports: add `screen` to the `electron` import; add

  ```ts
  import { serializeCursorTrack } from "@shared/cursor-track";
  import { LibraryVault } from "../library/library-vault";
  import { pickCapturedDisplay } from "./captured-display";
  import { CursorTrackRegistry } from "./cursor-tracker";
  ```

- [ ] After `const writer = new RecordingWriter({...});` add:

  ```ts
  // Cursor tracks, keyed by writer session id (see plans/video-editor-v2/02).
  const cursorTracks = new CursorTrackRegistry({
    now: () => performance.now(),
    cursorPoint: () => screen.getCursorScreenPoint(),
    every: (ms, fn) => {
      const handle = setInterval(fn, ms);
      return () => clearInterval(handle);
    },
  });
  // PR 3 replaces this with the click hook's availability (doc 03).
  const clicksAvailable = (): boolean => false;
  ```

- [ ] Replace the `recordingFinalize` handler with:

  ```ts
  ipcMain.handle(
    IPC_CHANNELS.recordingFinalize,
    async (_e, sessionId: string, meta: RecordingFinalizeMeta) => {
      let recording;
      try {
        recording = await writer.finalize(sessionId, meta);
      } catch (error) {
        cursorTracks.discard(sessionId);
        throw error;
      }
      // Best effort: a recording is never failed by its cursor track. The tracker
      // is still sampling here (finalize runs after the encoder stopped), so the
      // tail past the last frame is cut with the recording's duration.
      const track = cursorTracks.finish(sessionId, clicksAvailable(), meta.durationSeconds * 1000);
      if (track) {
        await new LibraryVault(vaultDirectory().path)
          .writeCursorTrack(recording.id, serializeCursorTrack(track))
          .catch((error) => console.error("cursor track write failed", error));
      }
      return recording;
    },
  );
  ```

- [ ] Replace the `recordingAbort` handler with:

  ```ts
  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => {
    cursorTracks.discard(sessionId);
    return writer.abort(sessionId);
  });
  ```

- [ ] After the abort handler add:

  ```ts
  ipcMain.handle(
    IPC_CHANNELS.cursorTrackStart,
    async (_e, sessionId: string, sourceId: string): Promise<{ enabled: boolean }> => {
      const display = pickCapturedDisplay(
        sourceId,
        await displayIdForSource(sourceId),
        screen.getAllDisplays(),
      );
      if (!display) return { enabled: false };
      cursorTracks.start(sessionId, display);
      return { enabled: true };
    },
  );
  ipcMain.handle(IPC_CHANNELS.cursorClockNow, () => performance.now());
  ipcMain.on(
    IPC_CHANNELS.cursorTrackAnchor,
    (_e, sessionId: string, t0MainMs: number, quality: "exact" | "estimated") =>
      cursorTracks.get(sessionId)?.setAnchor(t0MainMs, quality),
  );
  ipcMain.on(IPC_CHANNELS.cursorTrackPause, (_e, sessionId: string, atMainMs: number) =>
    cursorTracks.get(sessionId)?.pause(atMainMs),
  );
  ipcMain.on(IPC_CHANNELS.cursorTrackResume, (_e, sessionId: string, atMainMs: number) =>
    cursorTracks.get(sessionId)?.resume(atMainMs),
  );
  ```

- [ ] In the returned handle's `forceReset`, add `cursorTracks.discardAll();` as the
      first line (before the `if (!activity.active) return;` guard — a dead renderer can
      leave a tracker running even when activity already reads idle).
- [ ] `displayIdForSource` stays as is (it already maps `""` to `undefined`).

In `src/main/library/index.ts`, next to the other `ipcMain.handle` calls:

- [ ] Add:

  ```ts
  ipcMain.handle(IPC_CHANNELS.loadCursorTrack, (_event, id: string) =>
    currentVault().readCursorTrack(id),
  );
  ```

### Tasks 6 + 8 as diffs (authoritative)

The textual steps above produce exactly these diffs, generated against `main` at
`d18dbbd`, so the hunk offsets are exact. They were regenerated after this plan was
reviewed (`maxMs` tail cut, `.tmp` cleanup), so after applying them re-run
`bun run check-types && bun run test` — `check-types:node` must stay clean and the `main`
vitest project green. The four IPC files of Task 7 are small and listed verbatim above.

**Diff — `apps/kaipu-record/src/main/library/library-vault.ts`**

```diff
--- a/apps/kaipu-record/src/main/library/library-vault.ts
+++ b/apps/kaipu-record/src/main/library/library-vault.ts
@@ -1,5 +1,5 @@
 import { basename, join } from "node:path";
-import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
+import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
 import { randomUUID } from "node:crypto";
 import type { LocalRecording } from "@shared/types/library-storage";
 import { sha256FileBase64 } from "./content-hash";
@@ -73,6 +73,11 @@
     return join(this.metaDirectory(), `${id}.jpg`);
   }

+  /** Cursor event track written at record time (video-editor v2 auto-zoom). */
+  cursorTrackPath(id: string): string {
+    return join(this.metaDirectory(), `${id}.cursor.json`);
+  }
+
   async list(): Promise<LocalRecording[]> {
     await mkdir(this.directory, { recursive: true });
     // Let a readdir failure propagate (unreadable folder, unreachable network
@@ -235,6 +240,23 @@
     await writeFile(this.thumbnailPath(id), jpg);
   }

+  /** Atomic (temp + rename): a crash mid-write never leaves a truncated track. */
+  async writeCursorTrack(id: string, json: string): Promise<void> {
+    await mkdir(this.metaDirectory(), { recursive: true });
+    const target = this.cursorTrackPath(id);
+    await writeFile(`${target}.tmp`, json, "utf-8");
+    await rename(`${target}.tmp`, target);
+  }
+
+  /** The raw track JSON, or null when this recording has none. */
+  async readCursorTrack(id: string): Promise<string | null> {
+    try {
+      return await readFile(this.cursorTrackPath(id), "utf-8");
+    } catch {
+      return null;
+    }
+  }
+
   /**
    * Backfills a recording whose metadata was never derived from the file — a
    * hand-imported clip, or one whose `finalize` was interrupted before the
@@ -275,6 +297,9 @@
     await Promise.allSettled([
       rm(this.sidecarPath(id), { force: true }),
       rm(this.thumbnailPath(id), { force: true }),
+      rm(this.cursorTrackPath(id), { force: true }),
+      // An interrupted writeCursorTrack can leave the temp file behind.
+      rm(`${this.cursorTrackPath(id)}.tmp`, { force: true }),
     ]);
     await rm(await this.filePath(id), { force: true });
   }
```

**Diff — `apps/kaipu-record/src/main/library/library-vault.test.ts`**

```diff
--- a/apps/kaipu-record/src/main/library/library-vault.test.ts
+++ b/apps/kaipu-record/src/main/library/library-vault.test.ts
@@ -70,6 +70,31 @@
     expect(await readdir(directory)).toContain("clip.webm");
   });

+  it("writes, reads and removes the cursor track sidecar", async () => {
+    await writeRecording("rec");
+    expect(await vault.readCursorTrack("rec")).toBeNull();
+    await vault.writeCursorTrack("rec", '{"version":1}');
+    expect(await vault.readCursorTrack("rec")).toBe('{"version":1}');
+    expect(await readdir(join(directory, ".kaipu"))).not.toContain("rec.cursor.json.tmp");
+    await vault.remove("rec");
+    expect(await vault.readCursorTrack("rec")).toBeNull();
+  });
+
+  it("removes a cursor track temp file left behind by an interrupted write", async () => {
+    await writeRecording("rec");
+    await vault.writeCursorTrack("rec", "{}");
+    await writeFile(`${vault.cursorTrackPath("rec")}.tmp`, "half", "utf-8");
+    await vault.remove("rec");
+    expect(await readdir(join(directory, ".kaipu"))).not.toContain("rec.cursor.json.tmp");
+  });
+
+  it("keeps the cursor track when only the local copy is removed", async () => {
+    await writeRecording("rec");
+    await vault.writeCursorTrack("rec", "{}");
+    await vault.removeLocalCopy("rec");
+    expect(await vault.readCursorTrack("rec")).toBe("{}");
+  });
+
   it("removes the video and its sidecar", async () => {
     await writeRecording("clip");
     await vault.rename("clip", "X");
```

**Diff — `apps/kaipu-record/src/main/library/index.ts`**

```diff
--- a/apps/kaipu-record/src/main/library/index.ts
+++ b/apps/kaipu-record/src/main/library/index.ts
@@ -80,6 +80,9 @@
   });

   ipcMain.handle(IPC_CHANNELS.listLocalRecordings, () => currentVault().list());
+  ipcMain.handle(IPC_CHANNELS.loadCursorTrack, (_event, id: string) =>
+    currentVault().readCursorTrack(id),
+  );
   ipcMain.handle(IPC_CHANNELS.renameLocalRecording, (_event, id: string, title: string) =>
     currentVault().rename(id, title),
   );
```

**Diff — `apps/kaipu-record/src/main/recording/recording-hub.ts`**

```diff
--- a/apps/kaipu-record/src/main/recording/recording-hub.ts
+++ b/apps/kaipu-record/src/main/recording/recording-hub.ts
@@ -1,4 +1,4 @@
-import { app, BrowserWindow, desktopCapturer, ipcMain } from "electron";
+import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from "electron";
 import { IPC_CHANNELS } from "@shared/types";
 import type {
   ControlCommand,
@@ -8,6 +8,10 @@
   RecordingStartInfo,
   RecordingTick,
 } from "@shared/types/ipc";
+import { serializeCursorTrack } from "@shared/cursor-track";
+import { LibraryVault } from "../library/library-vault";
+import { pickCapturedDisplay } from "./captured-display";
+import { CursorTrackRegistry } from "./cursor-tracker";
 import { ControlBarWindow } from "./control-bar-window";
 import { CameraBubbleWindow } from "./camera-bubble-window";
 import { RecordingWriter, timestampId } from "./recording-writer";
@@ -59,6 +63,18 @@
     newId: () => timestampId(Date.now()),
   });

+  // Cursor tracks, keyed by writer session id (see plans/video-editor-v2/02).
+  const cursorTracks = new CursorTrackRegistry({
+    now: () => performance.now(),
+    cursorPoint: () => screen.getCursorScreenPoint(),
+    every: (ms, fn) => {
+      const handle = setInterval(fn, ms);
+      return () => clearInterval(handle);
+    },
+  });
+  // PR 3 replaces this with the click hook's availability (doc 03).
+  const clicksAvailable = (): boolean => false;
+
   // Single source of truth for "is a recording happening", broadcast to every
   // window so non-recorder windows (reopened Record page, Capture Panel) can
   // reflect it and refuse to start a second recording. Transitions live in the
@@ -138,9 +154,55 @@
   );
   ipcMain.handle(
     IPC_CHANNELS.recordingFinalize,
-    (_e, sessionId: string, meta: RecordingFinalizeMeta) => writer.finalize(sessionId, meta),
+    async (_e, sessionId: string, meta: RecordingFinalizeMeta) => {
+      let recording;
+      try {
+        recording = await writer.finalize(sessionId, meta);
+      } catch (error) {
+        cursorTracks.discard(sessionId);
+        throw error;
+      }
+      // Best effort: a recording is never failed by its cursor track. The tracker
+      // is still sampling here (finalize runs after the encoder stopped), so the
+      // tail past the last frame is cut with the recording's duration.
+      const track = cursorTracks.finish(sessionId, clicksAvailable(), meta.durationSeconds * 1000);
+      if (track) {
+        await new LibraryVault(vaultDirectory().path)
+          .writeCursorTrack(recording.id, serializeCursorTrack(track))
+          .catch((error) => console.error("cursor track write failed", error));
+      }
+      return recording;
+    },
+  );
+  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => {
+    cursorTracks.discard(sessionId);
+    return writer.abort(sessionId);
+  });
+  ipcMain.handle(
+    IPC_CHANNELS.cursorTrackStart,
+    async (_e, sessionId: string, sourceId: string): Promise<{ enabled: boolean }> => {
+      const display = pickCapturedDisplay(
+        sourceId,
+        await displayIdForSource(sourceId),
+        screen.getAllDisplays(),
+      );
+      if (!display) return { enabled: false };
+      cursorTracks.start(sessionId, display);
+      return { enabled: true };
+    },
+  );
+  ipcMain.handle(IPC_CHANNELS.cursorClockNow, () => performance.now());
+  ipcMain.on(
+    IPC_CHANNELS.cursorTrackAnchor,
+    (_e, sessionId: string, t0MainMs: number, quality: "exact" | "estimated") =>
+      cursorTracks.get(sessionId)?.setAnchor(t0MainMs, quality),
+  );
+  ipcMain.on(IPC_CHANNELS.cursorTrackPause, (_e, sessionId: string, atMainMs: number) =>
+    cursorTracks.get(sessionId)?.pause(atMainMs),
+  );
+  ipcMain.on(IPC_CHANNELS.cursorTrackResume, (_e, sessionId: string, atMainMs: number) =>
+    cursorTracks.get(sessionId)?.resume(atMainMs),
   );
-  ipcMain.handle(IPC_CHANNELS.recordingAbort, (_e, sessionId: string) => writer.abort(sessionId));

   // ── Window orchestration ────────────────────────────────────────────
   ipcMain.on(IPC_CHANNELS.recordingStart, (_e, info: RecordingStartInfo) => {
@@ -197,6 +259,7 @@
       if (settings.isCameraEnabled) cameraBubble.show();
     },
     forceReset: () => {
+      cursorTracks.discardAll();
       if (!activity.active) return;
       applyStopWindowState();
     },
```

### Task 9 — verify

- [ ] Checks (audit rule 4).
- [ ] Manual: record a **screen** 10 s → `<vault>/.kaipu/<id>.cursor.json` exists and
      parses; record a **window** → no file; delete the screen recording from the library
      → the file is gone; export an edit of it → the export has **no** `.cursor.json`.
- [ ] Manual, two displays: record display 2 while moving across both → `x` values
      outside 0–1 while on display 1, inside while on display 2.
- [ ] Manual, Windows at 150 % scaling (if available): pointer in the bottom-right
      corner reads ≈ (1, 1). If not, stop and report (mixed-DPI mapping).
- [ ] **Manual, cost of the 125 Hz poller — do not skip.** `screen.getCursorScreenPoint()`
      is a synchronous call on the same main thread that serialises the recording's MP4
      chunk writes, 125 times a second, and nothing in this plan has measured it. Record
      **5 minutes at the highest quality preset** with the pointer moving, once on `main`
      and once on the branch, and compare: - main-process CPU (Activity Monitor / Task Manager, sampled over the take); - dropped frames — the exported file's frame count against `duration × fps`.

      If either regresses, set `CURSOR_SAMPLE_INTERVAL_MS` to `16` (60 Hz, still twice
      the capture frame rate) and re-measure; record both numbers in the PR description.
      Also note the sidecar's size: it should be a few MB at most (§ Decisions).

- [ ] Manual, tail cut: stop a recording and immediately fling the pointer to a corner.
      The sidecar's last `t` must be ≤ `durationSeconds * 1000`, and the corner position
      must **not** be in `x`/`y`.

## Acceptance criteria

- Screen recordings produce a valid sidecar; every other recording and every export
  behaves exactly as before.
- No code path lets a cursor-track failure fail or corrupt a recording, and none delays
  one: the renderer's handshake runs inside the same `Promise.all` as `startEngine` and
  is capped at 500 ms ([01](/plans/video-editor-v2/01-clock-and-pause-mapping/)).
- No sample and no click in a persisted track has `t` beyond the recording's duration:
  the 0.6–2 s the tracker keeps running between the last frame and `recordingFinalize`
  is cut by `maxMs`.
- Deleting a recording leaves neither `<id>.cursor.json` nor `<id>.cursor.json.tmp`.
- The 125 Hz poller's cost on the main thread is measured against `main` (Task 9), not
  assumed, and the measurement is in the PR description.

## Non-goals

Window-source tracks; crash-safe streaming of the track to disk; uploading tracks to
Cloud; importing tracks for third-party videos.

## Reopen if

Users ask for auto-zoom on window recordings (needs per-frame window bounds — a native
module), or recordings longer than ~2 h become common (raise the cap or stream to disk).
