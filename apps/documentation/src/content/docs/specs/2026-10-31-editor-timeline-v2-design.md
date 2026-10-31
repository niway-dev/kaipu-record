---
title: Editor timeline v2 — tracks on demand, camera sections with transitions, media overlays
description: Design for the video editor's second timeline. Typed tracks appear when they have something on them and hide their edits when removed; the Activity lane becomes marks inside Zooms. The camera layer gains sections that move and resize it with a per-section Slide or Cut transition and CSS-style easing, and fades when it hides or shows. A new media layer puts Library clips, files and images over the recording on stackable lanes, each video with its own audio lane, mixed at export.
---

# Editor timeline v2 — design

**Status: 🔵 Proposed · 2026-10-31.** Owner decisions taken on 2026-10-31 in the design
conversation over the "Kaipu Timeline v2" Claude Design mock; nothing is implemented. No Linear
ticket (the workspace is at its free issue limit). ADRs:
[0039](/architecture/decisions/0039-camera-sections-with-eased-transitions/) (camera sections
and transitions, new; extends 0033) and
[0040](/architecture/decisions/0040-typed-tracks-on-demand-and-stackable-media-lanes/) (typed
tracks on demand, media lanes, per-source audio, new). Builds on the
[webcam track design](/specs/2026-10-30-webcam-track-design/) and its
[ADR 0033](/architecture/decisions/0033-webcam-is-a-viewport-layer-composed-after-the-zoom-crop/),
and reuses the import and drop path of the editor compose design
([PR #279](https://github.com/niway-dev/kaipu-record/pull/279), open, with its ADR 0018).
Backlog: [background music](/backlog/background-music/) and
[camera-only clips](/backlog/camera-only-clips/).

Vocabulary, fixed by this design because the code already uses the obvious word:

- **Annotation** — a box, arrow or text drawn on the recording. In code it is `VideoOverlay`
  (`scene.overlays`, `overlay-lane.tsx`); the UI already says "Annotations". Not renamed here.
- **Media item / media lane** — a video or image placed over the recording, on a lane of its
  own. The UI calls it **Overlay**; the code never does (`features/video-editor/media/`,
  `MediaLane`, `MediaItem`), so `overlay` keeps one meaning in code.
- **Camera** — the UI word for the webcam layer (the lane label changes from "WEBCAM" to
  "CAMERA"; Spanish already says "CÁMARA"). The code keeps `webcam`, as the webcam spec decided;
  `camera-path.ts` is still the zoom.
- **Section** — what the UI calls an `override` webcam segment. A **hidden** segment stays a
  hidden segment.

## Summary (one minute)

The editor's timeline today shows every lane all the time (Annotations, Clips, Activity, Zooms,
Webcam, Privacy, Audio), and the camera can only be hidden or overridden in jumps. Timeline v2
does three things. **Tracks on demand**: Clips and Audio are always there, the Camera lane is
there whenever the take recorded a camera, and Annotations, Zooms, Privacy and Overlay lanes
appear when something is put on them or through "+ Add track"; removing one hides its edits and
leaves them out of the export until it is added back. The Activity lane becomes thin marks
inside Zooms, and a fresh recording lists its zooms as suggestions. **Camera sections**: a
section moves and resizes the camera from a point in the video, with a transition that lives
inside the section at its start: Slide (moves and resizes together) or Cut, a duration per
section and a CSS-style easing (presets plus a custom cubic-bezier). Hiding and showing fades
over 200 ms. One pure function gives the camera's state at any source time to the preview, the
MP4 and the GIF. **Media overlays**: a Library clip, a file from Finder or an image goes on an
Overlay lane, placed with the camera's 3×3 grid and size or by dragging on the preview, drawn
after the zoom crop. Lanes stack (the upper covers the lower) and there can be as many as the
user wants. Each overlay video brings its own audio lane that mutes on its own, and the export
mixes them. A generic "anything on any track" timeline was rejected: zooms, privacy and
annotations are effects on the recording, not clips. Background music and camera-only clips go
to the backlog.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                     | ADR                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | **Build in five phases**: (A) camera sections and transitions, (B) tracks on demand, (C) image overlays, (D) video overlays with per-source audio and mixing, (E) background music, backlog only. Each phase ships on its own.                                                                                                                                                                                                                                                                                                            | A only touches the webcam code that already exists; B is UI over the existing scene; C brings the media model without the decoding cost; D is the expensive part and depends on the compose spec's import and range-reading spike.                      | —                                 |
| 2   | **A section changes the camera's position and size only.** Shape, mirror, shadow, "shrink during zoom" and framing stay global. A section is an `override` segment whose `layout` holds `position` and `size`; the parser drops any other override field.                                                                                                                                                                                                                                                                                 | Owner decision 1. A bubble that changes shape mid-video reads as a glitch; framing per section is "later". The webcam stack is unreleased, so no saved session in the wild loses anything.                                                              | 0039 (new)                        |
| 3   | **The transition belongs to the section and lives inside it, at its start**: optional `transition: { kind: "slide" \| "cut", ms, easing }`; absent means Cut. New sections default to Slide, 400 ms, ease-in-out. The effective duration is `min(ms, 50 % of the section)`. It starts from the layout in force just before the section (so A→B→C chains), and a section that ends into a gap returns to the global layout with its own transition, played at the start of the gap.                                                        | The owner's mock and decision 2. Inside-the-section keeps every transition owned by exactly one segment, so cuts, splits and deletes never orphan one; stateless "from" keeps `t → layout` a pure function the preview, MP4 and GIF can share.          | 0039                              |
| 4   | **Easing is CSS's model**: presets `ease-in-out` (default), `linear`, `ease-out` and `back` (one overshoot), plus a custom `cubic-bezier(x1, y1, x2, y2)` with x in [0, 1] and y in [−1, 2]. One pure solver in `webcam/easing.ts`, sampled per output frame (the GIF at its own frame rate).                                                                                                                                                                                                                                             | Owner decision 2. Everyone who has animated a web page knows these curves, and a cubic-bezier is four numbers to store and to test. The zoom's spring (`camera-path.ts`) needs state and simulation; a transition between two known layouts does not.   | 0039                              |
| 5   | **Hiding and showing fade over 200 ms, outside the hidden range**: the fade-out ends where the hidden segment starts and the fade-in starts where it ends. Inside a hidden segment the camera is fully hidden. Coming out of hidden into a section, the camera fades in at the section's layout (no slide from nowhere).                                                                                                                                                                                                                  | Owner decision 2. Outside the range is the only placement that keeps "hidden" honest: the user hides the camera because something should not be seen, and a fade inside the range would show 200 ms of it.                                              | 0039                              |
| 6   | **Gestures**: "Move from here" starts a section at the playhead lasting until the next section or the end; dragging the bubble with the playhead in a section edits that section's target, outside any section it creates one from the playhead; ⇧-drag moves the global layout; "Split at playhead"; "Remove section · back to global". The transition is drawn as a striped band at the section's start edge.                                                                                                                           | The mock. Each gesture is one pure edit in `webcam-edits.ts` with the existing contract (same scene on a no-op), so undo and autosave work as they do now.                                                                                              | reuses 0039                       |
| 7   | **The Camera lane is always shown when the take recorded a camera** and has no "remove" action; a take without a camera never offers it (there is no file). "Hide everywhere" is one hidden segment over the whole recording.                                                                                                                                                                                                                                                                                                             | Owner decision 8. The camera is part of the take, not an effect the user added; hiding it is an edit with a visible block, not a lane that silently vanishes.                                                                                           | reuses 0040                       |
| 8   | **Typed tracks on demand**: Clips and Audio always; Annotations, Zooms and Privacy appear when they have content or through "+ Add track". Removing one adds it to `scene.removedTracks`: its edits stay in the session, are not drawn, and are not exported; adding it back restores them. Removing Privacy with regions on it asks first and names the count. An empty lane added by hand is not saved.                                                                                                                                 | Owner decision 3. A removed track the user can bring back is undo across sessions; a removed Privacy track exports what was meant to be blurred, so it must never happen by a stray click.                                                              | 0040 (new)                        |
| 9   | **Activity becomes marks inside the Zooms lane.** A fresh recording keeps the detector's proposals as suggestions, not zooms: the inspector says "N zooms suggested · not added yet" with an Add action, and the Zooms lane appears when they are added.                                                                                                                                                                                                                                                                                  | Owner decision 4 and the mock. Activity only exists to explain where zooms come from, so it belongs inside Zooms. Applying suggestions automatically would make the Zooms lane always present and defeat tracks on demand (open question 1).            | 0040                              |
| 10  | **Media lanes**: `scene.mediaLanes: MediaLane[]`, bottom to top; a lane holds sorted, non-overlapping `MediaItem`s; an upper lane covers a lower one; lanes are unlimited and each is added on demand. A drop that overlaps an item on its target lane goes to a new lane above it. Overlay rows sit above Clips, topmost of the stack first. Only media gets lanes like this.                                                                                                                                                            | Owner decision 5, as CapCut does it (main track, each overlay on its own track above, upper covers lower). Zooms, privacy and annotations are effects with their own rules and keep typed lanes.                                                        | 0040                              |
| 11  | **Media items are anchored to timeline time**, like annotations: `start`/`end` in timeline seconds, `mediaStart` into the asset. A cut in the recording does not cut the overlay, which plays on continuously.                                                                                                                                                                                                                                                                                                                            | An overlay is content of the edited result with its own picture and sound; source anchoring would chop the overlay at every jump cut under it. It is the rule annotations already follow (scene.ts header).                                             | 0040                              |
| 12  | **Sources come only through the compose spec's path**: a Library item by its `assetId` (drag payload `application/x-kaipu-item`), a Finder file copied into the vault first (ADR 0018 on PR #279). The drop target is the lane: Clips takes the compose rule (video appended, image as a slide); an Overlay lane, "+ Add track → Overlay" or the preview makes a media item at the playhead. A recording used as a source brings its screen file only.                                                                                    | No second import path. The compose spec's decision 5 ("what is dropped onto what") already decides by target; this extends it with one more target.                                                                                                     | reuses 0018 (PR #279)             |
| 13  | **Placement and drawing**: a centre in the output frame plus a width fraction (height from the asset's aspect), the camera's 3×3 presets and size slider, drag and corner-resize on the preview, a "Full frame" preset (`cover`); edges rounded or square; optional shadow. Composer order: `frame → redactions → annotations → zoom crop → framing → media lanes (lowest first) → camera`; media items are drawn over slides too. Defaults: bottom-right, 35 % of the width, rounded, shadow on; an image lasts 5 s, a video its length. | The mock: same controls as the camera, so one placement model. After the crop and the framer, like the camera, so an overlay is never zoomed or cropped by Fill. The camera stays on top so the face survives a full-frame overlay.                     | reuses 0033, 0040                 |
| 14  | **Audio stays per source**: the recording keeps its Audio lane and mute model; every media lane holding a video with sound gets its own audio lane, muted per lane or per item. The mock's "Overlay audio / Keep mine / Both" control is not built; the overlay inspector offers "Mute this clip" and "Mute my recording here" (an ordinary muted range).                                                                                                                                                                                 | Owner decision 6. Two mutes express all three of the mock's choices without a fourth model to keep consistent with mute ranges.                                                                                                                         | 0040                              |
| 15  | **The export mixes**: every audible source is decoded, resampled to 48 kHz, summed and soft-clipped into one AAC track. The file has an audio track while any source is audible, even when the recording itself is muted.                                                                                                                                                                                                                                                                                                                 | Mixing is required (owner decision 6) and the worker already decodes and re-encodes audio (`export-worker.ts` step 4); the compose spec's open question 4 already chose 48 kHz.                                                                         | 0040                              |
| 16  | **Preview decoding**: one `<video>` per video item, mounted from 1 s before its start to its end, kept in step with the timeline by the webcam's drift rule; an element with sound corrects drift under 250 ms by nudging `playbackRate` instead of seeking. **At most 2 video items visible at the same instant** (lanes are unlimited) and 8 images.                                                                                                                                                                                    | It is the webcam's proven second-`<video>` path, generalized. Each visible video is one more hardware decode beside the screen and the camera; the limit makes the cost visible at placement time instead of as a stuttering preview (open question 3). | 0040                              |
| 17  | **Export decoding**: one mediabunny `Input` per video item, opened when its span starts and disposed when it ends, decoded in lockstep on timeline time; frame filling (`fillWebcamGap`) extends to any animated layer: a visible video item, a camera transition or a fade. Inputs read by range (`UrlSource`) per the compose spec's decision 6; until its spike passes, phase D does not start.                                                                                                                                        | Bounded memory: never all overlays in RAM at once. The screen capture is change-driven, so without filling a transition over a still screen would jump in one frame.                                                                                    | reuses 0018 spike (PR #279), 0040 |
| 18  | **The session stays version 1**: `transition`, `removedTracks` and `mediaLanes` are additive; absent means today's behaviour. No migration step runs.                                                                                                                                                                                                                                                                                                                                                                                     | The same rule that added `zoomSegments` and `webcam` (session.ts header). Older builds ignore the keys.                                                                                                                                                 | reuses 0033                       |
| 19  | **Export reuse**: `WEBCAM_COMPOSE_REVISION` goes `wc1 → wc2` (fades and transitions change how existing hidden segments draw), and the whole-recording fingerprint carries it too (`whole:wc2:<hash>`); a scene with media lanes adds `md1` to its edit fingerprint.                                                                                                                                                                                                                                                                      | An export made by the old composer must not be reused for a scene the new one draws differently; Share's seeded gaps are hidden segments, so Share is affected too.                                                                                     | reuses 0033                       |
| 20  | **Background music and camera-only clips are backlog pages only**; no decisions here.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Owner decision 7. Music builds on phase D's mixing; camera-only clips reopen ADR 0033's "camera as the subject" condition and need their own design.                                                                                                    | —                                 |

What this extends or reopens:

- **ADR 0033** keeps its viewport-layer model; [ADR 0039](/architecture/decisions/0039-camera-sections-with-eased-transitions/)
  amends its decision 2 (an override now changes only position and size and carries a
  transition) and lifts its non-goal "animated layout transitions". 0033's Status line notes
  the amendment.
- **The webcam spec's "Out of scope"** excluded "animated transitions between layouts" and
  "camera-only scenes". Transitions are designed here and camera-only clips get a backlog page.
  The reopen condition is met because the owner explicitly asked for both on 2026-10-31. The
  spec's out-of-scope bullet carries a note pointing here.
- **The compose spec's** (PR #279) out-of-scope line "picture-in-picture or several videos in
  one frame" is reopened by decision 10 for the same reason, and its decision 5 gains a target
  (decision 12). That spec is on another open branch and is not edited here; its PR should take
  the note when it is next updated.

## Open questions

Defaulted on 2026-10-31; each stands as written unless its "revisit if" triggers.

1. **Zoom suggestions are no longer applied on open.** Since video editor v2, a fresh recording
   opens with the detector's zooms already in the scene (`withInitialZooms`). Defaulted: the
   mock and owner decision 4 — they are suggestions until "Add". This reverses shipped
   behaviour: a user who exported without opening the inspector used to get zooms. Revisit if
   the owner prefers "applied by default, and the Zooms lane shows them" — then the inspector
   line only appears when the Zooms track is removed.
2. **The return to the global layout after a section that ends in a gap** uses that section's
   own transition, at the start of the gap. Defaulted: no separate "out" transition setting.
   Revisit if users want a slide in and a cut out.
3. **Two visible video items.** Defaulted: 2 at once, 8 images. Revisit after measuring on the
   owner's Mac (screen 60 fps + camera + N overlays at 1080p): raise it if 3 hold 60 fps in the
   preview, lower it to 1 if 2 do not.
4. **Media items enter and leave with a cut.** Defaulted: no fade or slide for overlays in C
   and D. Revisit if the first QA reads the cut as abrupt; the camera's 200 ms fade is the
   obvious reuse.
5. **Timeline anchoring of media items** (decision 11). Revisit if users complain that a cut
   earlier in the video shifts their b-roll off the sentence it illustrates; the alternative is
   Final Cut's "connected clip" (start pinned to a source time, duration free).
6. **Privacy regions do not cover media items.** A redaction blurs the recording beneath an
   overlay, not the overlay. Defaulted: stated in the Privacy inspector. Revisit if someone
   overlays a second screen recording that needs its own blur — that is a privacy lane per
   media item.
7. **"Bounce" is a single overshoot** (`back`, `cubic-bezier(0.34, 1.56, 0.64, 1)`). A real
   spring with several bounces cannot be one cubic-bezier. Revisit if the owner wants it: CSS's
   `linear()` easing (a list of points) is the model to adopt, still stateless.
8. **A removed media lane** follows owner decision 3: hidden, kept, restorable from "+ Add
   track" ("Overlay 2 · 3 items"). Deleting a lane for good is "delete every item on it".
   Revisit if hidden lanes pile up.
9. **Dependency on PR #279.** Phases C and D need its import (step 2) and in-app drag (step 3);
   D also needs its range-reading spike (step 1). If #279 changes those, revisit decisions 12
   and 17.

## Out of scope

- "Swap: my recording on top" (the recording as a small window over a full-frame overlay).
- Transitions, keyframes, masks, rotation, crop or blend modes on media items; overlay chroma
  key.
- A generic timeline where any item goes on any lane (rejected, ADR 0040).
- Framing per camera section, shape or mirror per section (owner decision 1).
- Privacy regions over media items (open question 6).
- Volume per item, audio fades, ducking, waveform editing, muted ranges inside overlay audio.
- GIF or audio files as overlays; formats beyond the compose spec's `mp4`, `mov`, `png`, `jpg`,
  `webp`.
- Background music and camera-only clips (backlog pages).
- Annotations drawn above media items (they are content-pinned, before the crop).
- Renaming `VideoOverlay` or `camera-path.ts`.

## Failures this must protect against

Input for tests; each line is at least one test.

1. A transition that does not land where the user put it → `webcamStateAt` at
   `section.start + effectiveMs` returns exactly the section's layout; at `section.start − ε`
   the previous one; tested for global→A, A→B (adjacent), A→gap→global, hidden→A.
2. Preview and export disagree mid-transition → one pure `webcamStateAt` and one easing solver
   used by `WebcamLayer` and `compose-webcam.ts`; a test samples both call paths at the same
   source times.
3. A section shorter than its transition overruns into the next → effective duration capped at
   50 % of the section; a 1 s section with a 2000 ms request animates for 500 ms.
4. A custom curve breaks the solver (x outside [0, 1], NaN) → the parser clamps x to [0, 1] and
   y to [−1, 2] and replaces non-finite values with the default; the solver is monotonic in x
   by construction, tested against CSS reference values (`ease-in-out` at 0.5 is 0.5).
5. An overshoot pushes the bubble off the frame or past the size limit → the composed rectangle
   is clamped by `clampWebcamCenter` after easing, and the size by `WEBCAM_LIMITS`.
6. A hidden range shows the face → no frame with `t ∈ [hidden.start, hidden.end)` has opacity
   above 0; the fades are outside the range (test on both edges and on a hidden segment at
   time 0 and at the end).
7. A cut through a transition or a fade → state is evaluated at each output frame's source time,
   so a cut shows the state at the next kept source time (a partial transition), never a
   stale one; tested across a cut inside a transition.
8. A still screen swallows a transition → the export emits filled frames at the output rate
   while a transition or fade is in progress; a test with a single held screen frame over a
   400 ms slide counts frames and checks positions.
9. A session with old override fields (shape, mirror) shows a shape change mid-video → the
   parser keeps only `position` and `size` in an override.
10. An older build opens and saves a v2 session and silently drops transitions, removed tracks
    and media lanes → cannot be prevented in old builds; the changelog says so, and the new
    build's parser never rejects a session for a missing key.
11. Removing the Privacy track exports what was meant to be blurred → a confirmation naming the
    count; the export dialog shows "Privacy track removed · N regions not applied"; test on
    `export-plan.ts` that removed tracks are filtered and on the dialog text.
12. A removed track still draws or exports → `export-plan.ts` and the preview read one
    `visibleScene(scene)` that applies `removedTracks` and hidden media lanes; tested for each
    track kind.
13. A media item whose Library item was deleted or renamed → it is referenced by `assetId`
    (rename keeps it, NIW2-560); a missing asset shows a placeholder and the export refuses
    with a message (the compose spec's rule).
14. Two overlays on one lane overlap → `addMediaItem` refuses an overlap on its lane; the drop
    handler creates a lane above instead.
15. The preview stutters with too many videos → placement refuses a third video visible at the
    same instant with a reason; test on the pure `concurrentVideoCount(lanes, t)`.
16. Overlay audio drifts from its picture or from the recording → the overlay plays its own
    audio from the same element as its picture; drift between elements is corrected by rate
    nudging under 250 ms and re-seek above; pure rule with a test.
17. The mix clips or loses a source → mixing tests with two full-scale sines (soft clip keeps
    the sum inside [−1, 1]); a 44.1 kHz overlay against a 48 kHz recording stays in sync after
    60 s (resampler test).
18. A muted recording drops the overlay's sound → the audio track is omitted only when no
    source is audible.
19. Export memory grows with the number of overlays → one `Input` per item, opened at its span
    and disposed after; a test asserts at most `maxConcurrentVideos + 1` inputs are open.
20. Old exports reused for a scene the new composer draws differently → `export-reuse` tests:
    `edit:wc1:*` and `whole:<hash>` never match a v2 scene with a webcam; `md1` appears only
    with media lanes.

## Acceptance criteria

Phase A — camera sections and transitions:

- [ ] With the playhead at 0:10, "Move from here" creates a section from 0:10 to the next
      section or the end; dragging the bubble moves it from 0:10 with a 400 ms ease-in-out
      slide.
- [ ] Changing the section's transition to Cut, to 1000 ms, to `back` and to a custom curve
      changes the preview, and the exported MP4 and GIF match it frame for frame.
- [ ] Three adjacent sections A→B→C each slide from where the previous one ended.
- [ ] A 0.6 s section with a 1000 ms transition animates for 300 ms.
- [ ] Hiding the camera over 0:20–0:25 fades it out over 0:19.8–0:20 and in over
      0:25–0:25.2; no exported frame inside 0:20–0:25 shows the face.
- [ ] ⇧-drag moves the global layout; Split at playhead and Remove section · back to global
      work and undo.
- [ ] A section's inspector shows only position, size and the transition.
- [ ] An export made before this phase is not offered for reuse after it.

Phase B — tracks on demand:

- [ ] A fresh recording shows Clips, Audio and (with a camera) Camera; no Annotations, Zooms,
      Privacy or Activity lanes; the inspector says "N zooms suggested · not added yet".
- [ ] Adding the suggestions shows the Zooms lane with activity marks inside it.
- [ ] Drawing an annotation shows the Annotations lane; "+ Add track" lists the absent ones.
- [ ] Removing Zooms hides its blocks, the preview and the export have no zoom; adding it back
      restores every zoom; the state survives closing and reopening the editor.
- [ ] Removing Privacy with regions asks first; the export dialog names the regions not
      applied.
- [ ] The Camera lane has no remove action; a take without a camera never shows it.

Phase C — image overlays:

- [ ] Dragging a Library screenshot onto the preview at 0:05 creates an Overlay lane with a
      5 s image item at the playhead; a PNG from Finder does the same after being copied into
      the vault.
- [ ] The 3×3 grid, the size slider and dragging/resizing on the preview place it; rounded or
      square edges and the shadow apply.
- [ ] With an auto-zoom active, the image stays still above the zoomed content; the camera is
      above the image; MP4 and GIF match the preview.
- [ ] Two overlapping images end up on two lanes and the upper one covers the lower one;
      reordering the lanes swaps them.
- [ ] Deleting the screenshot from the Library leaves a placeholder and the export refuses
      with a message.

Phase D — video overlays, per-source audio, mixing:

- [ ] A Library recording dropped on an Overlay lane plays over the recording in the preview,
      in step with it while scrubbing, playing and after a cut in the recording.
- [ ] The overlay's audio lane appears; muting it, muting the item and "Mute my recording
      here" each change what is heard in the preview and in the export.
- [ ] A recording muted as a whole with an audible overlay exports with the overlay's sound.
- [ ] A third video visible at the same instant is refused with the reason.
- [ ] A 5-minute export with two video overlays finishes without memory growth beyond one
      input per visible item, and its audio stays in sync to the end.

Phase E — background music: no criteria here; see the
[backlog page](/backlog/background-music/).

## 1. Where this comes from

### 1.1 The mock and the owner's decisions

The Claude Design mock "Kaipu Timeline v2" (not in the repo) shows tracks that appear on demand,
the Activity lane folded into Zooms, an inspector that says what a fresh recording offers,
media overlays with the camera's placement controls, and camera sections with a striped
transition band at their start. The owner reviewed it on 2026-10-31 and decided eight points
that override the mock where they differ; each is cited by number in the table above:

1. A section changes position and size; shape and mirror stay global; framing later.
2. Transitions: Slide and Cut per section, duration per section, CSS-like easing presets and a
   custom curve; hiding and showing fades over 200 ms each side.
3. Removing a track hides its edits and leaves them out of the export; re-adding brings them back.
4. Activity becomes marks inside Zooms; without a Zooms lane, "N zooms suggested".
5. Overlays can overlap: several media lanes, stacked by lane order, each added on demand —
   only for media.
6. Audio stays per source, each mutable on its own; the export mixes.
7. Background music and camera-only clips: backlog only.
8. The Camera lane is always shown when the take recorded a camera.

### 1.2 What the state of the art does

- **CapCut desktop**: a main track first; each overlay goes on its own track above it, and the
  upper track covers the lower ([guide](https://capcutguide.com/how-to-add-overlay-in-capcut/)).
  This is decision 10, limited to media.
- **Tella** layouts are sections of the timeline with their own camera layout
  ([Use layouts](https://www.tella.com/help/editing/use-layouts)); **CANVID** has camera layout
  segments ([Camera layout](https://www.canvid.com/support/editing/camera-layout));
  **Choppity** offers cut or animated transitions between layouts
  ([Screen recording layouts](https://www.choppity.com/features/screen-recording-layouts/));
  **Screen Studio** animates between dynamic camera layouts
  ([Dynamic camera layouts](https://screen.studio/guide/dynamic-camera-layouts-)). Sections with
  a Slide/Cut choice are the category's shape; decisions 2–3.
- **CSS easing** (`cubic-bezier()`, the keyword presets and `linear()`) is the curve model
  ([MDN `<easing-function>`](https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function));
  decision 4. The solver is the one browsers use (WebKit's `UnitBezier`: Newton–Raphson on x,
  bisection as the fallback).

## 2. Camera sections and transitions (phase A)

### 2.1 Model

Additive to `webcam/webcam-model.ts`, inside session version 1:

```ts
export type WebcamEasing =
  | "ease-in-out" // cubic-bezier(0.42, 0, 0.58, 1) — the default
  | "linear"
  | "ease-out" // cubic-bezier(0, 0, 0.58, 1)
  | "back" // cubic-bezier(0.34, 1.56, 0.64, 1): one overshoot
  | { cubicBezier: [x1: number, y1: number, x2: number, y2: number] };

export interface WebcamTransition {
  kind: "slide" | "cut";
  /** Requested duration, 100–2000 ms; kept when switching to Cut so switching back restores it. */
  ms: number;
  easing: WebcamEasing;
}

export interface WebcamSegment {
  id: string;
  start: number; // SOURCE seconds, as today
  end: number;
  mode: "hidden" | "override";
  /** override only: position and size (decision 2). */
  layout?: Pick<Partial<WebcamLayout>, "position" | "size">;
  /** override only; absent = Cut (every section saved before this design). */
  transition?: WebcamTransition;
}

export const WEBCAM_TRANSITION_DEFAULT: WebcamTransition = {
  kind: "slide",
  ms: 400,
  easing: "ease-in-out",
};
export const WEBCAM_FADE_MS = 200;
```

Sections stay source-anchored, sorted and non-overlapping, at least `WEBCAM_MIN_SEGMENT_SECONDS`
(1 s) long. A cut never moves them; a section entirely in deleted footage is kept and costs
nothing, as today.

### 2.2 The camera's state at a source time

`webcamAt(scene, t)` becomes `webcamStateAt(webcam, t): { layout: WebcamLayout; opacity: number } | null`,
pure, worker-safe, in the same file. `null` means nothing to draw. For a source time `t`:

1. **Target of each stretch.** The timeline of the camera is a sequence of stretches: sections,
   hidden segments and the gaps between them (global layout). Each has a target layout: a
   section's is `{ ...global, ...section.layout }`; a gap's is the global layout; a hidden
   segment has none.
2. **Inside a section** `[s, e)`: `from` is the target of the stretch that ends at `s` (the
   previous section if it ends exactly at `s`, otherwise the global layout). If that stretch is
   hidden, there is no slide: the layout is the section's target and the fade-in applies (step
   5). Otherwise, with `d = min(ms, (e − s) / 2)` and `kind === "slide"`, for `t < s + d`:
   `p = ease((t − s) / d)` and `position`, `size` are `from + (target − from) · p`; afterwards
   the target. A Cut is the target from `s`.
3. **Inside a gap after a section** `[e, next)`: the same rule with the ending section's
   transition, `from` = that section's target, `to` = global, `d = min(ms, (next − e) / 2)`
   (open question 2).
4. **Inside a hidden segment**: `null`.
5. **Opacity**: 1, except within `WEBCAM_FADE_MS` before a hidden segment starts (ramps 1 → 0,
   linear) and within `WEBCAM_FADE_MS` after one ends (0 → 1). Fades are clipped at 0 and at
   the source end; two touching hidden segments have no fade between them.
6. **Clamp**: `size` within `WEBCAM_LIMITS` (an overshoot can ask for more); the rectangle is
   then clamped inside the frame by `clampWebcamCenter`, after `scaleDuringZoom` is applied
   over the interpolated size (`webcamRect`).

The state is a function of `(webcam, t)` only. Every "from" is a static target because every
transition finishes inside its own stretch (the 50 % cap), so a chain A→B→C never has to know
where A's animation was when B started. That is what lets preview scrubbing, the MP4 and the
GIF sample the same function at any time, in any order, and agree — the property the zoom's
camera path buys with a fixed-step simulation (`camera-path.ts` header) and this one gets for
free.

`webcam/easing.ts` holds `easeAt(easing, p)`: the presets as fixed control points and the
custom curve through the same cubic-bezier solver. It is a few dozen lines, has no imports and
is tested against CSS reference values.

### 2.3 Editing

New and changed pure edits in `webcam-edits.ts`, all returning the same scene on a no-op as
today:

- `startSectionAt(scene, t, sourceDuration)` — "Move from here": a section `[t, next start or
end)` with the global layout as its starting target and `WEBCAM_TRANSITION_DEFAULT`; refused
  when `t` is inside a section or hidden segment or the window is under 1 s.
- `setSectionTarget(scene, id, { position?, size? })` — dragging the bubble with the playhead in
  the section; the inspector's position and size.
- Dragging outside any section calls `startSectionAt` at the playhead and then
  `setSectionTarget`, in one history step.
- `setWebcamLayout` — ⇧-drag and the global inspector; unchanged.
- `splitWebcamSegment(scene, id, t)` — two segments, same mode and layout; the right half copies
  the transition (visually nothing, since from equals to).
- `setSectionTransition(scene, id, patch)` — kind, ms (clamped 100–2000), easing.
- `removeWebcamSegment` — "Remove section · back to global"; unchanged.

The inspector, with a section selected, shows Position (the nine presets), Size, and a
Transition group: Slide | Cut, Duration, Easing (a menu with the four presets and "Custom…",
which opens four numeric fields and a small curve preview). Shape, Mirror, Shadow, Shrink
during zoom and Framing appear only for the global layout.

The Camera lane draws a section as today ("Custom") with a striped band at its start edge whose
width is the effective duration; hidden segments stay striped as a whole. The lane label
becomes "CAMERA".

### 2.4 Preview and export

- `WebcamLayer` reads `webcamStateAt` from the frame clock instead of `webcamAt`, applies
  `opacity` in its style, and keeps the second-`<video>` sync rule as it is.
- `compose-webcam.ts` reads the same state and draws with `globalAlpha = opacity`.
- The MP4 worker's `fillWebcamGap` already re-composes a held screen frame with the next webcam
  frame; it also fills, at the output's frame rate, every frame inside a transition or a fade
  (`webcamAnimatingAt(webcam, t)`, pure), so a still screen does not swallow the motion.
- The GIF samples the state at its own frame times; a 400 ms slide at 15 fps is six frames.

## 3. Tracks on demand (phase B)

### 3.1 Which lanes exist

| Lane                    | When it shows                                        | Can be removed                      |
| ----------------------- | ---------------------------------------------------- | ----------------------------------- |
| Clips                   | always                                               | no                                  |
| Audio (the recording's) | always ("No audio" when the take has none)           | no                                  |
| Camera                  | whenever `scene.webcam !== null`                     | no                                  |
| Annotations             | it has an annotation, or added through "+ Add track" | yes → `removedTracks`               |
| Zooms                   | it has a zoom, or added; carries the activity marks  | yes → `removedTracks`               |
| Privacy                 | it has a region, or added                            | yes, with confirmation if non-empty |
| Overlay (each)          | it has a media item, or added                        | yes → `MediaLane.hidden`            |
| Overlay audio (each)    | its media lane has a video item with sound           | follows its media lane              |

An empty lane added through "+ Add track" is UI state only: it is not saved, so a reopened
editor shows only lanes with content. `removedTracks` is saved: a removed lane with content
stays removed until it is added back. "+ Add track" lists the typed lanes that are absent, the
removed ones with their count ("Zooms · 5 hidden"), "Overlay" (a new lane on top), and every
hidden media lane.

Order, top to bottom: Annotations; Overlay lanes, topmost of the stack first; Clips; Zooms;
Camera; Privacy; Audio; the overlay audio lanes in the same order as their media lanes. The
camera draws above every overlay whatever the row order (decision 13).

### 3.2 Model

```ts
// scene.ts — additive, version 1 stays
export type RemovableTrack = "annotations" | "zooms" | "privacy";
export interface VideoScene {
  // …existing fields…
  /** Tracks the user removed: their edits stay here, are not drawn and not exported. */
  removedTracks: RemovableTrack[];
  mediaLanes: MediaLane[]; // section 4
}
```

`visibleScene(scene)` (pure, in `scene.ts`) returns the scene with removed tracks emptied and
hidden media lanes dropped. The preview, the export plan and the GIF plan read it; the editor's
lanes, the inspector counts and the session read the full scene. Undo covers add and remove.

### 3.3 Zooms, activity and suggestions

`ActivityLane` stops being a row; its marks render inside `ZoomLane` as thin ticks under the
blocks. `withInitialZooms` no longer writes `zoomSegments` on a fresh open: it returns the
proposals beside the scene (`suggestedZooms`, not saved, recomputed on open), and the inspector
shows "N zooms suggested · not added yet" with **Add**, which commits them as `origin: "auto"`
segments (one history step) and shows the lane. A session saved with zooms opens as today.
Open question 1 records that this reverses the shipped default.

## 4. Media overlays (phases C and D)

### 4.1 Model

`features/video-editor/media/media-model.ts`, pure and worker-safe:

```ts
export interface MediaLane {
  id: string;
  /** Removed by the user (decision 8): kept, not drawn, not exported, restorable. */
  hidden: boolean;
  /** Sorted by start, never overlapping. */
  items: MediaItem[];
  /** Whole-lane mute for its audio lane. */
  muted: boolean;
}

export interface MediaItem {
  id: string;
  kind: "image" | "video";
  /** A library item (recording or screenshot) in the vault. */
  assetId: string;
  /** TIMELINE seconds (decision 11), end exclusive, end − start ≥ 1 s. */
  start: number;
  end: number;
  /** Seconds into the asset where the item starts; 0 for images. */
  mediaStart: number;
  naturalWidth: number;
  naturalHeight: number;
  placement: {
    /** Normalized centre in the OUTPUT frame. */
    position: { x: number; y: number };
    /** Width as a fraction of the output width, 0.1–1; height follows the asset's aspect. */
    width: number;
    /** "Full frame": cover the output; position and width are ignored. */
    fullFrame: boolean;
  };
  edges: "rounded" | "square";
  shadow: boolean;
  /** video only. */
  muted: boolean;
}
```

`mediaLanes[0]` is the bottom of the stack. Edits in `media/media-edits.ts` follow the webcam
edits' contract (same scene on a no-op): `addMediaLane`, `addMediaItem` (refused on overlap),
`moveMediaItem` (between lanes and in time), `trimMediaItem` (left edge moves `mediaStart`
with `start`; a video cannot extend past its asset's end), `setMediaPlacement`,
`reorderMediaLanes`, `setMediaLaneHidden`, `removeMediaItem`.

Defaults: an image lasts 5 s; a video lasts its whole length, clamped to the timeline's end;
the placement is the bottom-right preset at width 0.35; rounded; shadow on; not muted.

### 4.2 Sources and dropping

Everything enters through the compose spec (PR #279): a Library card or row dragged with the
`application/x-kaipu-item` payload, or a Finder file that `library.import` first copies into the
vault (its ADR 0018) — the result is a Library item either way, and the media item stores its
`assetId`. The target decides:

| Dropped on                               | Video                                       | Image                      |
| ---------------------------------------- | ------------------------------------------- | -------------------------- |
| Clips lane (and the editor's empty area) | clip appended (compose decision 5)          | slide (compose decision 5) |
| An Overlay lane                          | media item there, at the drop time          | media item there           |
| The preview, or "+ Add track → Overlay"  | media item at the playhead, on the top lane | same                       |

A drop that would overlap an item on its target lane creates a new lane directly above. A
recording used as a source contributes its screen file only; its own camera file is not
nested. A missing asset (deleted from the Library) keeps the item with a placeholder and
blocks the export with a message.

### 4.3 Placement and drawing

The inspector reuses the camera's controls: the nine position presets (`WEBCAM_POSITION_PRESETS`
generalized to a rectangle of any aspect), a size slider (width), "Full frame", edges and
shadow. On the preview the selected item has a drag body and four corner handles, aspect
locked. Positions are in the output frame, so they mean the same on every export preset.

The composer (`createOutputComposer`) draws, for each output frame at timeline time `T`:
`frame → redactions → annotations → zoom crop → framing → media lanes (lowest first) → camera`.
Media items are viewport layers like the camera: the zoom does not move them, Fill does not
crop them. Over a slide on the main track they are still drawn (they are timeline-anchored);
the camera is not, as today. Edges use the camera's rounded radius; the shadow is
`WEBCAM_SHADOW`.

In the preview the media slots sit above `.content` and below the camera slot, untransformed
(plan 09's contract, extended by one more kind of slot).

### 4.4 Preview decoding (phase D)

Each video item gets a `<video src="kaipu-media://recording/<assetId>">` mounted from 1 s
before its start to its end, at its placement. Its time for timeline time `T` is
`mediaStart + (T − start)`. The webcam's sync rule applies on timeline time: on seek, set it; on
play and pause, mirror the main element; each frame of the main clock, compare. An element
whose item is audible corrects drift under 250 ms by setting `playbackRate` to 0.95 or 1.05
until it is back within 20 ms (a seek would click), and re-seeks above 250 ms. Muted items set
`muted` on the element.

The limit: `concurrentVideoCount(lanes, T)` over visible lanes must stay ≤ 2 for every `T`
(images ≤ 8). Placing, moving or trimming an item that would break it is refused with
"Up to 2 videos can play over your recording at the same time". Lanes are unlimited.

### 4.5 Export decoding (phase D)

`ExportPlan.media = visibleScene(scene).mediaLanes`. The runner does not fetch the media files
into memory: the worker opens one `Input` over `UrlSource(kaipu-media://recording/<assetId>)`
per video item when the output reaches its start and disposes it at its end, so at most two are
open at once. Each has a `CanvasSink` sized to the item's box in output pixels (capped at
1080p) and a lockstep cursor like `webcam-lockstep.ts`, keyed on timeline time. Images are
decoded once into an `ImageBitmap` per item and released at its end.

`UrlSource` by range is the compose spec's decision 6 and its first spike. Phase D does not start
before that spike has passed; if it fails, the compose spec's fallback (decode one source at a
time from a `Blob`) does not fit overlays that play at the same time, and this decision is
reopened.

Frame filling: while a video item is visible, the output is filled at the item's frame rate (or
the preset's cap), exactly as `fillWebcamGap` does for the camera.

## 5. Audio per source and mixing (phase D)

- **Lanes.** The recording's Audio lane keeps `audioMuted` and `mutedRanges` as they are. Each
  media lane with a video item that has an audio track gets an audio lane below the recording's,
  showing one block per such item. The lane's mute button sets `MediaLane.muted`; a block's sets
  `MediaItem.muted`. An item is audible when neither is muted and its lane is not hidden.
- **Overlay inspector.** "Mute this clip" (the item's mute) and "Mute my recording here" (adds
  an ordinary muted range over the source footage under the item at that moment; if the
  recording is later cut, the range follows the source, as every muted range does).
- **Preview.** The overlay element plays its own sound; the main element plays the
  recording's. No Web Audio graph.
- **Export.** The worker keeps its step 4 for the recording (per-clip decode, trim, rebase onto
  the timeline cursor) and adds, per audible video item, an `AudioSampleSink` over
  `[mediaStart, mediaStart + (end − start))`. Both go through `mixAudio` (pure, in
  `export/audio-mix.ts`): resample each source to 48 kHz with a linear resampler, place it at
  its timeline time, sum per sample, soft-clip above 0.9 (`tanh` knee), and hand blocks of
  1024 frames to the existing `AudioSampleSource`. The file gets an audio track when any source
  is audible over the timeline; it is omitted only when none is (today's rule, generalized).
  Channel count follows the preset (Light's mono downmix applies after the mix).
- **GIF.** No audio, unchanged.

## 6. Session and migration

All three keys are additive inside version 1, parsed like `webcam`:

- `webcam.segments[].transition` — absent → Cut. Unknown `kind` → the transition is dropped (the
  section stays, as a Cut). `ms` clamped to 100–2000. Unknown easing string → `ease-in-out`;
  `cubicBezier` x clamped to [0, 1], y to [−1, 2], non-finite → the default. Override `layout`
  keeps only `position` and `size` (decision 2). Hidden segments ignore a transition.
- `removedTracks` — absent → `[]`; unknown names dropped; duplicates collapsed.
- `mediaLanes` — absent → `[]`. A lane with a wrong type is dropped; an item with a wrong type or
  under 1 s is dropped; overlapping items on a lane keep the first; numbers clamp. A lane keeps
  its order. Whether an `assetId` still exists is decided at load against the library (missing →
  placeholder), never by the parser.

No migration step runs: a session saved before this design opens with every section as a Cut,
no removed tracks and no media lanes. The only visible change on an old session is the 200 ms
fade at hidden segments, which is the owner's decision and the reason for the revision bump
below. An older build opening a new session ignores the new keys; if it saves, they are lost
(failure 10, changelog note).

## 7. Export reuse

`export-reuse.ts`:

- `WEBCAM_COMPOSE_REVISION` becomes `"wc2"`. Every webcam edit fingerprint changes, so no export
  composed by `wc1` is reused.
- `wholeFingerprint(webcam)` becomes `whole:wc2:<hash>` for a recording with a webcam. Share's
  seeded scene has hidden segments wherever the camera was off mid-take, and those now fade, so
  an older `whole:<hash>` export no longer matches what Share would produce.
  `isWholeFingerprint` keeps matching both forms; `facelessFingerprint` is unchanged.
- `MEDIA_COMPOSE_REVISION = "md1"` is added to the edit fingerprint when `mediaLanes` has a
  visible item, so a later change to how media draws can be versioned the same way.
- `removedTracks` needs nothing: it is part of the saved scene the fingerprint already hashes.

## 8. Phases, order and difficulty

| Phase | Content                                                                                                                             | Depends on                                  | Relative difficulty       | Estimate   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------- | ---------- |
| A     | `transition` model and parser, `easing.ts`, `webcamStateAt`, gestures, inspector, lane band, composer opacity, frame filling, `wc2` | the webcam stack (#441–#446) merged         | Medium                    | 5–8 days   |
| B     | `removedTracks`, `visibleScene`, lanes on demand, "+ Add track", activity marks in Zooms, suggestions, Privacy confirmation         | none beyond today's editor (A not required) | Medium-low                | 3–5 days   |
| C     | `mediaLanes` model, edits, parser, media lanes UI, placement on preview and inspector, image drawing, drop targets                  | B; PR #279 steps 2–3 (import, in-app drag)  | Medium                    | 6–9 days   |
| D     | video items in preview (sync, limit), export inputs by range, lockstep, frame filling, audio lanes, mixing, `md1`                   | C; PR #279 step 1 (range spike)             | High (riskiest)           | 12–18 days |
| E     | background music                                                                                                                    | D's mixing                                  | — (backlog, not designed) | —          |

Riskiest, in order: (1) three or four simultaneous video decodes in the preview on the owner's
hardware — measured at the start of D before the limit is fixed (open question 3); (2) range
reads over `kaipu-media://` — the compose spike; (3) the mixer's sync over long exports — a
60 s resampler test and the 5-minute acceptance run.

Each phase is one or more PRs, each ending with "How to test it yourself"; the acceptance
criteria above are their seeds.

## 9. Sources

Repo (read on the webcam stack's tip, `feature/webcam-camera-toggle-mid-take`, 2026-10-31):
`features/video-editor/webcam/{webcam-model,webcam-edits,webcam-layout,webcam-sync}.ts`,
`components/{timeline-strip,webcam-lane,webcam-layer,audio-lane,overlay-lane}.tsx`,
`components/inspector/webcam-inspector.tsx`, `zoom/{zoom-model,camera-path}.ts`,
`{scene,session,initial-zooms}.ts`,
`export/{export-worker,compose-output-frame,compose-webcam,webcam-lockstep,export-reuse}.ts`,
`pages/video-editor/video-editor-page.tsx` (`extraLanes`); the
[webcam track design](/specs/2026-10-30-webcam-track-design/); the editor compose design on
`design/editor-compose` (PR #279).

External: [CapCut overlays](https://capcutguide.com/how-to-add-overlay-in-capcut/),
[Tella layouts](https://www.tella.com/help/editing/use-layouts),
[CANVID camera layout](https://www.canvid.com/support/editing/camera-layout),
[Choppity layouts](https://www.choppity.com/features/screen-recording-layouts/),
[Screen Studio dynamic camera layouts](https://screen.studio/guide/dynamic-camera-layouts-),
[MDN `<easing-function>`](https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function).

Not verified: decoder headroom for four simultaneous 1080p videos on the owner's machines;
whether mediabunny exposes a resampler (the design assumes a small pure one); whether
`kaipu-media://` serves `Range` (the compose spike).
