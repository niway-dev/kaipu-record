---
title: "Screenshot redaction — hide sensitive info"
description: "A redaction tool for the screenshot editor: cover or scribble over sensitive data (tokens, emails, faces) before sharing. Approaches, the security requirement, and how it interacts with re-editable scene docs."
---

# Screenshot redaction (hide sensitive info)

> **Status: 🔵 Proposed.** Requested: be able to **write/scribble over** parts of a
> screenshot to black out sensitive information before copying or saving (e.g. a
> token, an email, a face). A common, practical need when sharing captures.

## Approaches

All three reuse the existing annotation pipeline (normalized coords, baked into the
flattened export):

1. **Solid fill box** — a filled opaque rectangle (the "black bar"). Simplest,
   unmistakable, reliable. Reuses the box tool with `fill: solid` instead of stroke.
2. **Freehand opaque marker** — drag to scribble an opaque thick stroke (matches
   "garabatear/tachar"). New freehand-path annotation; opaque, fixed dark colour
   (or a couple of presets).
3. **Pixelate / blur region** — drag a region; the underlying pixels are pixelated
   or blurred. Fancier and more "designed", but needs reading the base pixels and
   running a filter on the canvas — more work than 1 & 2.

**Recommendation:** ship **solid box + freehand opaque marker** first (cheap, reuse
the annotation model). Add **pixelate/blur** later as an enhancement.

## ⚠️ The security requirement (non-negotiable)

Redaction must **destroy** the information in the shared artifact, not just cover it
visually in a movable layer.

- Today this is satisfied **by accident**: we export a **flattened** PNG, so a black
  box is permanently painted over the pixels — the secret is gone from the output.
- It breaks the moment we adopt **non-destructive [scene docs](./screenshot-scene-doc)**:
  if we also store the original **base** image for re-editing, the sensitive pixels
  still exist under the box in that base file. See that doc's security section.

**Rule:** a screenshot containing a redaction is **flatten-only** (no re-editable
base stored), *or* the redaction destructively bakes/pixelates the base pixels too.
Prefer flatten-only for v1 — simple and safe.

Also: pixelate/blur with a small radius can sometimes be **reversed**; use a strong
radius (or a solid fill) for anything that must truly disappear.

## Sketch of the work

- New tool(s) in the annotation tool group: a **Redact box** (solid fill) and a
  **Marker** (freehand opaque). Both are annotation kinds with opaque paint.
- Freehand needs a new `path` annotation kind (list of normalized points) + its
  rough/smooth render in the live layer and the compositor.
- Wire the flatten-only rule into Save once scene docs exist.
- Effort: **Low–Medium** for box + marker; **Medium** to add pixelate/blur.
