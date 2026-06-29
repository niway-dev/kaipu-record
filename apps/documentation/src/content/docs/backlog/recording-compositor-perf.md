---
title: Recording compositor performance — the canvas cost (approach A vs B)
description: Living indicator to watch as the app grows. The per-frame canvas the recorder uses (for watermark, and to re-frame non-16:9 screens) has a real cost — track it, and only split the non-watermark path to the lighter "approach A" if a benchmark shows it hurts.
---

# Recording compositor performance — the canvas cost (approach A vs B)

> **Status: 🔵 Watch (living indicator).** Nothing to do now. This records a deliberate
> performance/simplicity trade-off so a future you (or the benchmark) can revisit it with data
> instead of re-deriving it.

## What this is about

The recorder can route every captured frame through a `<canvas>` (the
`recording-compositor.ts`). That canvas does two jobs:

1. **Burn the watermark** — irreducible: drawing a logo on every frame _requires_ a canvas.
2. **Re-frame / downscale** the native capture to the correct aspect ratio (the
   [aspect-ratio fix](./aspect-ratio-distortion)) — this is **approach B**.

Because the watermark already needs the canvas, approach B reused it for the downscale too. The
cost: on **any non-16:9 screen (every MacBook)** the canvas now runs **even without a watermark**.
On a true 16:9 source with no watermark, the engine still skips the canvas and encodes the raw
track (zero added cost).

## The cost, in plain terms

- **Native capture** moves ~2.9× more pixels per frame than the old 1920×1080 box
  (3024×1964 ≈ 5.9 MP vs 2.1 MP) — mostly memory bandwidth.
- **One extra full-frame resample per frame** (30–60×/s) that didn't exist for non-watermark
  recordings.
- The **encode is slightly cheaper** (output is 1662×1080, smaller than the old 1920×1080).

On **Apple Silicon** this is a modest bump (the GPU resamples a 3K frame in well under a
millisecond). On **Intel Macs** (still a shipped target) it's heavier — no equivalent acceleration.

## The indicator to watch

Revisit this when any of these show up — **especially on Intel**:

- Dropped frames during capture (stutter in the output).
- Noticeably higher CPU / fan / battery drain while recording.
- Higher-resolution presets (1440p/4K) or higher fps (60) making the above worse.

The honest measurement is the **[Benchmark propio](./index)** backlog item (CPU/RAM/frames
dropped). **Measure before optimizing** — don't add complexity on a hunch.

## The lighter alternative — approach A (only if it hurts)

Instead of capturing native and downscaling ourselves, ask the OS for a capture box that **already
has the correct aspect ratio** (e.g. 1662×1080). The OS scales once, in hardware — **no canvas**.
Result: lighter than approach B _and_ lighter than the original buggy code, same correctness.

What it needs:

- The source's real pixel size **before** capture. For full-screen sources, the main process can
  resolve it from the source's `display_id` → `screen.getAllDisplays()` (`size × scaleFactor`).
- A **fallback for window capture** (no `display_id`): keep approach B (native + canvas) there.

So it's **not "two competing implementations"** — `fitToCap` (the size math) stays shared; only
_who applies the resize_ changes (the OS vs. our canvas). The canvas/compositor keeps existing for
the watermark regardless.

## Decision rule

1. **Now:** one path (approach B). Correct, simple, fine on Apple Silicon.
2. **If the benchmark hurts** (Intel, dropped frames): add approach A for the **non-watermark**
   path; keep B for watermark + window-capture fallback.
3. Keep `fitToCap` as the single source of truth for output dimensions either way.

## Not the same as sharpness

Output **sharpness** is a _separate_ lever from A/B — it's driven by the output **resolution**
(the height cap) and **bitrate**, not by which path applies the resize. Both A and B land on the
same pixel dimensions. To make recordings sharper, raise the resolution preset (or add a near-native
mode) and ensure the bitrate keeps up — see [aspect-ratio-distortion](./aspect-ratio-distortion).
