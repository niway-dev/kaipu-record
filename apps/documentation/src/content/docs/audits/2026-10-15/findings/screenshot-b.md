---
title: "Screenshot — Lens B (error handling, bugs, logic, races)"
description: "Detailed findings from the 2026-10-15 pre-deploy audit: Screenshot — Lens B (error handling, bugs, logic, races)."
---

> Part of the [2026-10-15 audit report](/audits/2026-10-15/report/). Paths are relative to `apps/kaipu-record/src/`.

## Summary

The capture → editor → save path is in reasonable shape: main's `capturing` guard prevents stacked
overlays, windows are restored on cancel and on error (`finally`), Copy/Save/Export/Paste all report
failures, and the source-bytes cache keeps Overwrite from double-compositing. What remains is a
cluster of small state races in `screenshot-editor-page.tsx`, which has no tests. The most important one:
**`persist()` clears the dirty flag unconditionally when a save resolves. So an edit made while the save is
in flight (including during the auto-save that fires the moment a capture opens) is neither in the vault
nor guarded, and leaving the editor drops it silently.** A second user-visible problem: a new capture taken while
the editor has unsaved work is thrown away if the user answers "Keep editing".

## Findings

### SHOT-B1. Edits made while a save is in flight are marked clean and lost on navigation

- Severity: medium
- Category: race
- Confidence: confirmed
- Where: `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:246-256` (also `:157-163`, `:316-323`)
- What happens: User captures with auto-save on (or clicks Save) → `persist` composites the scene
  captured in _that_ render's closure (`exportPng` → `scene.*` at `:203`) and awaits compositing + IPC + disk
  write (hundreds of ms for a Retina full-screen shot; auto-copy composites first, so the auto path
  is two composites back to back). Meanwhile the user draws an arrow or changes padding → the dirty
  effect (`:157-163`) sets `dirty = true`. The save then resolves and `setDirty(false)` (`:256`)
  overwrites it. The vault holds the pre-edit image, `dirty` is false, `useBlocker(dirty && …)` lets
  any navigation through (sidebar click, ⌘⌃V, ⌘⌃X), and the edit is gone with no prompt.
  The same window also makes `captureTitle.adopt(saved.title)` (`:255`) replace whatever the user has typed in
  the title field since the save started.
- Evidence: There is no scene-version or "edited since save started" check. The `busy` ref only
  serialises export operations; edits are never blocked. The auto actions run as soon as `imageReady`
  flips (`:316-323`), which is exactly when the user first sees the image and starts working.
- Fix sketch: Snapshot a scene revision (or the scene object) when `persist` starts, and only clear `dirty` if the
  scene is still identical when the save resolves. Only `adopt` the title if the draft is unchanged.
- Effort: S

### SHOT-B2. A new capture taken while the editor is dirty is silently discarded on "Keep editing"

- Severity: medium
- Category: logic
- Confidence: confirmed
- Where: `renderer/src/features/screenshots/use-screenshot-capture.ts:34-35`, `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:172,536-541`
- What happens: User has unsaved work in the editor and presses ⌘⌃X → selects a region → `openCapture`
  navigates with the PNG bytes in router state → the blocker intercepts → the window is revealed with
  "Discard unsaved changes / Keep editing". "Keep editing" calls `blocker.reset()`, which drops
  the pending navigation and the only copy of the new screenshot. It was never saved, and auto-save/auto-copy
  never ran for it because its editor never mounted. The dialog text talks about the _current_ edits and
  says nothing about the new capture.
- Evidence: The bytes live only in `navigate(ROUTES.editorCapture, { state: source })` (`open-in-editor.ts:87`).
  No other path persists or queues them. The previous audit's #8 fix added the guard but not this case.
- Fix sketch: When the blocked navigation is a capture, offer "Save current and open new", or auto-save
  the incoming capture before navigating (respecting the auto-save setting), or at least say in the dialog that
  the new capture will be lost.
- Effort: M

### SHOT-B3. Overwrite rewrites the library PNG in place — a failed write destroys the original

- Severity: medium
- Category: error-handling
- Confidence: confirmed
- Where: `main/library/library-vault.ts:364-366` (called from `main/screenshots/screenshot-ipc.ts:101-103`)
- What happens: Library shot → Edit → Save → Overwrite on a nearly full disk or an external vault
  drive that drops. `writeFile(<id>.png)` opens the existing file with truncate, then fails with
  ENOSPC/EIO. The original screenshot is now empty or partial. The renderer shows "save failed" with a retry, but
  the library item and its thumbnail are already corrupted. If the user then leaves the editor
  (the guard offers Discard), the image is unrecoverable.
