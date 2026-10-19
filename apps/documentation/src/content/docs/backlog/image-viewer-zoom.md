---
title: "Zoom and pan in the image viewer"
description: "Design for zooming and panning a saved screenshot in the library detail viewer: fit by default, cursor-anchored wheel and pinch zoom, drag to pan, double-click to toggle 100 %, reusing the view-zoom the screenshot editor already ships."
---

# Zoom and pan in the image viewer

> **Status: 🔵 Proposed** (2026-10-07). Design doc for the `photoZoom` row on the
> [public roadmap](./public-roadmap-page). Nothing is built. Not to be confused with
> [editor zoom](./editor-zoom), which is the screenshot editor's view-zoom (shipped and
> closed), nor with the video editor's [automatic zoom](./video-editor-zoom-blur-cover),
> which is an export effect. Parents: [screenshots](./screenshots) ·
> [library detail player](/features/library-detail-player/).

## Problem

Captures are stored at native Retina resolution (2× on most Macs). The library detail
page shows them through `ScreenshotViewer`, a single `<img>` scaled to fit the pane. A
full-screen capture of a 14-inch display lands at roughly a third of its real size, so
small text, error messages and UI details are exactly the things that become unreadable.
The only workaround is Reveal in Finder and opening the file in Preview, which is the
"you have to leave the app" moment the library exists to prevent.

## Decision

Reuse the editor's view-zoom model instead of designing a second one. The editor already
settled the questions that matter: zoom is a CSS `transform` on the content, it never
touches pixels, and `⌘/Ctrl + wheel` (which is also how a trackpad pinch arrives) is the
gesture. The viewer adds **pan**, which the editor does not have because its canvas scrolls.

The viewer is read-only, so none of the export questions from the editor-zoom analysis
apply here: nothing is ever written from this screen.

## What exists today

| Piece                                              | State                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ScreenshotViewer` (`features/library/components`) | `<img>` with `object-fit`, an "Image unavailable" fallback. No interaction                                                                                               |
| Screenshot editor page (`pages/screenshot-editor`) | `zoom` state, `clampZoom` (0.5 to 3, step 0.25), a non-passive wheel listener that maps `deltaY` to an exponential factor, and a `−/%/+` float at the foot of the canvas |
| Library detail page                                | Branches by `kind`; the screenshot branch already has a toolbar (Copy / Reveal / Delete) where a zoom readout can sit                                                    |

## Design

### Behaviour

| Interaction                       | Result                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Open an item                      | **Fit**: the whole image visible, centred. Zoom resets per item, like the editor remounts       |
| `⌘/Ctrl + wheel`, trackpad pinch  | Zoom **anchored at the cursor**: the pixel under the pointer stays under the pointer            |
| `⌘ +` / `⌘ −` / `⌘ 0`             | Step in / out (0.25) / back to fit                                                              |
| Double-click                      | Toggle between fit and **100 %** (one image pixel per device pixel), anchored at the click      |
| Drag while zoomed past fit        | Pan. Cursor shows grab / grabbing. The image cannot be dragged fully out of view                |
| Plain wheel while zoomed past fit | Pan (vertical and horizontal), the same way Preview and Figma treat it                          |
| `Esc`                             | Back to fit                                                                                     |
| `−/%/+` control                   | The editor's float, in the same place, same styling; `%` is relative to native size, not to fit |

Range: from fit (which may be below 100 %) up to **400 %**. Beyond 4× every image pixel is
a visible square and nothing is gained. The floor is fit, not 50 %: zooming out past the
whole image has no use in a viewer.

Reduced-motion users get the same behaviour with no transition on the transform; nobody
gets an animated zoom, because the animation would fight the wheel gesture.

### Implementation

1. **Extract** the editor's zoom primitives (`clampZoom`, the wheel-to-factor mapping, the
   `−/%/+` float) into `features/screenshots/view-zoom.ts` and a small component, and have
   the editor import them. Pin the pure functions with tests so the two surfaces cannot
   drift: a wheel delta produces the same factor in both.
2. **Add pan and anchoring** as viewer-only state: `{ zoom, tx, ty }`, applied as one
   `transform: translate() scale()` with `transform-origin: 0 0`. Cursor anchoring is the
   standard "keep the point under the cursor fixed" algebra on `tx, ty`; a pure function
   with a test.
3. **Clamp the translation** so at least the image edge touches the viewport edge; a pure
   function with a test.
4. `ScreenshotViewer` grows a `zoomable` prop with the default on; the editor's beautify
   preview, which also renders an image, stays untouched.

No new dependency. The whole thing is one transform and four pure functions.

## Non-goals

- **Zoom in the video player.** The video editor's zoom is a different feature (an effect
  burned at export). A view zoom on playback is a separate, unrequested idea.
- **A minimap, rotation, or a loupe.** None of them were asked for.
- **Persisting the zoom level** across items or sessions. Fit is the right first frame for
  every image; the editor made the same call.
- **Cloud-only items.** The viewer already shows "Image unavailable" when there is no local
  file; zoom has nothing to act on there until download-on-demand exists.

## Open questions

- Should the `%` readout count from native size or from fit? Default: **native**, because
  "100 %" meaning "one image pixel per screen pixel" is what every image viewer means, and
  the editor already reads that way.
- Does the detail page's keyboard shortcut map (`⌘ +` and friends) collide with any global
  shortcut? To check against the [shortcuts](./shortcuts) registry before building.

## Validation

- [ ] A 2× capture opens at fit; `⌘ +` three times reaches 175 %; pinch zoom lands on the
      pixel under the cursor.
- [ ] Double-click toggles fit ↔ 100 % and back, anchored where clicked.
- [ ] Drag and plain-wheel pan stop at the image edge; `Esc` returns to fit.
- [ ] The editor still zooms exactly as before (its tests keep passing after the extraction).
- [ ] With "Reduce motion" on, nothing animates; with it off, nothing animates either.

## Reopens when

Screenshots get a re-editable [scene doc](./screenshot-scene-doc): at that point the viewer
and the editor may become one surface, and the zoom lives in one place by construction.
