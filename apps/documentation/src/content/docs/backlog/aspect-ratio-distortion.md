---
title: Recording aspect-ratio distortion (non-16:9 screens)
description: Recordings on MacBook (and any non-16:9 display) come out horizontally stretched and soft because the capture box is hardcoded to 16:9. Fix by deriving capture/encode dimensions from the live source aspect ratio instead of a fixed table.
---

# Recording aspect-ratio distortion (non-16:9 screens)

> **Status: 🔵 Proposed — PRIORITY.** Root cause confirmed with evidence (below). Deferred only
> because a consolidation pass is in flight; pick this up right after. Effort: Medium.

## Symptom

Recordings made on the MacBook look **horizontally stretched** (~+15%) and slightly **soft / low
quality**. Circles render as wide ellipses; UI looks "squeezed". Reproduced in production and in
the local web playback — it's baked into the file, not a player artifact.

## Root cause (confirmed, not guessed)

The capture is constrained to a **hardcoded 16:9 box**.

- **`recorder-engine.ts:77-83`** acquires the screen via Electron's legacy desktop path:

  ```ts
  mandatory: {
    chromeMediaSource: "desktop",
    chromeMediaSourceId: options.sourceId,
    maxWidth: width,   // 1920
    maxHeight: height, // 1080
    maxFrameRate: frameRate,
  }
  ```

- `width`/`height` come from **`recording-quality.ts:40` `RESOLUTION_DIMENSIONS`**, which is
  hardcoded to 16:9 (`1080: { width: 1920, height: 1080 }`, etc.).

When the requested box AR (1.778) differs from the source AR, Chromium's legacy desktop capturer
scales the screen to **exactly** the box **without preserving aspect ratio**.

### Evidence

