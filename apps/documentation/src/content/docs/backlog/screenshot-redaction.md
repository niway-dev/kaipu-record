---
title: "Screenshot redaction — hide sensitive info"
description: "A redaction tool for the screenshot editor: cover or scribble over sensitive data (tokens, emails, faces) before sharing. Approaches, the security requirement, and how it interacts with re-editable scene docs."
---

# Screenshot redaction (hide sensitive info)

> **Status: 🔵 Proposed.** Requested: hide sensitive information (a token, an email, a
> face) before copying or saving. The agreed direction is a **blur box** — drag a
> rectangle and the pixels under it are blurred/pixelated — exactly like **WhatsApp's
> image editor** (practical, not professional). You hide the secret while keeping the
> surrounding context legible.

## Why a blur box (not a black box)

WhatsApp's editor is the reference: a single **blur rectangle** that you drag and resize
over the UI. It reads as "this part is hidden" while the rest of the screenshot stays
readable — better than a solid black bar that erases context. It's the v1.

## Approaches (in order of preference)

All reuse the existing box-tool pointer math and bake into the flattened export.

1. **Blur / pixelate box** ✅ _(primary — the WhatsApp pattern)_ — drag a rectangle; the
   base pixels inside are blurred or pixelated. **Pixelate (mosaic) is the safer default**
   for true secrecy — a light gaussian blur can sometimes be reversed.
2. **Solid fill box** — a filled opaque "black bar". Trivial fallback; reuses the box
   tool with a solid fill. Keep as an option for "fully erase".
3. **Freehand opaque marker** — see [freehand pen](./screenshot-freehand); scratches
   visually but is **not** secure redaction (edges leak).

## How to build the blur box (our editor)

A new `blur` annotation kind (a rect + amount), rendered as a clipped, blurred copy of
the base image at the rect — the same in the live layer and the export, so it's WYSIWYG:

```ts
interface BlurAnnotation {
  id: string; kind: "blur";
  x: number; y: number; w: number; h: number; // normalized
  amount: number; // blur strength / mosaic block size
}
```

- **Gaussian blur** is the easy path: an SVG `<filter><feGaussianBlur/></filter>` applied
  to a clipped `<image href={base}>` positioned at the rect. `feGaussianBlur` rasterizes
  correctly when the compositor turns its SVG into a PNG, so live and export match with
  one code path.
- **Pixelate (mosaic)** is more secure but harder in pure SVG. Do it at the **canvas
  raster** step the compositor already runs: draw the region downscaled then back up with
  `imageSmoothingEnabled = false` (nearest-neighbour) → blocky mosaic. Live preview can
  approximate with CSS, export does the real mosaic on the canvas.
- Interaction is the box tool: drag a rect, resize handles, move. The options panel shows
  a single **strength** slider instead of colour/stroke.

## ⚠️ The security requirement (non-negotiable)

Redaction must **destroy** the information in the shared artifact, not just cover it in a
movable layer.

- Today this holds **by construction**: we export a **flattened** PNG, so the blur/mosaic
  is permanently painted into the output — the original pixels are gone from what you
  share.
- It breaks if we adopt **non-destructive [scene docs](./screenshot-scene-doc)** that
  store the original **base** image: the sensitive pixels would still live in the base
  under the blur. **Rule:** a screenshot containing a redaction is **flatten-only** (no
  re-editable base), _or_ the redaction bakes the blur/mosaic into the stored base too.
  Prefer flatten-only for v1 — simple and safe.
- Prefer **pixelate with a large block** (or a strong blur) for anything that must truly
  disappear — weak blur can be partially reversed.

## Effort

**Medium.** Gaussian-blur box via SVG filter is the cheapest start; pixelate adds a
canvas raster step. Solid box is a near-free fallback.
