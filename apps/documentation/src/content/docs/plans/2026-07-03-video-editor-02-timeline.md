---
title: "Video editor 02 — timeline UI: ruler, thumbnails, playhead, scrubbing"
description: "Second implementation plan for the video editor: the visual timeline strip — time ruler, mediabunny-generated filmstrip thumbnails, a 60fps playhead via direct DOM positioning, and click/drag scrubbing."
---

# Video editor 02 — timeline UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor's bottom band becomes a real timeline: a time ruler, the main track
rendered as blocks with filmstrip thumbnails, a playhead that tracks playback at 60 fps,
and click/drag scrubbing that seeks the preview.

**Architecture:** Pure DOM/CSS (no canvas rendering of the timeline itself — matches the
app). Thumbnails are decoded **once per source recording**
with mediabunny's `CanvasSink.canvasesAtTimestamps` (no hidden-`<video>` seek hacks) and
cached; blocks pick nearest thumbnails by source time, so plan 03's cuts get correct
strips for free. The playhead subscribes to `playback.subscribeTime` and positions itself
by direct style mutation — the documented pattern for not re-rendering the strip at 60 fps.

**Tech Stack:** mediabunny `Input`/`BlobSource`/`CanvasSink` (already a dependency),
React, CSS Modules.

**Design spec:** `apps/documentation/src/content/docs/specs/2026-07-03-video-editor-design.md`

## Global Constraints

- Same as plan 01: English code/comments, neutral-Spanish copy, no enums, kebab-case,
  `bunx oxfmt --check .` before every commit, vitest for pure logic.
- Prerequisite: plan 01 merged. Interfaces available:
  `LayoutEntry`, `toLayout`, `layoutDuration`, `entryAt` (from
  `features/video-editor/timeline.ts`) and `PreviewPlayback` with
  `seek(t)`, `subscribeTime(listener)`, `duration`, `timelineTime` (from
  `features/video-editor/use-preview-playback.ts`).

---

### Task 1: Thumbnail cache (mediabunny)

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/use-source-thumbnails.ts`

**Interfaces:**

- Consumes: mediabunny `Input`, `BlobSource`, `ALL_FORMATS`, `CanvasSink` (read
  `apps/kaipu-record/node_modules/mediabunny/dist/mediabunny.d.ts` for exact signatures;
  the recording feature's `recorder-engine.ts` shows the import style).
- Produces:
  - `interface SourceThumbnail { sourceTime: number; url: string }` (JPEG object-URL, 160px wide)
  - `useSourceThumbnails(mediaUrl: string, durationSeconds: number): SourceThumbnail[]`
    — resolves once, empty array while loading or on failure (blocks render flat-colored
    without thumbnails; never crash the editor over thumbnails).

- [ ] **Step 1: Write the hook**

```ts
// use-source-thumbnails.ts
import { useEffect, useState } from "react";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

export interface SourceThumbnail {
  sourceTime: number;
  url: string;
}

const THUMB_WIDTH = 160;
const THUMB_COUNT = 24;

/**
 * Decodes a fixed set of evenly spaced frames from the SOURCE recording, once.
 * Cuts never invalidate this cache — blocks pick the nearest thumbnails by source
 * time — so we never re-decode while editing.
 */
export function useSourceThumbnails(
  mediaUrl: string,
  durationSeconds: number,
): SourceThumbnail[] {
  const [thumbnails, setThumbnails] = useState<SourceThumbnail[]>([]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    void (async () => {
      try {
        // kaipu-media:// supports fetch (supportFetchAPI) — stream the file to a Blob.
        const blob = await (await fetch(mediaUrl)).blob();
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || cancelled) return;
        const sink = new CanvasSink(track, { width: THUMB_WIDTH });
        const timestamps = Array.from(
          { length: THUMB_COUNT },
          (_, i) => ((i + 0.5) / THUMB_COUNT) * durationSeconds,
        );
        const out: SourceThumbnail[] = [];
        for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
          if (cancelled || !wrapped) continue;
          const canvas = wrapped.canvas as HTMLCanvasElement;
          const url = await new Promise<string | null>((resolve) =>
            canvas.toBlob(
              (b) => resolve(b ? URL.createObjectURL(b) : null),
              "image/jpeg",
              0.6,
            ),
          );
          if (url) {
            urls.push(url);
            out.push({ sourceTime: wrapped.timestamp, url });
          }
        }
        if (!cancelled) setThumbnails(out);
      } catch {
        // Thumbnails are cosmetic; a decode failure must never break the editor.
      }
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [mediaUrl, durationSeconds]);

  return thumbnails;
}
```

Verify against the actual `.d.ts`: `CanvasSink#canvasesAtTimestamps` yields
`WrappedCanvas | null` objects with `.canvas` and `.timestamp` — adjust property names
to whatever the types say if they differ; the types are the contract, not this snippet.

