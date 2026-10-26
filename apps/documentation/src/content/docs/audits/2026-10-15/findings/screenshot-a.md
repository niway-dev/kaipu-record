---
title: "Screenshot — Lens A (performance, resource leaks, observability)"
description: "Detailed findings from the 2026-10-15 pre-deploy audit: Screenshot — Lens A (performance, resource leaks, observability)."
---

> Part of the [2026-10-15 audit report](/audits/2026-10-15/report/). Paths are relative to `apps/kaipu-record/src/`.

## Summary

The screenshot flow is functionally sound and its earlier silent-failure bugs are fixed, but it pays for the same image many times over. A fresh capture's PNG is copied around 6 times before the editor shows it, and the main process decodes it once just to read a width that nothing uses. With both auto preferences on (the default), the same scene is then composited twice: PNG to base64, two decodes, a canvas raster and a PNG encode, each time. PDF export is the worst single hot spot: a 3x raster goes through pdf-lib's pure-JS PNG decode, split and deflate on the renderer main thread. The single most important fix is to **composite once per scene state and reuse the result**, and to move PDF encoding off the main thread or embed it without a PNG round-trip. Observability is thin: failures reach PostHog through `reportError`, but there is no timing or size signal anywhere in this flow, and a capture IPC failure has no handler at all.

## Findings

### SHOT-A1. Auto copy + auto save composite the identical scene twice on every fresh capture

- Severity: medium
- Category: performance
- Confidence: confirmed
- Where: `renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx:303-310`, `:207`, `:217`, `:246`
- What happens: `screenshotSave` and `screenshotCopy` both default to `"auto"` (`shared/types/ipc.ts:230,232`), so every hotkey capture runs `runAutoActions`. Two steps run in sequence:
  1. `copyToClipboard()` calls `exportPng()`.
  2. `persist({silent:true})` calls `exportPng()` again on an unchanged scene.

  Each `compositeScene` (`annotations/compositor.ts:78-101`) does all of this:
  - FileReader to a base64 data URL (1.33x the PNG size as a string).
  - A full PNG decode just for `imageSize`.
  - Builds an SVG string that embeds that data URL.
  - `encodeURIComponent` of the whole SVG (one more full-size string).
  - A second full decode inside the SVG image.
  - A full-size canvas, then a PNG `toBlob` encode. Chromium encodes PNG in idle tasks on the main thread.
  - An IPC copy to main.

  The second pass is pure waste. It also holds the `busy` lock longer, and a Copy or Save click during that window returns silently (`:214`, `:243`).

- Evidence: the scene objects do not change between the two calls (the auto-action effect fires before any edit, `:316-323`). `bytesRef` caches only the input bytes (`image-source/use-image-source.ts:46-62`), not the output.
- Measure: wrap `exportScene` in `performance.mark`/`measure` and capture a full-screen Retina shot (2880x1800 plus default padding). Expect roughly 2x the composite time before "Saved & copied" appears.
- Fix sketch: memoize the PNG keyed on `(scene.beautify.state, scene.annotations, scene.crop, displayedW)`, which are already stable per edit (comment at `:152`). Copy and Save then reuse one `ArrayBuffer`. Separately, cache the data URL and natural size per source, since the bytes are immutable for the session.
- Effort: S

### SHOT-A2. PDF export freezes the renderer: 3x raster, then PNG encode, then pdf-lib's pure-JS PNG decode, alpha split and deflate on the main thread

- Severity: medium
- Category: performance
- Confidence: confirmed (code path); plausible (magnitude)
- Where: `renderer/src/features/screenshots/export/pdf-exporter.ts:12,19-41`; `annotations/compositor.ts:286-309`
- What happens: Export PDF composites at `rasterScale: 3`, clamped to a longest side of 8192 px.
  - A 1600x1000 region shot with default padding becomes a canvas of about 5400x3600 (19 MP, about 78 MB RGBA).
  - That canvas is PNG-encoded on the main thread's idle tasks.
  - `doc.embedPng` (pdf-lib 1.17.1) immediately runs `UPNG.decode` and `UPNG.toRGBA8`, then `splitAlphaChannel` (`pdf-lib/es/utils/png.js:15-45`).
  - It then deflates the RGB plane and the alpha plane with pako (`core/embedders/PngEmbedder.js:30,53`).
  - All of it is synchronous JS on the renderer main thread.

  The likely result is a multi-second UI freeze with no progress indicator, and several hundred MB of transient heap (canvas, RGBA frame, RGB plane, alpha plane, two deflate outputs). The PNG encode-then-decode round-trip exists only to feed pdf-lib.

