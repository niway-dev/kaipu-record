---
title: Editor workspace Phase 1 — implementation plan
description: Night-shift plan for NIW2-157 — one Editor section in the sidebar, URL-addressed editors, and a single openInEditor helper behind every Edit.
---

# Editor workspace Phase 1 — implementation plan

**Status: 🟡 In progress · 2026-10-06.** Implements Phase 1 of
[Editor workspace — design](/specs/2026-10-06-editor-workspace-design/) (Linear NIW2-157).
No editor logic changes: both editors move as they are.

## Steps

1. **Routes** (`shared/routes.ts`): `editor`, `editorVideo` (`/editor/video/:assetId`),
   `editorImage` (`/editor/image/:assetId`), `editorCapture` (`/editor/capture`). The old
   `screenshotEditor`/`videoEditor` paths stay as redirect routes.
2. **Helper** (`features/editor/open-in-editor.ts`): `editorPathFor(item)` picks the route
   by kind, `canOpenInEditor(item)` mirrors the detail page's rules (local copy; a video
   needs a duration), `useOpenInEditor()` navigates. A capture goes to `/editor/capture`
   with its `ImageSource` in router state.
3. **Route pages** (`pages/editor/`): the video and image routes resolve the item with
   `useParams` + `useLocalLibrary()` (as `library-detail-page.tsx` does) and render the
   existing editors, keyed by asset id so switching items remounts. The capture route reads
   router state. The legacy redirects map old state to the new URL (a `local` image source
   is mapped from its local id to the asset id through the library).
4. **Editor home** (`/editor`): the five most recent local items with an Edit action each.
5. **Sidebar**: an Editor entry (`PenLine`) between Screenshots and Library, en/es labels.
6. **Entry points**: library detail (video + screenshot), a new Edit action on the library
   card and row, and the ⌃⌘X capture flow all go through the helper. There is no library
   context menu today, so that entry point is not added (flagged in the PR).
7. **Window presets** (`shared/window-size.ts`): match any path under `/editor/video/`.
8. **Tests**: helper, route resolution and redirects, editor home, sidebar, window preset.
   The E2E helpers keep working because the detail-page buttons keep their names.