- [ ] **Step 2: Typecheck**

Run: `cd apps/kaipu-record && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
bunx oxfmt . && git add -A apps/kaipu-record && git commit -m "feat(video-editor): source thumbnail cache via mediabunny"
```

---

### Task 2: Timeline strip — ruler, blocks, playhead, scrubbing

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.tsx`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.module.css`
- Create: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-geometry.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-geometry.test.ts`
- Modify: `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`

**Interfaces:**

- Consumes: `LayoutEntry`, `layoutDuration` (plan 01), `PreviewPlayback` (plan 01),
  `SourceThumbnail` (Task 1).
- Produces:
  - Pure helpers in `timeline-geometry.ts` (unit-tested):
    - `timeToFraction(t: number, duration: number): number` (clamped 0..1)
    - `fractionToTime(f: number, duration: number): number`
    - `rulerTicks(duration: number): { time: number; label: string }[]` — 5–10 major
      ticks at a "nice" interval (1/5/10/30/60s chosen so ticks ≥ 60px apart at typical widths)
    - `thumbnailsForRange(thumbnails: SourceThumbnail[], sourceStart: number, sourceEnd: number, count: number): SourceThumbnail[]`
      — nearest-by-source-time picks, `count` derived from block width
  - `<TimelineStrip layout={LayoutEntry[]} playback={PreviewPlayback} thumbnails={SourceThumbnail[]} selectedItemId={string | null} onSelectItem={(id: string | null) => void} />`
    — `selectedItemId`/`onSelectItem` are wired to real selection in plan 03; the page
    passes `null`/no-op for now.

- [ ] **Step 1: Write failing tests for the geometry helpers**

```ts
// timeline-geometry.test.ts
import { describe, expect, it } from "vitest";
import {
  fractionToTime,
  rulerTicks,
  thumbnailsForRange,
  timeToFraction,
} from "./timeline-geometry";

describe("time/fraction mapping", () => {
  it("maps and clamps", () => {
    expect(timeToFraction(5, 10)).toBe(0.5);
    expect(timeToFraction(-1, 10)).toBe(0);
    expect(timeToFraction(15, 10)).toBe(1);
    expect(timeToFraction(0, 0)).toBe(0); // zero-duration guard
    expect(fractionToTime(0.25, 60)).toBe(15);
  });
});

describe("rulerTicks", () => {
  it("picks a nice interval and includes 0", () => {
    const ticks = rulerTicks(90);
    expect(ticks[0]).toEqual({ time: 0, label: "0:00" });
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    expect(ticks.length).toBeLessThanOrEqual(11);
    expect(ticks.at(-1)!.time).toBeLessThanOrEqual(90);
  });
});