- Evidence: no Worker or OffscreenCanvas is used anywhere in `export/`. `buildPdf` is called inline from `exportScene`, which is awaited by `onExportPdf` (`screenshot-editor-page.tsx:278-295`).
- Measure: time `exportAs("pdf")` on a 2880x1800 capture. Watch the Performance panel for long tasks inside `UPNG`/`pako`.
- Fix sketch: run composite plus `buildPdf` in a Worker (`OffscreenCanvas.convertToBlob`). Or, when the background is opaque, embed a high-quality JPEG (`embedJpg` is a passthrough, with no decode or deflate). Consider 2x instead of 3x.
- Effort: M

### SHOT-A3. The capture/paste PNG bytes are pushed into router history state and stay retained per capture in the Electron browser process

- Severity: medium
- Category: resource-leak
- Confidence: plausible
- Where: `renderer/src/features/editor/open-in-editor.ts:85-88`; `renderer/src/features/screenshots/use-screenshot-capture.ts:25-34`; `renderer/src/features/editor/paste-image.ts:51-59`
- What happens: `openCapture` calls `navigate(ROUTES.editorCapture, { state: source })`, where `source.bytes` is the full PNG `ArrayBuffer`. The app uses `createHashRouter` (`app/router.tsx:56`), and react-router 7.17 calls `globalHistory.pushState({usr: location.state, ...})` (`react-router/dist/development/chunk-6CSD65Y2.mjs:215-217,304`).
  - `pushState` structured-clones the bytes synchronously on the renderer main thread, which is a full copy on the critical path to the editor.
  - Chromium sends the serialized state to the browser process and keeps it in the NavigationEntry. In Electron, the browser process is the app's main process.
  - Every capture or paste is a new `push` (`replace` defaults to false), so main-process memory grows by about one PNG per capture, up to Chromium's 50-entry session history, and is never freed while the window lives.
  - With 15–25 MB full-screen Retina PNGs, 20 captures is about 300–500 MB.
- Evidence: nothing strips `bytes` from state, and no `replace` is used for captures. `useImageSource` keeps its own reference anyway (`bytesRef`), so state does not need to carry the bytes.
- Measure: main-process RSS (Activity Monitor or `process.memoryUsage()` in main) before and after 20 hotkey captures.
- Fix sketch: keep the bytes in a module-level `Map<captureId, ArrayBuffer>` (or a small store) and put only `{ captureId, origin, title }` in router state. Evict on editor unmount or save.
- Effort: S

### SHOT-A4. The main process synchronously decodes full PNGs for no use, or for work the OS clipboard could take as bytes

- Severity: medium
- Category: performance
- Confidence: confirmed (code); plausible (magnitude)
- Where: `main/screenshots/screenshot-ipc.ts:51-52`, `:64`, `:77-81`
- What happens:
  - **Capture (`:51-52`).** After `screencapture` returns, `nativeImage.createFromBuffer(png).getSize()` decodes the whole PNG on the main thread only to return `width`/`height`. Nothing in the renderer reads those fields: `source.width` and `source.height` are never consumed by the editor, and the compositor re-measures from the bytes. This sits on the hotkey-to-editor critical path, at about 15–25 ms for a 2.4 MP region and about 100 ms or more for a 5K full screen. It also blocks all IPC while it runs.
  - **Copy (`:64`).** `clipboard.writeImage(nativeImage.createFromBuffer(...))` is another full decode plus a platform re-encode on the main thread, on every Copy and every auto-copy.
  - **Paste fallback (`:77-81`).** `readImage()` plus `toPNG()` is a sync decode plus encode.
- Evidence: there is no worker or utility process, and every handler runs on the Electron main thread. `png.buffer.slice(...)` (`:55`) adds one more full memcpy before the IPC clone.
- Measure: `performance.now()` around `createFromBuffer` and `writeImage` in main for a 5K capture.
- Fix sketch: read width and height from the PNG IHDR (bytes 16–23), or drop them. For copy, `clipboard.writeBuffer("public.png", Buffer.from(png))` hands the encoded bytes to the pasteboard without a decode. Return the `Buffer`/`Uint8Array` directly instead of slicing.
- Effort: S

### SHOT-A5. Editor home decodes the whole clipboard image on the main process on every window focus

- Severity: medium
- Category: performance
- Confidence: confirmed (path); plausible (magnitude)
- Where: `renderer/src/pages/editor/editor-home-page.tsx:159-177`; `main/screenshots/screenshot-ipc.ts:72-75`
- What happens: while the Editor home's Images tab is mounted, every `focus` event invokes `clipboard:peek-image`. Main runs `clipboard.readImage()`, which reads and decodes the full pasteboard image, only to return its size.
  - Focus fires on every app switch back to Kaipu, and on reveal after capture.
  - A 5K screenshot on the clipboard is a common state, because auto-copy puts one there. That makes each focus a main-thread decode of about 100 ms, plus a 59 MB transient bitmap.
  - There is no debounce and no "clipboard unchanged" check.
