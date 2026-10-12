---
title: "Editor compose — a new image or a new video from several sources, by drag and drop"
description: "Design for the two creation buttons in the Editor workspace: New image (several images on one canvas) and New video (several recordings joined end to end), fed by dragging items from the library or files from Finder. Replaces the Phase 2 and Phase 3 sections of the editor workspace spec."
---

# Editor compose — design

**Status: 🔵 Proposed · 2026-10-12.** Builds on Phase 1 of the
[editor workspace spec](https://github.com/niway-dev/kaipu-record/pull/241) (the `/editor`
section with URL-addressed editors, PR #244) and **replaces that spec's Phase 2 and Phase 3
sections**. Linear: NIW2-159 (video), NIW2-160 (image), NIW2-133 (import from disk).

## Summary (one minute)

The Editor workspace gets two buttons: **New image** and **New video**. Each opens an empty
editor with a drop zone. Anything can be dropped on it: an item dragged from the library, or a
file dragged from Finder (which is first copied into the vault as a library item). A new image
is the existing image editor with a second kind of layer: a dropped image becomes an
annotation of type `image` that moves and resizes like a box. A new video is two or more
recordings joined end to end, materialized immediately as a new recording that then opens in
the existing video editor. Every result is a new library item; no source is ever modified.
Two pieces are new infrastructure and come first: importing a file into the vault, and an
export worker that reads several inputs without holding them all in memory.

| #   | Decision                                                                                                                                                                                         | Why                                                                                                                                                                       | ADR             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | A file from Finder is **copied into the vault** as a library item before anything uses it. Nothing in the app references a path outside the vault.                                               | The vault file is the source of truth; `kaipu-media://`, thumbnails, sidecars and the cloud catalog all assume it. A referenced path can move or vanish.                  | **0018 (new)**  |
| 2   | **New video = join, then edit.** Joining sources end to end produces a new recording immediately; that recording opens in the existing single-source editor.                                     | One new piece (an N-input worker) instead of three (scene, preview, worker). Screen Studio cannot join recordings at all; this is ahead of the reference.                 | **0018 (new)**  |
| 3   | A joined recording carries **no cursor track** in the first version, so it gets no auto-zoom proposals. Manual zoom works.                                                                       | Rebasing N cursor tracks onto one timeline is the expensive part of a multi-source scene. Recovered later by projects (Phase B below), without rework.                    | —               |
| 4   | **New image = the image editor plus an `image` annotation.** The first image is the base; every dropped image is a layer with `x, y, w, h` that the existing tools move, resize and order.       | A second document model and a second editor would double the editor's surface for a 2–3 image use. Layouts (side by side, before/after) become presets that place layers. | **0019 (new)**  |
| 5   | Drop targets decide by **what is dropped onto what**: image→video editor = slide, video→video editor = clip appended, image→image editor = layer, video→image editor = current frame as a layer. | One rule the user can predict, and two of the four already exist (`SlideItem` in the video scene).                                                                        | —               |
| 6   | The export worker reads every input **by range from `kaipu-media://`**, not as a `Blob` held in memory.                                                                                          | Today the single source is fetched whole into RAM. Two 1 GB recordings would need 2 GB before the first frame.                                                            | — (spike first) |
| 7   | Everything produced here is a new item; sources are untouched.                                                                                                                                   | ADR 0003.                                                                                                                                                                 | reuses 0003     |

## Open questions

1. **Do joined videos need auto-zoom from day one?** Default: no (decision 3). If they do,
   skip straight to Phase B and the cost roughly triples.
2. **Can the export worker read by range from `kaipu-media://`?** Default: yes, through
   mediabunny's `UrlSource`; if the protocol handler does not serve `Range`, the fallback is to
   decode the sources one after another and release each `Blob` before fetching the next. A
   one-afternoon spike settles it before the plan is written.
3. **Output size when joined recordings differ** (a 1440p screen and a 1080p screen). Default:
   the largest source; smaller ones letterboxed, never upscaled past 1×.
4. **Audio across sources** (one with mic at 48 kHz, one silent). Default: one output rate,
   48 kHz; a source without audio contributes silence for its duration.
5. **Imported files and the cloud catalog.** Default: an imported item is a normal local item
   and can be uploaded like any other; its origin is recorded in the sidecar (`origin:
"import"`, original filename), not in the cloud schema.

## Out of scope

Picture-in-picture or several videos in one frame (split screen); a free multi-layer canvas
where the base image is also a movable layer; rotation, masks or blend modes on layers;
referencing files outside the vault; importing formats the recorder does not produce beyond
`mp4`, `mov`, `png`, `jpg`, `webp`; cloud-only items as sources.

## Failures this must protect against

- An import that leaves a half-copied file in the vault when the copy fails or the app quits.
- Dropping the same Finder file twice creating two items without telling the user.
- A dropped file the decoder cannot read (an HEVC `.mov`, a corrupt PNG) reaching the editor
  instead of failing at the drop with a message.
- A join export running out of memory on two long recordings.
- Audio drift or a gap at the boundary between two joined sources.
- A join or a composed image overwriting, moving or re-encoding any source (ADR 0003).
- An `image` layer whose library item was deleted: the composition must still open, showing a
  placeholder, and export must refuse rather than silently drop the layer.
- Losing an unsaved composition when navigating away (the workspace's `useBlocker` must cover
  the new editors).
- Dragging a library item onto a target that cannot take it (a recording onto the image editor
  while it is exporting) doing anything other than showing "can't drop here".

---

## What the repository already has (verified on `main`, 2026-10-06/12)

- **No drag and drop anywhere** in `apps/kaipu-record/src`. Electron is 39: `File.path` no
  longer exists (removed in 32); a dropped file's path is only available from the preload
  through `webUtils.getPathForFile`.
- **Video scene** (`features/video-editor/scene.ts`): `ClipItem` has `sourceStart/sourceEnd`
  and no source id — one source per scene. `SlideItem` already holds an image asset on the
  main track, and `export-plan.ts` already renders `RenderSlideSegment`. Dropping an image on
  the video editor is therefore a UI change, not a model change.
- **Export worker** (`features/video-editor/export/export-worker.ts`): one `Input` built from
  `BlobSource(msg.sourceBlob)`; the hook fetches `kaipu-media://recording/<id>` whole with
  `.blob()` (`use-video-export.ts:105`).
- **Image scene** (`features/screenshots/annotations/scene.ts`): `{ beautify, annotations[],
crop? }` over one implicit base image. Annotations are box, arrow, text, path and blur, with
  selection, move, resize and z-order already implemented. `crop` is relative to the
  beautified frame, padding included, so a crop can already extend into the background.
- **Vault** (`desktop/library-vault`): the media file is the source of truth, metadata in
  `.kaipu/<id>.json`; `describe()` merges the sidecar with `stat()`. There is no import path.
- **ADR 0003**: exports are new items linked through `derivedFromAssetId`. **ADR 0001**:
  mediabunny/WebCodecs, FFmpeg only as an optional offline tool.

## What the state of the art does

- **Screen Studio** cannot import a video or merge recordings; the documented workaround is
  exporting each one and joining them in another editor
  ([tight.studio](https://tight.studio/resources/how-to-import-and-combine-video-clips-in-screen-studio/),
  [borumi](https://borumi.com/blog/article/support/screen-studio/how-to-combine-multiple-clips/)).
- **Descript** joins clips from different files on one timeline and groups tracks into
  sequences; split screen is a separate tool
  ([Create a sequence](https://help.descript.com/hc/en-us/articles/10256429702413-Create-a-sequence),
  [Split screen](https://www.descript.com/tools/split-screen-video)).
- **CleanShot X** combines captures and extends the canvas with a margin; **Shottr** combines
  and resizes; **Xnapper** beautifies one capture and does not compose
  ([Setapp](https://setapp.com/app-reviews/cleanshot-x-vs-shottr),
  [lazyscreenshots](https://www.lazyscreenshots.com/compare/cleanshot-vs-xnapper/)). None of
  them offers free layers with rotation; the category's pattern is "a few captures on a board".
- **Electron**: dropped-file paths come from `webUtils.getPathForFile` in the preload
  ([clip-fuse #66](https://github.com/7rikazhexde/clip-fuse/issues/66),
  [walkthrough](https://jiaopucun.com/2025/04/04/drag-drop-files-electron-file-paths/)).

## Options considered

### New video

| Option                                                                                         | Against it                                                                                                          | Verdict            |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Join and materialize** — an N-input export produces a new recording, then edit it as usual   | Re-encodes once; the result has no cursor track, so no auto-zoom proposals                                          | **Phase A**        |
| **Project with multi-source scene** — `ClipItem.sourceId`, one `<video>` per source in preview | Changes scene, preview and worker together; the cursor tracks of every source must be rebased onto one timeline     | **Phase B**, later |
| Multi-track compositing (picture-in-picture, split screen)                                     | N synchronized decoders per frame and a new compositor; 3–5× Phase B for a case no reference in the category covers | Out of scope       |

Phase A is a strict subset of Phase B: the N-input worker is the piece both need. Nothing
built in A is thrown away by B.

### New image

| Option                                                                                                 | Against it                                                                                                            | Verdict                          |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Image as an annotation** — `image` joins the annotation union; layouts are presets that place layers | Asymmetric: the base is not a layer (it cannot go on top without a "swap" action), and the base fixes the canvas size | **Chosen**                       |
| Fixed layouts only (side by side, 2×2, before/after)                                                   | A form with three templates, not "a canvas I drop two images on"                                                      | Folded into the above as presets |
| Free canvas with layers (every image a layer, including the first)                                     | A second document model and, in practice, a second editor; past the category's own ceiling                            | Reopen condition of ADR 0019     |

### Drag and drop

| Option                                                   | Against it                                                                                                         | Verdict    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| **Library → workspace** (in-app drag, `assetId` payload) | None worth stating; it is the cheap half                                                                           | **Chosen** |
| **Finder → workspace, copied into the vault first**      | Uses disk (one copy per import); an imported video has no cursor track or Kaipu metadata                           | **Chosen** |
| Finder → workspace, referencing the external path        | Items that point outside the vault break when the file moves; breaks `kaipu-media://`, thumbnails and cloud upload | Rejected   |

## Detail

### 1. Import into the vault (first, and alone in its PR)

- Preload exposes `filesForDrop(files: File[]): string[]` over `webUtils.getPathForFile`.
- Main: `library.import(paths)` validates extension and size, copies with a temp name in the
  vault and renames on completion (atomic), writes the sidecar with `origin: "import"` and
  the original filename, probes duration and dimensions with mediabunny, and emits the usual
  library-changed event. A content hash short-circuits a duplicate import and returns the
  existing item.
- The library page accepts the same drop, so import is useful before any compose UI exists.
  This is NIW2-133's "first slice", and it is independently shippable.

### 2. Drag and drop inside the app

- Library card and row are `draggable`; the payload is `application/x-kaipu-item` with the
  `assetId` and `kind`. A drag from Finder carries `Files`; both are accepted by the same
  drop zones, and Finder files go through step 1 first.
- Drop targets follow decision 5. A target that cannot take a payload shows the not-allowed
  cursor and a one-line reason on hover.

### 3. N-input export worker

- `ExportStartMessage.sources: { id, url }[]` replaces `sourceBlob`. Each input is a
  mediabunny `Input` over `UrlSource(kaipu-media://recording/<id>)` read by range (open
  question 2). Inputs are opened in sequence and disposed before the next, so memory is
  bounded by one source's decode state.
- Video: each source is drawn into the output canvas at the output size (largest source),
  letterboxed. Audio: resampled to 48 kHz; silence for sources without audio; timestamps
  rebased with the existing `rebase-timestamp.ts`, offset by the running duration.
- The single-source export becomes the N = 1 case of this worker; its tests must keep passing
  unchanged.

### 4. New video (Phase A)

- `/editor/video/new` shows a drop zone and the ordered list of sources (reorder by drag,
  remove). **Join** runs the N-input export with no edits and writes a new recording with
  `derivedFromAssetId` set to the first source and `joinedFrom: assetId[]` in its sidecar,
  then navigates to `/editor/video/<newId>`.
- From there, it is an ordinary recording in the ordinary editor.

### 5. New image

- `ImageAnnotation { kind: "image"; x; y; w; h; assetId; naturalWidth; naturalHeight }`,
  normalized like every other annotation. Resize keeps aspect ratio unless ⇧ is held.
- `/editor/image/new` starts from a dropped image as the base. Without a base, the first drop
  becomes it; a "Blank canvas" choice uses a transparent base of a chosen size (1920×1080,
  1080×1080, 1080×1350).
- Layout presets (side by side, before/after, 2×2) resize the canvas through the existing
  crop-into-padding mechanism and place layers; they are commands, not a mode.
- The scene serializes `assetId` references; rendering and export read the bytes from the
  vault. A missing asset renders a placeholder and blocks export with a message (failure list).

### 6. Phase B, later: projects

A `.kaipu/projects/<id>.json` with the sources and a multi-source scene, as the earlier spec
described, when joined videos need auto-zoom or per-source edits after joining. Not designed
further here; reopened by open question 1.

## Delivery order

1. **Spike** — `UrlSource` over `kaipu-media://` with `Range` (half a day). Decides decision 6.
2. **Import into the vault** + Finder drop on the library page (NIW2-133).
3. **In-app drag** from the library + drop targets in both editors (slides and image layers
   are cheap; image layers need ADR 0019's model change).
4. **N-input export worker**, N = 1 regression first.
5. **New video** (join, then edit) and **New image** buttons in `/editor`.

Each step is one PR and ships on its own.

## References

- [Editor workspace spec, Phase 1](https://github.com/niway-dev/kaipu-record/pull/241) and its
  implementation, PR #244.
- [Standalone editor idea](/backlog/standalone-editor/)
- [ADR 0001 — mediabunny over FFmpeg](/architecture/decisions/0001-mediabunny-over-ffmpeg/)
- [ADR 0003 — an export never replaces the original](/architecture/decisions/0003-export-never-replaces-the-original/)
- [ADR 0018 — imports are copied into the vault; joining materializes a recording](/architecture/decisions/0018-imports-copy-into-the-vault-and-joins-materialize/)
- [ADR 0019 — composed images are layers in the annotation model](/architecture/decisions/0019-composed-images-are-annotation-layers/)
- Hub: [library vault](https://github.com/csdev19/general-knowledge/blob/main/desktop/library-vault.md),
  [media pipeline](https://github.com/csdev19/general-knowledge/blob/main/desktop/media-pipeline.md).