- Evidence: `writeMeta` right above (`:232-241`) was made atomic (temp + rename) for exactly this
  reason. `writeImage` was not. On a new save (no overwrite), a `writeMeta` failure after
  `writeImage` succeeded also leaves an orphan PNG, and the retry mints a second id, which creates a duplicate item.
- Fix sketch: Write `<id>.png.tmp`, then `rename` (same as `writeMeta`).
- Effort: S

### SHOT-B4. "Discard" after "Save copy" deletes the user's copy and keeps the auto-saved original

- Severity: low
- Category: logic
- Confidence: confirmed
- Where: `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:254,325-336,447`
- What happens: Auto-save on. Capture → auto-saved as item A (`autoSaved = true`, `savedId = A`) → edit →
  Save → "Save copy" → `persist` creates B and `setSavedId(B)` (`:254`). The Discard button
  ("Delete this capture from the Library") is still shown (`autoSaved && savedId`) and now deletes
  B, the copy the user just chose to keep, while the auto-saved A stays. There is no confirmation.
- Evidence: `savedId` is reused for "the item this editor is bound to" and "the item auto-save created". The
  Discard handler relies on the second meaning, but `persist` rebinds it on every save.
- Fix sketch: Keep the auto-saved id in its own ref, and hide Discard (or have it target that ref) once the
  user has saved manually.
- Effort: S

### SHOT-B5. Clearing a re-edited label and then clicking another shape deletes the other shape

- Severity: low
- Category: bug
- Confidence: plausible
- Where: `renderer/src/features/screenshots/annotations/annotation-layer.tsx:316-323` with `annotations/use-editor-scene.ts:121-128`
- What happens: Double-click label A to edit it, clear its text, then click box B. The layer's `onPointerDown`
  selects B (a discrete event, so React flushes and `selectedId = B`). The mousedown default then blurs the textarea, so `onBlur` →
  `commitText("")` → `scene.select(A)` (queued) → `scene.removeSelected()`. `removeSelected` reads
  `selectedId` from its `useCallback` closure, which is now B. Result: B is deleted, and A keeps its old text. Undo
  recovers it, but the user sees the wrong shape vanish.
- Evidence: `removeSelected` has no id parameter. The test at `annotation-layer.test.tsx:183` mocks
  `removeSelected` and does not model selection changing before blur. Not run in a real browser
  (no app launch), hence "plausible".
- Fix sketch: Give `removeSelected` an optional id (or add `removeAnnotation(id)`) and call it with `editing.id`.
- Effort: S

### SHOT-B6. Capture failures still reject unhandled, with no feedback (still open)

- Severity: low
- Category: error-handling
- Confidence: confirmed
- Where: `renderer/src/features/screenshots/use-screenshot-capture.ts:20`; `shell/app-root.tsx` (`onCaptureScreenshotHotkey(capture)`); `preload/index.ts:169`
- What happens: `screencapture -i` exits non-zero (another system capture overlay is already active,
  or the temp PNG cannot be read) → `captureInteractive` rejects → main's `finally` restores the windows → the
  renderer's `capture()` has no try/catch, and the preload listener drops the returned promise →
  an unhandled rejection, no toast. `MacNativeProvider` also skips `rm` of the temp file when
  `readPng` throws (`main/screenshots/screenshot-capture.ts:46-47`).
- Evidence: The code is unchanged since the previous audit's verifier note.
- Fix sketch: Wrap the call in try/catch → `reportError(t("captureError"), …)`, and move the `rm` into a `finally`.
- Effort: S
- Known: #35

### SHOT-B7. The "finish the recording first" toast for ⌘⌃X goes to a hidden window

- Severity: low
- Category: error-handling
- Confidence: confirmed
- Where: `renderer/src/features/screenshots/use-screenshot-capture.ts:16-18`; `main/recording/recording-hub.ts:269`; `main/index.ts:301-308`
- What happens: During a recording, the hub hides the main window (`recording-hub.ts:269`). ⌘⌃X → main
  broadcasts the hotkey without checking activity → the renderer's guard calls `showToast` inside the hidden
  main window, and the toast auto-dismisses after 5 s. The user presses the shortcut and sees nothing. The guard
  protects the recording (the fix for #2), but the feedback it was meant to give is never visible.
- Evidence: `triggerCaptureScreenshot` has no hub-activity check, and the toast store is renderer-local.
- Fix sketch: Gate in main on `hub` activity and give feedback on a visible surface (control bar flash
  or a system `Notification`).
- Effort: S

### SHOT-B8. Auto-save/auto-copy are skipped if the image loads before settings resolve

- Severity: low
- Category: race
- Confidence: plausible
- Where: `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:112-120,316-323`; `renderer/src/pages/settings/use-app-settings.ts:15-18`
- What happens: `autoActionsRef` is filled during render only once `settings` arrives (an async `getSettings`
  IPC on mount). The effect that fires the actions depends on `[imageReady]` only, and
  returns early when `actions` is null, without marking itself as fired. If the `<img>` load
  (blob URL decode) wins the race against the IPC, the effect runs once with null actions and never runs again:
  auto-copy/auto-save silently don't happen for that capture. Normally the IPC wins (about 1 ms against a
  decode of tens of ms), so this needs a busy main thread (e.g. right after `screencapture` returns
  while main is still doing work).
