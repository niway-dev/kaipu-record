---
title: "Video editor v2 — 12 capture resolution and cursor sprite"
description: "Why 'zoom up to 2.5× is free' does not hold in this app (recordings are capped at the preset height and exported at that size), what v2 does about it, and why the drawn-cursor 'plan B' is deferred to v2.1 with a research spike instead of shipping a double cursor. Fixes the capture half of audit W15."
sidebar:
  order: 12
---

# 12 — Capture resolution and cursor sprite

> **Status: 🟡 In progress** (2026-09-22). Decision document + one small PR 10 item.
> Resolves overview decision 3. See the [audit](/plans/video-editor-v2/00-audit/). The
> PR 10 item (soft-zoom hint) is implemented on `feat/video-editor-v2-polish` — not
> merged, not validated in production. The cursor-sprite decision (§ 2) is a v2 non-goal,
> not something to implement; see the [backlog PR table](/backlog/video-editor-zoom-blur-cover/).

## 1. Zoom quality

### Facts

- The pipeline spec says "capture at native resolution or 2×, export at 1080p — zoom up to
  ~2.5× is then free". That is not this app:
  - `recorder-engine.ts` downscales the capture to the quality preset's **height cap**
    (`fitToCap`). The default preset is **Equilibrado: 1080p · 30 fps**. A 2560×1600
    MacBook panel records as 1728×1080.
  - The export is written **at the source size** (doc 11). There is no smaller output.
- So a 2× zoom crops 864×540 source pixels and scales them to 1728×1080: every source pixel
  becomes 2×2. UI text gets visibly soft beyond ~1.5× on a 1080p recording.

### Decision (v2)

**Accept and inform.** No capture change, no new export option in v2:

- Detected zooms default to 2.0× (clicks) and 1.6× (dwells) — see doc 04.
- The Zoom inspector shows a hint when the zoomed window is shorter than 720 source
  pixels: `sourceHeight / scale < 720`. At 1080p that is above 1.5×; at 1440p above 2×;
  at 2160p above 3×.

Rejected for v2:

| Option                                                    | Why not now                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Record at native resolution whenever auto-zoom is on      | Changes file size and encoder load for every user to benefit some exports; the quality preset is a user choice. |
| Export resolution option (e.g. 1080p output of a 4K take) | The right long-term fix (gives real crop headroom), but it is its own feature: backlog "Formatos de export".    |
| Upscaling filters (Lanczos, super-resolution)             | Cost and complexity far beyond v2.                                                                              |

### PR 10 task — soft-zoom hint

- [ ] Add to `zoom/zoom-model.ts`:

  ```ts
  /** Below this many source pixels of window height, zoomed UI text looks soft. */
  export const SHARP_WINDOW_MIN_HEIGHT = 720;

  /** True when a zoom of `scale` on a `sourceHeight` px recording upsamples visibly. */
  export function isSoftZoom(sourceHeight: number, scale: number): boolean {
    return sourceHeight > 0 && sourceHeight / scale < SHARP_WINDOW_MIN_HEIGHT;
  }
  ```

- [ ] Test (`zoom/zoom-model.test.ts`):

  ```ts
  import { describe, expect, it } from "vitest";
  import { isSoftZoom } from "./zoom-model";

  describe("isSoftZoom", () => {
    it("flags windows shorter than 720 source px", () => {
      expect(isSoftZoom(1080, 1.5)).toBe(false);
      expect(isSoftZoom(1080, 1.6)).toBe(true);
      expect(isSoftZoom(2160, 3)).toBe(false);
      expect(isSoftZoom(0, 4)).toBe(false); // unknown size: no hint
    });
  });
  ```

- [ ] `ZoomInspector` gets a `sourceHeight: number` prop; under the Level slider render
      `{isSoftZoom(sourceHeight, segment.scale) && <p className={styles.hint}>{t("zoomSoftHint")}</p>}`.
      The page passes `playback.videoRef.current?.videoHeight ?? 0`.
- [ ] i18n `videoEditor.zoomSoftHint`: es "A este nivel el texto puede verse suave. Graba
      en 1440p o 4K para zooms más nítidos." / en "At this level text may look soft.
      Record at 1440p or 4K for sharper zooms."

## 2. The cursor

### What the overview proposed

"Spike A: try to exclude the OS cursor; expected: not possible → plan B: draw a larger
custom cursor over the original at export." Decision 3 then asks the owner to accept "a
faint double cursor at 1×".

### Why plan B is not a small task

- **The recorded cursor is in the pixels** and is magnified by every zoom, blurry at 2×.
  A sprite must be at least as large as the magnified original to hide it — a 2× zoom
  needs a cursor twice the natural size just to cover the old one.
- **Shape is unknown.** The track stores positions, not cursor types. Over text the OS
  shows an I-beam, over links a hand, while resizing an arrow pair. An arrow sprite on top
  of an I-beam is not "faint": it is two different cursors, most of the time on text-heavy
  recordings. Electron has no API for another app's current cursor shape.
- **Hotspot and timing.** The sprite must sit on the recorded cursor's hotspot within a
  couple of pixels on every frame. Doc 01 accepts up to one frame of error per pause; at
  fast pointer speeds that is tens of pixels — an obvious ghost trail.
- **No cursor-free capture** exists on the path this app records through (`getUserMedia`
  with `chromeMediaSource: "desktop"`); whether any Electron/Chromium path can exclude it
  is unverified.

### Decision (v2)

**No drawn cursor in v2.** The preview and export show the recorded OS cursor, zoomed with
the frame. The camera box omits the spec's "white pointer at the center". The overview's
decision 3 is therefore moot for v2.

### Spike A — research for v2.1 (optional, not blocking any v2 PR)

Time-box one day, on a throwaway branch; write the results here.

1. macOS and Windows: capture with `navigator.mediaDevices.getDisplayMedia({ video: { cursor: "never" } })`
   served by `session.setDisplayMediaRequestHandler` (choosing the same screen source);
   record 5 s moving the pointer. Is the cursor in the pixels?
2. Same with the current `getUserMedia` + `chromeMediaSource: "desktop"` path and any
   constraint Chromium documents for cursor capture on that Electron version.
3. If (1) or (2) excludes the cursor on **both** OSes: list what else changes (system-audio
   path, source picker, permissions) — that is the v2.1 cost.

### Reopen if

Spike A finds cursor-free capture on both platforms. Then v2.1: record cursor-free when
auto-zoom is on, store a coarse cursor type per sample if the OS exposes it (else arrow
only), draw the sprite after the crop at a fixed on-screen size, and tighten doc 01's
clock error to < 1 frame across pauses.
