---
title: "28 · Video thumbnails by range"
description: "Closes VID-A3: opening the editor reads the whole recording into a Blob to decode 24 timeline thumbnails (export and GIF do the same), while probe-source already reads by Range."
---

# Video thumbnails by range — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening the editor reads only the container index and 24 keyframe neighbourhoods (estimate: 15–50 MB of a 500 MB file instead of 500 MB), and re-opening the same recording decodes nothing.

**Architecture:** Phase 1 (this plan): one helper `openRecordingInput(url)` (mediabunny `UrlSource`, Range) used by `use-source-thumbnails.ts` and `probe-source.ts`; the hook caches the 24 JPEG Blobs per recording in a module LRU of 8 (object URLs are created at publish time and revoked on unmount) and disposes its `Input`; `media-protocol.ts` adds `access-control-expose-headers: content-range, content-length, accept-ranges` — a **real prerequisite**: `kaipu-media://` is cross-origin and CORS hides those headers, which mediabunny reads to learn the file size; without them a moov-at-end MP4 may degrade to sequential reads. Phase 2 (separate PR, gated on a manual check that a Worker can `fetch` `kaipu-media://`): GIF worker, then export worker, take a URL instead of a Blob.

**Tech Stack:** mediabunny `UrlSource`/`CanvasSink`, vitest (mock `mediabunny` and the helper at the boundary, as `generate-thumbnail.test.ts` does).

**Spec:** [Audit report](/audits/2026-10-15/report/) → VID-A3 in [video lens A](/audits/2026-10-15/findings/video-a/). Closes: **VID-A3** (phase 1; phase 2 tracked as a follow-up in the PR).

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- Keep the `SourceThumbnail { sourceTime, url }` shape (the lanes consume it). `probeSource`'s signature does not change.
- Verify in `node_modules/mediabunny` that a second `Input.dispose()` is a no-op (the hook disposes in `finally` and in cleanup); if it throws, null the reference after the first dispose.
- The savings are an **estimate**, not a measurement: the recorder's keyframe interval was not found; a long GOP pushes the read toward ~100 MB. Measure in DevTools Network (sum of 206 bodies) and report in the PR.
- `UrlSource` retries failed requests with unbounded backoff; a file deleted mid-open can hang the await — the cleanup `dispose()` is what releases it on unmount.
- Plan 15 (orphan heal) switches `generate-thumbnail`/`heal-orphan-metadata` to `UrlSource` too; it may reuse `openRecordingInput`. Land this plan first so the header is in place.
- Commit messages in English, conventional-commit style.

## Review Focus

1. The hook never calls `fetch`; it opens the URL through `openRecordingInput` and asks for 24 timestamps starting at `0.5/24 × duration` — Task 2 test.
2. A second mount of the same recording decodes nothing (cache hit) — Task 2 test.
3. Object URLs are revoked on unmount (revoke count == create count) — Task 2 test.
4. The LRU evicts past 8 recordings — Task 2 test.
5. Responses carry `access-control-expose-headers` and the editor's Network tab shows 206s, no file-sized 200 — manual step (no protocol test exists).

---

### Task 1: Helper, probe-source, exposed headers

**Files:**

- Create: `renderer/src/lib/open-recording-input.ts`
- Modify: `renderer/src/features/video-editor/export/probe-source.ts:1`, `:28-32`
- Modify: `main/media-protocol.ts:62-69`

- [ ] **Step 1: Implement**

```ts
// renderer/src/lib/open-recording-input.ts
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";

/**
 * Opens a vault recording for demuxing/decoding WITHOUT reading it into memory.
 * `UrlSource` issues `Range` requests against the Range-aware `kaipu-media://` protocol
 * (`main/media-protocol.ts`), so only the container metadata and the packets a decoder
 * asks for are read. The caller owns the returned Input and must `dispose()` it.
 */
export function openRecordingInput(url: string): Input {
  return new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
}
```

`probe-source.ts`: `import { openRecordingInput } from "@renderer/lib/open-recording-input";` and `const input = openRecordingInput(`kaipu-media://recording/${sourceId}`);` (drop the now-unused mediabunny imports).

`media-protocol.ts` headers, after `"access-control-allow-origin": "*",`:

```ts
    // Cross-origin readers (mediabunny's UrlSource) learn the file size from these. CORS hides
    // every response header outside the safelist unless it is listed here; without
    // Content-Range the size stays unknown and a moov-at-end MP4 cannot be read by range.
    "access-control-expose-headers": "content-range, content-length, accept-ranges",