- Evidence: `useClipboardImageSize` re-reads on every focus with no guard. Electron offers cheap `clipboard.availableFormats()` and `readBuffer("public.png")`; the size can come from the PNG IHDR without decoding.
- Fix sketch: check `availableFormats()` first, then read the raw `public.png` bytes and parse the IHDR. Skip the call entirely when the pasteboard change count (or the format list) is unchanged.
- Effort: S

### SHOT-A6. Pasting a PNG re-encodes it PNG to PNG on the renderer main thread before the editor opens

- Severity: medium
- Category: performance
- Confidence: confirmed
- Where: `renderer/src/features/editor/paste-image.ts:33-48`; `use-paste-to-editor.ts:65`
- What happens: ⌘V carries the image as a `File`, which is `image/png` for any macOS screenshot. `decodeToPng` always runs `createImageBitmap`, a full-size canvas, `drawImage` and a PNG `toBlob`, even when the input is already a PNG.
  - For a Retina full-screen paste, that is a full decode plus an idle-task PNG encode (hundreds of ms) before `openCapture` runs.
  - The returned `width`/`height` are unused by the editor (see A4).
- Evidence: there is no `file.type === "image/png"` shortcut.
- Fix sketch: when `file.type === "image/png"`, use `await file.arrayBuffer()` directly and read the dimensions from the IHDR. Re-encode only JPEG, HEIC and other formats.
- Effort: S

### SHOT-A7. Opening a saved screenshot in the editor waits on a full library listing; mount also fires a cloud refresh that re-lists a second time

- Severity: medium
- Category: performance
- Confidence: confirmed (path); plausible (magnitude)
- Where: `renderer/src/pages/editor/editor-routes.tsx:21-25,77-84`; `renderer/src/features/library/hooks/use-local-library.ts:126-134`; `main/library/library-service.ts:39-55`
- What happens: `/editor/image/:assetId` resolves its item via `useLocalLibrary()`. On mount that hook makes two calls:
  - `listLibraryItems`: `vault.list()` (stat, sidecar read and thumbnail check per item), then a **serial** `probeEditing` plus `probeEditSession` loop per item (`library-service.ts:52-55`).
  - `refreshCloudCatalog`: when signed in, this is a network fetch, and on success it broadcasts `library:changed`, which triggers a second full list.

  The editor renders `<Loading/>` until the first list returns (`:81`), so time to editor grows with vault size, even though the caller (Library card or Continue row) already holds the item. With 300 items, that is about 600–1,200 sequential fs awaits before the image appears, done twice.

- Evidence: `useStableSource` only prevents re-reading bytes. It does not avoid the list. The Editor home (`editor-home-page.tsx:45`) pays the same cost on every visit.
- Fix sketch: pass the already-known item via navigation state as a fast path (falling back to the list for deep links), or add a `describeByAssetId` IPC. Do not trigger a cloud refresh from editor routes.
- Effort: M
- Note: the serial per-item probe loop belongs to the Library feature; listed here for its effect on time to editor.

### SHOT-A8. No observability for capture, composite or export: no timings, no sizes, and capture IPC rejections are unhandled

- Severity: medium
- Category: observability
- Confidence: confirmed
- Where: `renderer/src/features/screenshots/use-screenshot-capture.ts:20`; `renderer/src/shell/app-root.tsx:50`; `main/screenshots/screenshot-ipc.ts:39-59`
- What happens:
  1. `capture()` has no try/catch. If `screenshot:capture` rejects (for example `execFile` failure, or `readFile`/`createFromBuffer` throwing), the hotkey path (`onCaptureScreenshotHotkey(capture)`) produces an unhandled rejection. PostHog autocapture may record it, but the user gets no toast, and main logs nothing about the `screencapture` exit code or stderr.
  2. There is no product event or timing anywhere in the flow: not hotkey to editor-ready, not composite duration, PNG or PDF byte size, or rasterScale clamping. A regression like A1, A2 or A4 in production is invisible; we would only hear "it feels slower".
  3. A compositor failure reports generic messages (`"compositor: toBlob failed"`, `"SVG rasterize failed"`) with no dimensions, scale or annotation count in the `context`. A canvas-size failure on a huge shot cannot be told apart from a decode bug.
