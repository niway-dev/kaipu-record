---
title: "Testing: Edit screenshot flow"
description: "How the screenshot editor loads, edits and exports images, and why it is a strong headless E2E candidate."
---

# Edit screenshot flow

## The flow

A user reaches the screenshot editor two ways:

1. _Fresh capture_ — the `⌘⌃X` hotkey (or the Capture card) runs the native
   region selector; on confirm the app navigates into the editor with the PNG
   held in memory (`src/renderer/src/features/screenshots/use-screenshot-capture.ts:18-33`).
2. _Re-open a saved shot_ — from a screenshot's library detail page, the **Edit**
   button re-opens the already-saved PNG
   (`src/renderer/src/pages/library-detail/library-detail-page.tsx:72-81,127-129`).

In the editor the user can annotate (pen, arrow, box, text, blur), crop, and
_beautify_ (background gradient/solid, padding, corner radius, shadow), with
undo/redo and zoom. They then **Copy** to clipboard or **Save** to the vault. A
first Save writes a new item; a subsequent Save (or any Save of a re-opened
shot) prompts _overwrite_ vs _save a copy_
(`screenshot-editor-page.tsx:179-191`). Unsaved changes are guarded by a
navigation blocker + discard dialog (`screenshot-editor-page.tsx:93-95,318-324`).

## Under the hood

**Route + entry.** `/screenshot-editor` renders `ScreenshotEditorPage`
(`src/renderer/src/app/router.tsx:38`). The page reads its input from
react-router `location.state` as an `ImageSource`; a missing state redirects to
`/screenshots` (`screenshot-editor-page.tsx:44-48`). The editor is keyed on
`location.key` so each capture remounts fresh.

**ImageSource abstraction.** `ImageSource` is a discriminated union — `blob`
(fresh in-memory PNG), `local` (saved vault id), `cloud` (remote URL)
(`src/renderer/src/features/screenshots/image-source/types.ts:23-26`). Each kind
has a reader; `useImageSource` resolves any source to
`{ displayUrl, getBytes }` without the editor knowing the origin
(`image-source/use-image-source.ts`). Key detail: `getBytes()` is cached on the
_first_ read for the whole session, so an in-place overwrite doesn't re-read the
already-flattened bytes and double the frame (`use-image-source.ts:44-62`).

**How the image loads.** A `local` shot's `displayUrl` is
`kaipu-media://screenshot/<id>?v=<version>` (`image-source/local-reader.ts:5-15`),
served by the privileged, Range-aware media protocol in main
(`src/main/media-protocol.ts:85-107`, `screenshot` hostname → `screenshotFilePath`).
The scheme is registered with `bypassCSP` + `corsEnabled`
(`media-protocol.ts:21-38`). `<img>` element loads work directly; raw bytes for
`local` do **not** come through `fetch` (the scheme doesn't hand a body to
renderer fetch) — they come via IPC `screenshotReadBytes`
(`local-reader.ts:16-21`, handler `src/main/screenshots/screenshot-ipc.ts:68-71`).
A `blob` source carries its bytes inline and needs no IPC to load.

**How export/save works (canvas → PNG).** Copy and Save both call `exportPng()`,
which runs `compositeScene(...)`
(`screenshot-editor-page.tsx:128-133`,
`src/renderer/src/features/screenshots/annotations/compositor.ts:17-37`). The
compositor builds a self-contained **SVG** string mirroring the live preview
(beautify gradient/shadow, rough annotation paths, the shot embedded as a
data-URL `<image>`), then **rasterizes it on a `<canvas>`** via
`img.src = data:image/svg+xml,...` → `ctx.drawImage` → `canvas.toBlob("image/png")`
(`compositor.ts:203-227`). Output is a PNG `ArrayBuffer`. There is **no native
codec, no WebCodecs, no ffmpeg** on this path — pure DOM/canvas.

- Copy: `window.electronAPI.copyImageToClipboard(png)` → main writes a
  `nativeImage` to the clipboard (`screenshot-ipc.ts:59-61`).
- Save: `window.electronAPI.saveScreenshot(png, { title, overwriteId })` →
  `screenshotSave` handler writes `<id>.png` to the vault root + a `.kaipu/<id>.json`
  sidecar and returns the described item (`screenshot-ipc.ts:73-92`,
  `src/main/library/library-vault.ts:110-125`). A new id uses a timestamp stem;
  overwrite reuses the id and preserves `createdAt`.

**SVG clip-path + translate gotcha (already handled).** The shot is clipped by a
wrapping `<g clip-path>` with the `<use x=pad y=pad>` inside it, _not_ by putting
the clip on the translated `<use>` — otherwise the clip resolves in translated
user space and shears the top-left corner off. See the comment at
`compositor.ts:114-117`. An export test that asserts pixels near the corner would
be validating exactly this fix; magic-byte/size assertions won't.

## Testability

🟢 **Fully E2E-able** (headless, no IPC mocking). ✅ **Implemented** —
`e2e/screenshot-editor.e2e.ts` (seed a `.png`, enter via the real _Edit_ button, Save →
assert a valid PNG lands in the vault). This was the first flow test built on top of the
harness.