```

- [ ] **Step 2: Type check and the export suite** — `bun run check-types && node_modules/.bin/vitest run src/renderer/src/features/video-editor/export src/main/media-range.test.ts` → green.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/lib/open-recording-input.ts src/renderer/src/features/video-editor/export/probe-source.ts src/main/media-protocol.ts
git commit -m "feat(desktop): openRecordingInput (Range reads) and exposed range headers on kaipu-media"
```

### Task 2: Thumbnails by Range with a per-recording LRU

**Files:**

- Modify: `renderer/src/features/video-editor/use-source-thumbnails.ts` (whole file)
- Create: `renderer/src/features/video-editor/use-source-thumbnails.test.ts`

**Interfaces:**

- Produces: `__resetSourceThumbnailCacheForTests()`.

- [ ] **Step 1: Write the failing tests** (mock `mediabunny` for `CanvasSink` and `@renderer/lib/open-recording-input` returning a fake Input `{ getPrimaryVideoTrack, dispose: vi.fn() }`; stub `URL.createObjectURL`/`revokeObjectURL`; `__resetSourceThumbnailCacheForTests()` in `beforeEach`; `renderHook` + `waitFor`)

```ts
const fakeCanvas = () => ({ toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([1])], { type: "image/jpeg" })) });
const frames = (n: number) => asyncIterableOf(Array.from({ length: n }, (_, i) => ({ canvas: fakeCanvas(), timestamp: i })));

it("decodes 24 thumbnails through openRecordingInput and never fetches the whole file", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const sinkCtor = vi.mocked(CanvasSink).mockImplementation(function () { return { canvasesAtTimestamps: vi.fn(() => frames(24)) }; } as never);
  const { result } = renderHook(() => useSourceThumbnails("kaipu-media://recording/r1", 48));
  await waitFor(() => expect(result.current).toHaveLength(24));
  expect(fetch).not.toHaveBeenCalled();
  expect(openRecordingInput).toHaveBeenCalledWith("kaipu-media://recording/r1");
  const timestamps = sinkCtor.mock.results[0]!.value.canvasesAtTimestamps.mock.calls[0][0] as number[];
  expect(timestamps).toHaveLength(24);
  expect(timestamps[0]).toBeCloseTo(1); // 0.5/24 * 48
});

it("disposes the input when decoding finishes and when there is no video track", async () => {
  const { result } = renderHook(() => useSourceThumbnails("kaipu-media://recording/r1", 48));
  await waitFor(() => expect(result.current).toHaveLength(24));
  expect(lastInput().dispose).toHaveBeenCalled();
  stubInput(null);
  renderHook(() => useSourceThumbnails("kaipu-media://recording/r2", 48));
  await waitFor(() => expect(lastInput().dispose).toHaveBeenCalled());
});

it("serves a second mount of the same recording from the cache", async () => {
  const first = renderHook(() => useSourceThumbnails("kaipu-media://recording/r1", 48));
  await waitFor(() => expect(first.result.current).toHaveLength(24));
  first.unmount();
  const second = renderHook(() => useSourceThumbnails("kaipu-media://recording/r1", 48));
  await waitFor(() => expect(second.result.current).toHaveLength(24));
  expect(openRecordingInput).toHaveBeenCalledTimes(1);
});

it("revokes the object URLs on unmount", async () => {
  const { result, unmount } = renderHook(() => useSourceThumbnails("kaipu-media://recording/r1", 48));
  await waitFor(() => expect(result.current).toHaveLength(24));
  unmount();
  expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledTimes(vi.mocked(URL.createObjectURL).mock.calls.length);
});

it("a different duration is a different cache entry", async () => {
  const a = renderHook(() => useSourceThumbnails("kaipu-media://recording/r1", 48));
  await waitFor(() => expect(a.result.current).toHaveLength(24));
  const b = renderHook(() => useSourceThumbnails("kaipu-media://recording/r1", 49));
  await waitFor(() => expect(b.result.current).toHaveLength(24));
  expect(openRecordingInput).toHaveBeenCalledTimes(2);
});

it("evicts the least recently used recording past 8", async () => {
  for (let i = 0; i < 9; i++) {
    const h = renderHook(() => useSourceThumbnails(`kaipu-media://recording/r${i}`, 48));
    await waitFor(() => expect(h.result.current).toHaveLength(24));
    h.unmount();
  }
  const again = renderHook(() => useSourceThumbnails("kaipu-media://recording/r0", 48));
  await waitFor(() => expect(again.result.current).toHaveLength(24));
  expect(openRecordingInput).toHaveBeenCalledTimes(10);
});
```

- [ ] **Step 2: Run to verify they fail** — `fetch` is called; no cache.

- [ ] **Step 3: Implement** (whole file)

```ts
import { useEffect, useState } from "react";
import { CanvasSink, type Input } from "mediabunny";
import { openRecordingInput } from "@renderer/lib/open-recording-input";

