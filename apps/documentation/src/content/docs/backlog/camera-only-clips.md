---
title: "Camera-only clips — moments where the camera fills the frame"
description: "Proposal: insert moments of your own camera video in the edited recording (a fullscreen camera intro, a talking-head aside), using the take's webcam file. Not designed; it reopens ADR 0038's condition for a scene where the camera is the subject."
---

# Camera-only clips

> **Status: 🔵 Proposed** (2026-10-31). Owner decision 7 of the
> [editor timeline v2 design](/specs/2026-10-31-editor-timeline-v2-design/): backlog only, no
> design decisions yet. Reopens the condition of
> [ADR 0038](/architecture/decisions/0038-webcam-is-a-viewport-layer-composed-after-the-zoom-crop/)
> "the owner wants a scene where the webcam is the subject", which the
> [webcam track design](/specs/2026-10-30-webcam-track-design/) left out of scope. No Linear
> ticket (free issue limit). Effort: Medium to High, after timeline v2 phases A and D.

## The problem

With the webcam recorded as its own file, the face is a small layer over the screen. Creators
also want moments where the camera **is** the video: an intro looking at the viewer, a short
aside between two screen demos, an outro. Screen Studio, Cap (`SceneMode`) and Tella offer
camera-only or fullscreen-camera layouts for exactly this.

## Two shapes it could take

- **A camera section with a fullscreen layout.** A section (ADR 0039) whose layout covers the
  output, with the screen hidden under it. Cheap: the transition, easing and source anchoring
  already exist. But a section only changes position and size, and "fullscreen" also means
  square edges, no shadow and a different crop. It also stretches the "section" idea.
- **A clip on a media lane whose source is the take's own webcam file.** A media item (ADR 0040)
  with a "Full frame" placement and the webcam file as its asset, anchored to the same source
  time as the screen. That reuses media lanes, but the webcam file is not a Library item and
  is source-anchored, so it breaks two of the media model's rules.

A design would choose between them (or a third: a scene mode per stretch, Cap's model), and
decide:

- what happens to the screen and its zoom underneath (paused, hidden, still running);
- framing, which a fullscreen camera needs more than a bubble does (the framing per section
  that ADR 0039 left out);
- the transition into and out of fullscreen (a slide from the bubble's position is the natural
  one);
- whether a fullscreen moment can also be inserted footage, i.e. camera video that is not under
  any screen time.

## Dependencies

- [Webcam track](/backlog/webcam-track/) shipped (the webcam file exists).
- [Editor timeline v2](/specs/2026-10-31-editor-timeline-v2-design/) phase A (sections and
  transitions), and phase D if the media-lane shape is chosen.