- Display (this machine, 14" MacBook Pro): **3024 × 1964 → AR 1.540**.
- `ffprobe` on three real output files: all **1920 × 1080 → AR 1.778**, square pixels, no
  SAR/DAR correction tag.
- Horizontal stretch = 1.778 / 1.540 = **×1.155** (~+15.5% wider than reality).
- Proof it isn't AR-preserving: a uniform downscale of 3024×1964 capped at 1080 height would be
  **1664 × 1080**, not 1920 × 1080. The output is exactly the box → it stretched.

### Why it only bites on Mac

**No MacBook panel is 16:9.** The 14"/16" Pro is 1.540; other Macs are ~16:10 (1.6). On an
external 1920×1080 monitor the box matches the source, so nothing distorts — which is why it
slipped through.

### The watermark is innocent

The distortion happens at **capture**, upstream of the watermark. `watermark-compositor.ts:36-38`
reads `screenTrack.getSettings()` (already 1920×1080 stretched) and creates the canvas at those
same dimensions — it copies the distorted frame, it doesn't cause it. Without a watermark,
`encodeTrack = screenTrack` directly, also 1920×1080 stretched. **Proof:** all sampled files are
1920×1080 regardless of watermark state; if removing the watermark fixed it, non-watermark
recordings would be 1664×1080. They aren't. Removing the watermark changes nothing.

### Secondary: softness

Two compounding effects beyond the stretch:

1. **Downscale** — a 3024-px-wide Retina panel is squeezed into 1920 px (~0.63×), softening text.
2. **Bitrate** — measured average on sampled files is ~0.8–1.9 Mbps vs the 8 Mbps target for
   `balanced`. This may be legitimate VBR on mostly-static screen content, **but verify** the
   target is actually honored by the VideoToolbox/realtime path before assuming it's fine.

## The fix — Approach B (measure + reframe, source-agnostic)

Stop assuming 16:9. Treat the resolution preset (720/1080/1440/4K) as a **height cap**, and derive
width from the **live source aspect ratio**:

```
targetH = min(presetHeight, sourceH)              // never upscale
targetW = roundToEven(targetH * sourceW / sourceH) // width follows the REAL AR
```

For this 14" at 1080p → **1664 × 1080** (no distortion). On a 16:9 monitor → 1920 × 1080. On a
21:9 ultrawide → 2560 × 1080. On a portrait display → portrait. Nothing hardcoded; everything
flows from `sourceW/sourceH` measured at capture time, so it works for **every** screen, external
monitor, or window.

**Why B over a "match the capture box to source AR" approach (A):** B reuses machinery that
already exists. `watermark-compositor.ts` already creates a canvas at the track's dimensions and
draws each frame — generalize it to **always** run (with or without watermark) and reframe to the
computed `targetW × targetH` preserving AR. No main↔renderer plumbing, no per-source special cases
(works for windows, not just screens). Cost is one `drawImage` per frame, which the watermark path
already pays today.

## Implementation plan

1. **`recording-quality.ts` — kill the 16:9 assumption.**
   - Reinterpret `RESOLUTION_DIMENSIONS` as a **height cap only** (keep the heights 720/1080/1440/
     2160; the widths are no longer the source of truth for the frame).
   - Add a helper, e.g. `fitToCap(sourceW, sourceH, capHeight) → { width, height }`, that applies
     the formula above with even-number rounding and a never-upscale guard. This is the single
     source of truth for output dimensions.
   - Update `qualityToEngine` / `EngineQuality` so the engine receives the cap (height + a
     `maxWidth` ceiling for very wide sources) rather than a fixed 1920×1080.

2. **`recorder-engine.ts` — measure, then size.**
   - Acquire the screen without a distorting box (request native, or a generous AR-safe cap), read
     `screenTrack.getSettings().width/height` to learn the real `sourceW × sourceH`.
   - Compute `target = fitToCap(sourceW, sourceH, capHeight)`.
   - Route **every** recording through the (generalized) compositor at `target`, encoding that
     track — not the raw screen track.

3. **`watermark-compositor.ts` — generalize to a reframe compositor.**
   - Accept a `target { width, height }` and size the canvas to it (instead of to the raw track
     settings).
   - Draw the source frame into `target` preserving AR (with the watermark stamp when enabled,
     plain `drawImage` when not). Letterbox only if a target AR is ever forced (normally
     `target` AR == source AR, so no bars).
   - Rename/clarify so it reads as "the recording compositor" rather than "watermark only".

4. **Sharpness pass (same change, since scope = AR + sharpness).**
   - Decide the capture resolution: capturing nearer native (then downscaling preserving AR)
     yields crisper text than capturing pre-shrunk. Cap by the preset to control file size.
   - Verify the encoder honors the bitrate target (`onEncoderConfig` already logs it — add an
     actual-vs-target check), and confirm `prefer-hardware` VideoToolbox isn't silently
     downgrading quality.

5. **Verify with ffprobe + eyeball.**
   - After the fix, a 14" 1080p recording must be **1664 × 1080** (AR 1.540), no SAR hack, and a
     circle on screen must stay a circle. Re-probe across screen / window / external-monitor /
     ultrawide sources.

## Open questions (resolve when picked up)

- **Cap semantics:** is the preset a cap on **height**, or on the **longer edge** (so a portrait
  source caps width)? Height-cap is simplest; confirm it's right for vertical capture.
- **Window sources:** a captured window has its own AR — the measure-the-track approach handles it
  for free, but confirm `getSettings()` reports real window pixels under the legacy path.
- **Even-dimension / H.264 constraints:** round to even (or mod-2/mod-16 as the encoder needs) to
  avoid encoder rejects on odd widths like 1663.
- **Per-frame canvas cost:** acceptable (watermark already does it), but consider `OffscreenCanvas`
  / `requestVideoFrameCallback` if CPU shows up in the benchmark.
- **Native-capture future:** once ScreenCaptureKit / Windows.Graphics.Capture lands (see roadmap),
  the capture side changes but the `fitToCap` height-cap model still applies.

## Why deferred

Only because a consolidation pass is currently in flight. The diagnosis is done and the plan is
concrete — this is the next thing to ship after consolidation, ahead of the lower-priority pipeline
ideas.
