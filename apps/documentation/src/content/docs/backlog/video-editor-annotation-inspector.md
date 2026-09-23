---
title: "Video editor v2 — annotation options in the inspector"
description: "Findings from validating v2 PR 8 (blur and cover): annotations still open the v1 floating popover while zooms and privacy regions use the inspector column. Proposes moving annotation options into the inspector, plus the preview-only caveats to keep in mind until the export pass lands."
---

# Video editor v2 — annotation options in the inspector

> **Status: 🔵 Proposed** (2026-09-22). Notes from validating
> [v2 PR 8 — blur and cover](https://github.com/csdev19/kaipu-record-monorepo/pull/139)
> on hardware. The redactions work and the owner's verdict on the editor was that the new
> design "fixes many things I did not like before". This doc records the one
> inconsistency that stands out now that the inspector column exists, and the caveats of
> testing redactions before the export pass. Parent:
> [video editor v2](./video-editor-zoom-blur-cover) · siblings:
> [camera box UX](./video-editor-camera-box-ux), [edit-state indicators](./edit-state-indicators).

## 1. Two models for "edit the selected thing"

### Observed

Select a **zoom** or a **privacy region**: its controls appear in the inspector column on
the right (Level / Smoothness / Follow–Lock; Intensity / Style; Fill / Label). Select a
**text, box or arrow annotation**: a floating popover (COLOR, SIZE, delete) opens over
the preview, and the inspector column stays on Detection because an annotation
selection has nothing to show there.

Two different places for the same job, and the floating one covers the video the user
is looking at.

### Why it is like this

The popover is the v1 editor's `OverlayOptions`, kept on purpose: plan 08 scoped the
inspector column to zooms and left annotations alone so PR 6 did not have to rewrite
them in the same change (audit W12 noted the mismatch). It is rendered in
`video-editor-page.tsx` inside `.optionsFloat`, "pinned to the stage so it doesn't shift
with the video's own size" — a choice that made sense when there was no side column.

`OverlayOptions` already exposes normalized controls (`resolveControls` → color + either
stroke or size) driving two cases: editing the selected overlay, or setting the
next-draw defaults of the active tool. That abstraction is exactly what an inspector
panel needs; only the container changes.

### Proposal

Move annotation options into the inspector column, as a third kind of panel next to the
zoom and redaction inspectors. The owner's call: _the area used to customise the zoom is
the right place for this._

| Selection / tool state                                           | Inspector shows                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nothing selected, Select tool                                    | Detection (as today)                                                                                                                                         |
| Nothing selected, an annotation tool active (box / arrow / text) | **Annotation defaults** — color + stroke or size for the next draw, same controls as the popover today                                                       |
| Annotation selected                                              | **Annotation inspector** — header `Text` / `Box` / `Arrow` + range, the same controls, "Remove annotation" at the bottom (same layout as the zoom inspector) |
| Zoom / region selected                                           | as today                                                                                                                                                     |

Details worth deciding in the follow-up:

- **Keep the popover for drawing?** No. One place, always. The inspector is visible at
  all times, so there is no discoverability loss.
- **Range editing.** Annotations are timeline-anchored with a start/end (their pill on
  the annotation lane); the inspector should show the range like the zoom inspector
  does, read-only in the first pass (edge drags stay on the lane).
- **Selection model.** `useEditorSelection` already has a single selection across zooms,
  redactions and overlays, so the inspector switch is one more branch, not a new model.
- **Screenshot editor parity.** The screenshot editor keeps its own popover
  (`annotation-options.tsx`); it has no inspector column, so it is not in scope. The
  shared `resolveControls` pattern stays shared.

## 2. What the screenshot confirmed working (PR 8)

Recorded so the validation is not lost:

- The three toolbar groups (Select / Box / Arrow / Text · Zoom / Blur / Cover) with the
  contextual hint.
- Privacy lane with a `BLUR` block; `1 private region` in the transport counts.
- A `3.1× 🔒` zoom block: the Follow / Lock control from PR 7 producing a fixed segment.
- Detection panel at sensitivity 47 → `3 zooms · 40% of clip`, with the
  "Turn on Accessibility access so clicks also create zooms" hint explaining why every
  zoom came from a pause (the recording predates granting Accessibility).
- The layout holds at ~1050 px wide; the inspector column scrolls (the `SELECTION`
  section is below the fold).

## 3. Caveats while validating redactions before PR 9

Worth keeping in front of whoever tests this branch stack:

- **On PR 8 the blur is preview-only.** The region lives in original-frame coordinates
  and is drawn _under_ the camera transform. The check the test suite cannot do: select
  a zoom over a region, deselect, press play — the blur must stay glued to the content
  while the camera moves (`backdrop-filter` under a CSS transform on a real GPU).
- **Nothing is in the file until PR 9** ([#140](https://github.com/csdev19/kaipu-record-monorepo/pull/140)).
  That PR's manual checks are the ones not to skip, on the **exported** file with a
  frame-accurate player: a blur flush against the frame's top and left edge (nothing
  readable in the outer ~3σ band), and a blur drawn over a cover (the covered content
  must not come back). Both leaks were found in plan review and are invisible in the
  preview by construction.
- Until [edit-state indicators](./edit-state-indicators) lands, the vault `.mp4` shows no
  sign that it is the unedited original.

## Scope for the follow-up

- **In:** annotation inspector + annotation defaults panel in the inspector column;
  remove `.optionsFloat` and the popover from the video editor page; i18n keys for the
  headers and the remove button; tests for the four inspector states in the table.
- **Out:** range editing from the inspector (lane handles stay the way to retime);
  the screenshot editor's popover; any change to how annotations are drawn or stored.

## Reopen if

The screenshot editor ever gains a side column — then the same panel should serve both
editors and the shared `resolveControls` becomes the seam.