export interface SourceThumbnail {
  sourceTime: number;
  url: string;
}

const THUMB_WIDTH = 160;
const THUMB_COUNT = 24;
/** Recordings whose thumbnails stay decoded (~250 KB each), so re-opening the editor is free. */
const CACHE_LIMIT = 8;

interface CachedThumbnail {
  sourceTime: number;
  blob: Blob;
}

// Insertion order = recency (a Map iterates oldest first); `cacheGet` re-inserts to refresh.
const cache = new Map<string, CachedThumbnail[]>();

function cacheGet(key: string): CachedThumbnail[] | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: CachedThumbnail[]): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test seam: forget every cached recording. */
export function __resetSourceThumbnailCacheForTests(): void {
  cache.clear();
}

/**
 * Decodes a fixed set of evenly spaced frames from the SOURCE recording, once.
 * Cuts never invalidate this cache — blocks pick the nearest thumbnails by source
 * time — so we never re-decode while editing. Frames are decoded through Range
 * requests (not a full-file read) and kept per recording in a small LRU.
 */
export function useSourceThumbnails(mediaUrl: string, durationSeconds: number): SourceThumbnail[] {
  const [thumbnails, setThumbnails] = useState<SourceThumbnail[]>([]);

  useEffect(() => {
    let cancelled = false;
    let input: Input | null = null;
    const urls: string[] = [];
    const key = `${mediaUrl}|${durationSeconds}`;

    const publish = (frames: CachedThumbnail[]): void => {
      setThumbnails(
        frames.map((f) => {
          const url = URL.createObjectURL(f.blob);
          urls.push(url);
          return { sourceTime: f.sourceTime, url };
        }),
      );
    };

    const cleanup = (): void => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
      // Also aborts in-flight Range requests if the effect is torn down mid-decode.
      input?.dispose();
    };

    const cached = cacheGet(key);
    if (cached) {
      publish(cached);
      return cleanup;
    }

    void (async () => {
      try {
        input = openRecordingInput(mediaUrl);
        const track = await input.getPrimaryVideoTrack();
        if (!track || cancelled) return;
        const sink = new CanvasSink(track, { width: THUMB_WIDTH });
        const timestamps = Array.from({ length: THUMB_COUNT }, (_, i) => ((i + 0.5) / THUMB_COUNT) * durationSeconds);
        const frames: CachedThumbnail[] = [];
        for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
          if (cancelled) return; // cancelled mid-stream: stop decoding further frames
          if (!wrapped) continue;
          const canvas = wrapped.canvas as HTMLCanvasElement;
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.6));
          if (!blob) continue;
          if (cancelled) return;
          frames.push({ sourceTime: wrapped.timestamp, blob });
        }
        if (cancelled) return;
        cacheSet(key, frames);
        publish(frames);
      } catch {
        // Thumbnails are cosmetic; a decode failure must never break the editor.
      } finally {
        // Frees the UrlSource's cache and connections as soon as the work is done.
        input?.dispose();
      }
    })();

    return cleanup;
  }, [mediaUrl, durationSeconds]);

  return thumbnails;
}
```

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/features/video-editor/use-source-thumbnails.test.ts src/renderer/src/features/video-editor && bun run check-types` → PASS.

```bash
git add src/renderer/src/features/video-editor/use-source-thumbnails.ts src/renderer/src/features/video-editor/use-source-thumbnails.test.ts
git commit -m "perf(desktop): timeline thumbnails decode by Range and are cached per recording"
```

### Task 3: Measure and ship

- [ ] **Measure** in the dev app: open a long recording with DevTools Network filtered on `kaipu-media` → 206 responses only, no single 200 of file size; responses carry `access-control-expose-headers`; sum the 206 bodies and compare with the file size. Close and reopen the same recording → no new thumbnail range requests. `chrome://blob-internals` holds no file-sized blob. Time from editor mount to the lanes filling, before/after.
- [ ] Open a PR titled `perf(desktop): timeline thumbnails read by Range, cached per recording (audit VID-A3)` linking this plan and the finding; include the measured bytes and the phase-2 follow-up (GIF + export workers; gate: confirm a Worker can `fetch` `kaipu-media://` with `Range: bytes=0-9` → 206). End with **How to test it yourself** = the measurement steps.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