- Evidence: There is no `settings` dependency in the effect. Measure by logging the order of `getSettings`
  resolution and `onImageLoad` across many captures.
- Fix sketch: Add `settings` (or a derived `actionsReady` boolean) to the effect's dependencies. The `autoActionsFired` ref
  already makes the effect run at most once.
- Effort: S

### SHOT-B9. Copy/Save/Export clicks during another export are silently dropped, and stale retries run after unmount

- Severity: low
- Category: error-handling
- Confidence: confirmed
- Where: `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:106,214,243,279,341,224,265`
- What happens: (a) `busy` is a ref, so the buttons never disable or show progress. A Copy click while the
  auto-save (or a slow PDF export) is running returns `false`/`null` with no feedback; the user
  thinks Copy worked and pastes the previous clipboard. (b) The `retry` closures given to
  `reportError` capture `persist`/`onCopy` from the failing render. The toast lives in the shell for 5 s,
  so a Retry pressed after leaving the editor (e.g. after Discard) runs `persist` with
  `imgRef.current === null` → `displayedW = 0` → compositor scale falls back to 1 → the shot is saved
  with display-pixel padding and radius (roughly 2–3× too thin on Retina), and it re-saves a capture the user
  just discarded.
- Evidence: `compositor.ts:87` (`scale = displayedW > 0 ? naturalW / displayedW : 1`). There is no
  mounted check in `persist`.
- Fix sketch: Mirror `busy` in state so the buttons disable while busy (or queue the click). Dismiss pending retry
  toasts on unmount, or have retry no-op when unmounted.
- Effort: S

## Checked and fine

- Hotkey pressed twice / during an open overlay: main's `capturing` flag (`screenshot-ipc.ts:37-48`)
  returns null to the second invoke before `beforeCapture`, so window visibility state is not clobbered.
  The renderer treats null as a cancel.
- Windows are always restored: `afterCapture` runs in `finally` (cancel and error). On success the
  renderer calls `revealAfterCapture` unconditionally after `openCapture`, even when the blocker
  intercepts.
- Window closed to tray + hotkey: `createWindow(false)` + `sendToRenderer` waits for `rendererReady`.
- `screenshot-<ISO ms>` id collisions: saves are serialised by `busy`, and there is one editor at a time. Not reachable.
- Overwrite of a deleted item: recreates the PNG; `describe` falls back to `birthtimeMs` for `createdAt`.
  Acceptable.
- Back/forward replaying `/editor/capture` state (and so double auto-save): no `navigate(-1)` or history
  back, and no app-command/swipe handling anywhere in `src/`. Not reachable today. It would become reachable
  if back navigation is added, because `autoActionsFired` is per mount.
- Auto actions under StrictMode: `autoActionsFired` is a ref and survives the dev double effect. StrictMode only
  affects dev. (Dev-only side effect: the `sceneSettled` skip runs twice, so a re-opened shot reads dirty in
  dev only.)
- Re-edited shot double-compositing (#4) stays fixed: `useImageSource` caches the first `getBytes`.
- Crop zero-size: `clampCrop` enforces a 2% minimum side. Only a tiny image (<25 px) could round to a 0-px
  output, which is negligible.
- Zoom does not leak into export: zoom is a CSS `transform`, so `clientWidth` (used as `displayedW`) is
  unaffected.
- Paste: `busy` ref serialises attempts, decode and IPC errors go through `reportError`, text fields are excluded,
  and paste is not active inside the editor (only on the Editor home and New).
- Non-macOS: capture returns null silently, but only macOS is released (`release-desktop.yml` has only
  `release-mac`).
- Out of lens, flagged for the security auditor: `screenshotSave` uses the renderer-supplied
  `overwriteId` as a path component without `isPlainItemId` (`screenshot-ipc.ts:101`, `library-vault.ts:366`).