Unlike the _video_ editor export — which needs a WebCodecs H.264 encoder that is
unavailable on headless Linux CI — this flow's export is **canvas → PNG**
(`toBlob("image/png")`), which works headless. Loading a seeded `local`
screenshot via the `kaipu-media://screenshot/<id>` protocol is an `<img>`
element load (not CORS-gated), and its bytes come through the `screenshotReadBytes`
IPC handler that reads the real vault file — both run unchanged headless. Save
writes a real `.png` to the throwaway vault, giving a deterministic filesystem
boundary to assert on. The app already runs headless on Linux CI via `xvfb` +
`--no-sandbox` (`e2e/helpers/launch.ts:52-56`).

_Route-state caveat (important):_ the page reads its `ImageSource` from
react-router `location.state`, which lives only in the in-memory history entry.
The app uses `createHashRouter` (`router.tsx:1,29`), so a bare
`location.hash = "#/screenshot-editor"` navigation arrives with **no state** and
immediately redirects to `/screenshots` (`screenshot-editor-page.tsx:46`). The
realistic entry is therefore to hash-navigate to the screenshot's library detail
and click the real **Edit** button, which calls
`navigate("/screenshot-editor", { state: source })` — exactly how the existing
`openEditor()` helper enters the video editor (`launch.ts:95-102`).

## Proposed E2E test(s)

Reuse `launchApp()` but seed a **screenshot** instead of (or alongside) the video
fixture. A screenshot is a `<id>.png` in the vault root plus a `.kaipu/<id>.json`
sidecar; `describe()` classifies any `IMAGE_EXTS` file as `kind: "screenshot"`
(`library-vault.ts:80-84`).

1. **Seed** — extend `seedVault()` (or add a sibling helper): write a small
   valid PNG to `<vaultDir>/e2e-shot.png` and
   `<vaultDir>/.kaipu/e2e-shot.json` = `{ "title": "E2E Shot", "createdAt": ... }`.
   Any real PNG works (e.g. Electron `nativeImage.createEmpty()` won't encode;
   simplest is a checked-in 2×2 fixture PNG, mirroring `e2e/fixtures/sample.mp4`).

2. **Enter the editor via the real button** — add a helper paralleling
   `openEditor()`:

   ```ts
   await dismissOnboarding(page);
   await page.evaluate((id) => { location.hash = `#/library/${id}`; }, "e2e-shot");
   await page.getByRole("button", { name: "Edit" }).click();  // carries ImageSource state
   await page.waitForSelector("img");                          // BeautifiedFrame image
   ```

   This is the only reliable way to carry router `state` — do not hash-navigate
   straight to `/screenshot-editor`.

3. **Apply a simple edit** — e.g. click a beautify preset / drag a padding
   control, or pick an annotation tool from the toolbar. Even with _no_ edit,
   Save still exports a valid PNG, so a first pass can skip this and just assert
   the export path; a fuller test toggles one beautify control to prove the
   scene→SVG→canvas pipeline ran.

4. **Save → assert at the vault boundary.** A screenshot opened via **Edit** carries its
   existing vault id, so `savedId` is already set and clicking **Save** opens the
   `SaveOptionsDialog` (Overwrite / Save copy / Cancel — `screenshot-editor-page.tsx:179-191`),
   it does _not_ write directly. (Writing directly only happens for a brand-new capture that
   has no id yet.) The implemented test clicks **Save copy** to get an unambiguous new file,
   then asserts on the filesystem in Node (not pixels):
   - a new `*.png` (distinct from the seeded `e2e-shot.png`) appears in `vaultDir`, and
   - it is a **valid, non-empty PNG**: first 8 bytes are `89 50 4E 47 0D 0A 1A 0A`, `size > 0`.

   To exercise **overwrite** instead, choose **Overwrite** in the dialog and assert the same
   `e2e-shot.png` changed on disk (mtime/size differs). The in-app "Saved" toast
   (`role="status"`, `screenshot-editor-page.tsx:297-307`) is transient; prefer the filesystem
   assertion as the deterministic boundary.

A **Copy** variant is also viable but harder to assert headlessly (it writes to
the system clipboard via `nativeImage`); prefer asserting the Save path.

## Not covered / manual

- **Pixel-exact fidelity** (preview matches export; the clip-path/translate
  corner fix; gradient/shadow rendering) is best left to the existing unit tests
  around `buildSvg`/`compositeScene` (`compositor.test.ts`) plus manual visual
  review — an E2E PNG magic-byte check proves the pipeline runs, not that it
  looks right.
- **Native clipboard** contents (Copy) — reading back what landed on the OS
  clipboard is platform-specific and flaky in CI; verify manually.
- **Interactive native capture** (`captureInteractive`, macOS `screencapture`
  overlay) is out of scope for headless E2E — it's macOS-only and shown by main;
  seed a `local`/`blob` source instead.

Because the entire export path is canvas-PNG with no native/codec dependency,
this flow is a **strong candidate to implement as a real E2E test soon** — it
closes a gap the video-export flow structurally cannot.
