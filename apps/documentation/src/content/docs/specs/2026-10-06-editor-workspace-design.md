---
title: Editor workspace — one place to edit videos and images, then build from several sources
description: Design with variants for a single Editor view in the desktop app — Edit from anywhere lands directly in it — and the larger follow-ups it enables, a video made from several videos and an image made from several images.
---

# Editor workspace — design

**Status: 🔵 Proposed · 2026-10-06.** Phase 1 is sized for one night-shift run. Phases 2 and
3 are larger and go through `plan-first`. Extends the idea in
[backlog/standalone-editor](/backlog/standalone-editor/).

## Summary (one minute)

Kaipu has two editors, video and image, reached on different paths: the video editor only
from a recording's detail page, the image editor from a capture or a screenshot's detail
page. Both receive their input through router state, so they cannot be reloaded or linked.
The proposal is one **Editor** workspace in the sidebar. Every "Edit" in the app lands
directly in it, with the right editor for the item, and the editor is addressed by URL. With
one workspace in place, two follow-ups become possible: a **video from several videos**
(clips from different recordings on one timeline) and an **image from several images**
(layers on one canvas). Both are projects that are not tied to a single recording, so they
come after the workspace and each needs its own plan.

| #   | Decision                                                                                                          | Why                                                                                              | ADR         |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| 1   | Variant A first: one Editor workspace in the main window, not a separate window.                                  | Smallest change that delivers "Edit lands in the editor"; the window rules from #199 stay valid. | —           |
| 2   | The editor is addressed by URL: `/editor/video/:id`, `/editor/image/:id`; router state only for unsaved captures. | Reload, back/forward and deep links work; one entry point to wire from anywhere.                 | —           |
| 3   | Old routes `/video-editor` and `/screenshot-editor` redirect to the new ones.                                     | Shortcuts and flows that navigate there keep working during the move.                            | —           |
| 4   | Multi-source work is a **project** saved in the vault, never a change to a source recording.                      | ADR 0003: exports never replace originals; a project references its sources.                     | reuses 0003 |
| 5   | Phase 2 (several videos) only concatenates and trims clips on the main track; no picture-in-picture.              | Concat is the cheap 80 %; mixing sources in one frame is a different, much larger feature.       | —           |

### Variants considered