- Evidence: there is no `track`/`capture` call in `features/screenshots`, `features/editor`, `pages/screenshot-editor` or `main/screenshots`. `reportError` contexts carry only `phase`.
- Fix sketch: wrap `capture()` in `reportError(t("captureError"), …)`. Log the `screencapture` exit code and stderr in main. Emit one sampled `screenshot_export` event `{format, ms, bytes, w, h, scale, annotations}` and one `screenshot_capture_ready` event `{ms}`. Add `w`, `h` and `scale` to compositor error context.
- Effort: S

### SHOT-A9. `useRecentScreenshots` re-lists the whole vault on every window focus to show 4 thumbnails, with an unhandled rejection

- Severity: low
- Category: performance
- Confidence: confirmed
- Where: `renderer/src/features/screenshots/use-recent-screenshots.ts:12-22`
- What happens: on `/screenshots`, every focus calls `listLocalRecordings` (n × stat, sidecar read and thumbnail check). The hook then filters to screenshots and keeps 4. There is no `.catch`, so a vault error (an unplugged drive, for example) becomes an unhandled rejection on every focus.
  - The focus refresh exists because `screenshot:save` never broadcasts `library:changed` (`screenshot-ipc.ts:94-116`), unlike every other vault mutation in `main/library/index.ts`.
- Fix sketch: broadcast `library:changed` from `screenshot:save`, subscribe to it here instead of `focus`, and add a `.catch`.
- Effort: S

### SHOT-A10. Every pointermove during move, resize, crop or a slider drag re-renders the whole editor page, with nothing memoized

- Severity: low
- Category: optimization
- Confidence: plausible
- Where: `renderer/src/features/screenshots/annotations/annotation-layer.tsx:217-229`; `use-editor-scene.ts:89-94,115-119,135`; `beautify/crop-overlay.tsx:70-91`
- What happens: moving or resizing a shape calls `scene.updateAnnotation`, which is page-level state. A crop drag calls `setCropLive`, and a beautify slider calls `setLive`. Each one re-renders `ScreenshotEditor`, which re-renders all of these:
  - the toolbar, `CaptureTitleInput`, `BeautifyPanel`, `AnnotationOptions` and `BeautifiedFrame`;
  - every `Shape`, which recomputes `roughRect`/`roughArrow`/`smoothPath`;
  - each blur shape's full-size `<image>` and filter.

  `useEditorScene` also returns a fresh `beautify` controller object each render. Pen and draw drafts are local to `AnnotationLayer`, so they re-render only the shapes. The per-shape work is cheap arithmetic, and Chromium aligns pointermove to rAF. Up to about 50 annotations this is likely fine; the risk is many blur boxes on a 5K shot, where SVG repaint re-runs the filters.

- Measure: React Profiler commit time while dragging with 50 annotations, including 5 blurs.
- Fix sketch: `React.memo(Shape)` (props are stable per annotation), and memoize `BeautifyPanel` and `AnnotationOptions` on their slices.
- Effort: S

## Checked and fine

- `getBoundingClientRect` per pointer event (`annotation-layer.tsx:132`, `crop-overlay.tsx:82`): layout is clean between rAF-aligned events, so this is a cheap read and not forced layout thrash.
- Non-passive `wheel` listener (`screenshot-editor-page.tsx:183-193`): scoped to the canvas element, subscribed once (keyed on `hasImage`), and returns early unless ⌘ or Ctrl is held. It makes canvas scroll main-thread-bound, but only matters while the main thread is busy (see A1/A2).
- Blob URL lifecycle: `blobReader` revokes on effect cleanup, and the compositor uses data URLs only (nothing to revoke). Canvases are local and GC'd. No object-URL leak found.
- `useImageSource` byte cache: one read per source per editor session, reset on source change, and a failed read is dropped for retry. Correct and bounded.
- Annotation ResizeObservers (`annotation-layer.tsx:86`, `crop-overlay.tsx:54`, `beautified-frame.tsx:58`): fire on layout size change only, not per pointer event. `BeautifiedFrame` disconnects while windowed.
- `capture-panel.tsx:49` ResizeObserver to IPC: fires only when the panel's content height changes (menus, tabs). Negligible.
- `markOpenedInEditor` (`editor-routes.tsx:47-51`): one sidecar write per item visit, deliberately not broadcast. Fine.
- Pen-stroke point accumulation: throttled at 0.004 normalized distance, so O(n) copy per move stays small.
- The re-entrancy guard on `screenshot:capture` and the window hide/restore in `finally` are correct. A rejected capture still restores the window.
- `rm` of the temp PNG is awaited, but it is one unlink (about 1 ms), so not worth parallelising.