describe("thumbnailsForRange", () => {
  const thumbs = Array.from({ length: 10 }, (_, i) => ({
    sourceTime: i * 10 + 5, // 5, 15, ... 95
    url: `u${i}`,
  }));

  it("picks nearest thumbnails evenly across the source range", () => {
    const picked = thumbnailsForRange(thumbs, 20, 60, 4);
    expect(picked).toHaveLength(4);
    expect(picked[0].sourceTime).toBeGreaterThanOrEqual(15);
    expect(picked.at(-1)!.sourceTime).toBeLessThanOrEqual(65);
  });

  it("returns [] when there are no thumbnails", () => {
    expect(thumbnailsForRange([], 0, 10, 4)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/components/timeline-geometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the geometry helpers**

```ts
// timeline-geometry.ts
import type { SourceThumbnail } from "../use-source-thumbnails";

export function timeToFraction(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(1, t / duration));
}

export function fractionToTime(f: number, duration: number): number {
  return Math.max(0, Math.min(1, f)) * duration;
}

function formatTick(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const TICK_STEPS = [1, 5, 10, 30, 60, 120, 300] as const;

export function rulerTicks(duration: number): { time: number; label: string }[] {
  const step = TICK_STEPS.find((s) => duration / s <= 10) ?? 600;
  const ticks: { time: number; label: string }[] = [];
  for (let t = 0; t <= duration; t += step) {
    ticks.push({ time: t, label: formatTick(t) });
  }
  return ticks;
}

export function thumbnailsForRange(
  thumbnails: SourceThumbnail[],
  sourceStart: number,
  sourceEnd: number,
  count: number,
): SourceThumbnail[] {
  if (thumbnails.length === 0 || count <= 0) return [];
  const picked: SourceThumbnail[] = [];
  for (let i = 0; i < count; i++) {
    const target = sourceStart + ((i + 0.5) / count) * (sourceEnd - sourceStart);
    let nearest = thumbnails[0];
    for (const thumb of thumbnails) {
      if (Math.abs(thumb.sourceTime - target) < Math.abs(nearest.sourceTime - target)) {
        nearest = thumb;
      }
    }
    picked.push(nearest);
  }
  return picked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/kaipu-record && bunx vitest run src/renderer/src/features/video-editor/components/timeline-geometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the strip component**

```tsx
// timeline-strip.tsx
import { useCallback, useEffect, useRef } from "react";
import type { PreviewPlayback } from "../use-preview-playback";
import type { LayoutEntry } from "../timeline";
import { layoutDuration } from "../timeline";
import type { SourceThumbnail } from "../use-source-thumbnails";
import {
  fractionToTime,
  rulerTicks,
  thumbnailsForRange,
  timeToFraction,
} from "./timeline-geometry";
import styles from "./timeline-strip.module.css";

const THUMBS_PER_BLOCK_PX = 72; // one thumbnail tile roughly every 72px of block width

export function TimelineStrip({
  layout,
  playback,
  thumbnails,
  selectedItemId,
  onSelectItem,
}: {
  layout: LayoutEntry[];
  playback: PreviewPlayback;
  thumbnails: SourceThumbnail[];
  selectedItemId: string | null;
  onSelectItem: (id: string | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const duration = layoutDuration(layout);

  // Playhead follows playback at rAF frequency via direct style mutation —
  // re-rendering the strip 60×/s would drop frames during playback.
  useEffect(() => {
    return playback.subscribeTime((t) => {
      const el = playheadRef.current;
      if (el) el.style.left = `${timeToFraction(t, duration) * 100}%`;
    });
  }, [playback, duration]);

  // Also position on low-frequency updates (paused seeks don't run the rAF loop).
  useEffect(() => {
    const el = playheadRef.current;
    if (el) el.style.left = `${timeToFraction(playback.timelineTime, duration) * 100}%`;
  }, [playback.timelineTime, duration]);

  const timeFromPointer = useCallback(
    (event: { clientX: number }): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return fractionToTime((event.clientX - rect.left) / rect.width, duration);
    },
    [duration],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      playback.pause();
      playback.seek(timeFromPointer(event));
    },
    [playback, timeFromPointer],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      playback.seek(timeFromPointer(event));
    },
    [playback, timeFromPointer],
  );

  return (
    <div className={styles.strip}>
      <div className={styles.ruler}>
        {rulerTicks(duration).map((tick) => (
          <span
            key={tick.time}
            className={styles.tick}
            style={{ left: `${timeToFraction(tick.time, duration) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        className={styles.track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        {layout.map((entry) => (
          <TrackBlock
            key={entry.itemId}
            entry={entry}
            duration={duration}
            thumbnails={thumbnails}
            selected={entry.itemId === selectedItemId}
            onSelect={() => onSelectItem(entry.itemId)}
          />
        ))}
        <div ref={playheadRef} className={styles.playhead} />
      </div>
    </div>
  );
}

function TrackBlock({
  entry,
  duration,
  thumbnails,
  selected,
  onSelect,
}: {
  entry: LayoutEntry;
  duration: number;
  thumbnails: SourceThumbnail[];
  selected: boolean;
  onSelect: () => void;
}) {
  const blockRef = useRef<HTMLButtonElement | null>(null);
  const left = timeToFraction(entry.timelineStart, duration) * 100;
  const width = timeToFraction(entry.timelineEnd - entry.timelineStart, duration) * 100;
  const approxWidthPx = (width / 100) * (blockRef.current?.parentElement?.clientWidth ?? 800);
  const tiles =
    entry.kind === "clip"
      ? thumbnailsForRange(
          thumbnails,
          entry.sourceStart,
          entry.sourceEnd,
          Math.max(1, Math.round(approxWidthPx / THUMBS_PER_BLOCK_PX)),
        )
      : [];

  return (
    <button
      ref={blockRef}
      type="button"
      className={selected ? `${styles.block} ${styles.blockSelected}` : styles.block}
      style={{ left: `${left}%`, width: `${width}%` }}
      onClick={(event) => {
        event.stopPropagation(); // a block click selects; it must not also scrub
        onSelect();
      }}
    >
      {tiles.map((tile, i) => (
        <img key={i} src={tile.url} alt="" className={styles.tile} draggable={false} />
      ))}
    </button>
  );
}
```

CSS module essentials:

```css
.strip { display: flex; flex-direction: column; gap: 4px; padding: 8px 16px 12px; }
.ruler { position: relative; height: 16px; font-size: 10px; color: var(--muted, #888); }
.tick { position: absolute; transform: translateX(-50%); user-select: none; }
.track { position: relative; height: 64px; border-radius: 8px; background: rgba(255 255 255 / 0.06); cursor: pointer; }
.block { position: absolute; top: 0; height: 100%; display: flex; overflow: hidden; border-radius: 6px; border: 1px solid transparent; padding: 0; background: rgba(255 255 255 / 0.12); }
.blockSelected { border-color: var(--accent, #7c9cff); }
.tile { height: 100%; flex: 1 1 0; object-fit: cover; min-width: 0; pointer-events: none; }
.playhead { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--accent, #7c9cff); pointer-events: none; }
```

Pull the actual `--accent`/`--muted` values from the screenshot editor's CSS module so
both editors look like one product.

- [ ] **Step 6: Wire into the page**

In `VideoEditor`:

```tsx
const thumbnails = useSourceThumbnails(mediaUrl, source.durationSeconds);
const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
// footer:
<TimelineStrip
  layout={layout}
  playback={playback}
  thumbnails={thumbnails}
  selectedItemId={selectedItemId}
  onSelectItem={setSelectedItemId}
/>
```

- [ ] **Step 7: Manual verification**

Run: `cd apps/kaipu-record && bun run dev`

- Timeline shows the ruler and one full-width block filled with real thumbnails.
- Playhead moves smoothly during playback (no visible stepping).
- Click/drag anywhere on the track scrubs the video (pauses first); the time display
  matches the playhead.
- A recording with no decodable thumbnails (if any) still shows a flat block.

- [ ] **Step 8: Full suite, format, commit**

```bash
cd apps/kaipu-record && bunx vitest run && bun run typecheck && cd ../.. && bunx oxfmt . \
  && git add -A apps/kaipu-record && git commit -m "feat(video-editor): timeline strip with ruler, thumbnails, playhead, scrubbing"
```

---

## Done when

- Geometry tests green; suite + typecheck green; oxfmt clean.
- Manual: smooth playhead, accurate scrubbing, thumbnails render.
- PR: `feat(video-editor): timeline UI (plan 02)` → **stop for owner review**.