| Variant                                                                | What it means                                                                              | Against it                                                                                                                   | Verdict      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **A. Editor workspace in the main window** (sidebar entry, URL routes) | Edit lands in one place; the sidebar shows where you are; reuses both editors as they are. | The main window's size presets now apply to a whole section, not one page (#199 made the video editor the window exception). | **Phase 1**  |
| B. Editor in its own window                                            | Edit opens a dedicated window; the library stays visible.                                  | Two windows that both need auth, i18n, autosave and the IPC listeners; the window-preset logic from #199 doubles.            | Rejected now |
| C. Inline editing on the library detail page                           | No navigation at all.                                                                      | The video editor needs the full window width (#199); the detail page would become the editor in all but name.                | Rejected     |
| D. Projects first (multi-source from day one)                          | One model for single and multi-source editing.                                             | Blocks the simple win on the hardest part: the scene model has one source, and the export decodes one input.                 | Phase 2–3    |

### Open questions

1. Should clicking a library card's thumbnail go straight to the editor, or keep the detail
   page and only change where "Edit" lands? Default: keep the detail page; add an **Edit**
   action on the card and its context menu that lands in the editor directly.
2. Phase 3 (several images): a free canvas with layers, or fixed layouts (side by side,
   grid, before/after)? Default: fixed layouts first — they match "make one image from a
   few screenshots" with no new tools.

### Out of scope

Picture-in-picture or mixing several videos in one frame; importing files from disk (the
standalone-editor first slice, a separate small item); collaborative editing; cloud-only
sources.

### Failures this must protect against

- Losing unsaved edits when switching items inside the workspace (the editors already block
  navigation with `useBlocker`; the workspace must keep that).
- A fresh capture that is not in the vault yet failing to open because the route expects an id.
- A redirect loop or a 404 from an old `/video-editor` link.
- Phase 2: an export from a project overwriting or moving any source recording.
- Phase 2: audio drift at clip boundaries when sources have different sample rates.

---

## Current state (verified on `main`, 2026-10-06)

- `app/router.tsx`: `ROUTES.videoEditor` and `ROUTES.screenshotEditor` are siblings of the
  other shell pages.
- `pages/library-detail/library-detail-page.tsx:155-178`: Edit navigates with router state
  (`{ id, assetId, title, durationSeconds }` for video; an `ImageSource` for images).
- `pages/video-editor/video-editor-page.tsx` (1,338 lines) and
  `pages/screenshot-editor/screenshot-editor-page.tsx` (436 lines) read `location.state`
  and redirect away when it is missing.
- `shell/sidebar.tsx`: Record, Screenshots, Library, Shortcuts, Settings, Cloud.
- `features/video-editor/scene.ts`: `ClipItem` has no source id — one source per scene.

## Phase 1 — Editor workspace (night shift)

1. **Routes.** In `shared/routes.ts` (the single route table), add `editor: "/editor"`,
   `editorVideo: "/editor/video/:assetId"`, `editorImage: "/editor/image/:assetId"` and
   `editorCapture: "/editor/capture"`. The `:assetId` param works like
   `libraryDetail: "/library/:assetId"`: `library-detail-page.tsx:54-57` already resolves an
   item with `useParams` + `useLocalLibrary()`, so the editor pages do the same instead of
   reading `location.state`. `/editor/capture` keeps router state for a fresh capture that is
   not in the vault yet (`ImageSource` kind `"blob"`, see
   `features/screenshots/image-source/types.ts`). Keep `ROUTES.videoEditor` and
   `ROUTES.screenshotEditor` as redirect routes that map their old state to the new URL.
2. **Sidebar.** An **Editor** entry between Screenshots and Library (icon `PenLine`), labels in
   `@kaipu/i18n` (en/es). With no item open, `/editor` shows an empty state: the five most
   recent items (video and image) with an Edit action each.
3. **Entry points.** Every place that opens an editor calls one helper,
   `openInEditor(item)`, which picks the route by kind. Today's call sites, all string
   literals: `pages/library-detail/library-detail-page.tsx:160` (image) and `:168` (video),
   and `features/screenshots/use-screenshot-capture.ts:34` (⌃⌘X capture → `/editor/capture`).
   Add the Edit action to the library card and its context menu.
4. **Window presets.** `shared/window-size.ts:76` matches `pathname === ROUTES.videoEditor`
   exactly. Change it to match any path under `/editor/video/`, and update its tests; nothing
   else about the presets changes.
5. **No editor logic changes.** Both editors move as they are; this phase only changes how
   they are reached.

### Acceptance (Phase 1)

- [ ] Edit on a video or a screenshot, from its detail page or the library card, opens
      `/editor/video/<id>` or `/editor/image/<id>`, with the sidebar's Editor entry active.
- [ ] Reloading the window on an editor URL reopens the same item.
- [ ] ⌃⌘X still lands in the image editor with the fresh capture.
- [ ] Old `/video-editor` and `/screenshot-editor` navigations land on the new routes.
- [ ] Unsaved-changes prompts still fire when leaving the editor or switching items.
- [ ] `/editor` with nothing open shows recent items.
- [ ] Router and page tests updated; E2E suite green.

## Phase 2 — a video from several videos (`plan-first`)

- **Project.** `.kaipu/projects/<projectId>.json` holds the session and the list of sources
  (`assetId` + local id). Projects appear in the library as their own kind, "Project".
- **Scene.** `ClipItem.sourceId`; the main track can hold clips from different sources,
  end to end. Cuts, trims, zooms (per clip, from each source's cursor track), mute and
  redactions keep working per clip.
- **Preview.** One `<video>` per source, swapped at clip boundaries, with the next one
  preloaded.
- **Export.** The worker decodes N inputs in sequence; audio resampled to one rate; output
  size is the largest source, others letterboxed. The result is a new recording
  (`derivedFromAssetId` = the project), per ADR 0003.
- **Entry.** "New project" in the Editor workspace and "Add to project" on library items.

## Phase 3 — an image from several images (`plan-first`)

- Fixed layouts first: side by side, grid 2×2, before/after. Each cell takes a library
  image; the existing beautify background and annotations apply to the whole canvas.
- Saved as a project like Phase 2; export produces a new PNG.
- A free canvas with draggable layers is a later option (open question 2).

## References

- [Standalone editor idea](/backlog/standalone-editor/) — import from disk and joining videos.
- [Editor space and window presets (#199)](/backlog/editor-space-and-window-presets/)
- [ADR 0003 — an export never replaces the original](/architecture/decisions/0003-export-never-replaces-the-original/)
