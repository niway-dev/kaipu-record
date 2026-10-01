---
title: "Capture panel latency — the widget loads before it appears, and picking a screen is slow"
description: "Why opening the tray widget shows a loader before the panel, why the screen picker takes up to a second, and the three small fixes that remove most of it. Diagnosed from the code on 2026-10-01; the fixes are written here so they can be applied without re-investigating."
---

# Capture panel latency

> **Status: 🔵 Proposed — fixes designed, not applied.** Owner noticed on 2026-10-01: _"cuando
> sale el widget primero hay un loading y luego recién aparece"_ and _"para elegir las
> pantallas se toma un poco de tiempo"_. Parent of the older perf note
> [screen-picker-thumbnail-perf](./screen-picker-thumbnail-perf), which parked the same cost
> as "revisit when we care about picker latency". We care now.

## Two waits, one root cause

**The widget shows a loader before it appears.**

1. The panel's `BrowserWindow` is created lazily on the first tray click
   (`capture-panel-window.ts` → `create()` with `show: false`) and `show()` is called
   straight after, without waiting for `ready-to-show`. The first open paints an empty
   window while the renderer loads and React mounts. Later opens skip this: the window is
   kept alive and hidden on blur.
2. On mount the panel runs `useSourceSelection` → `refresh()`, which calls
   `desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: 320×200 })`.
   That enumerates **every screen and every open window and captures a thumbnail of each** —
   macOS screenshots each window — only to pick "Screen 1" as the default.
3. From the tray the thumbnails come back blank (the window is not yet foreground), so
   `useScreenSources.refresh` retries: up to **4 × 250 ms with a loader**. The panel cannot
   show _Ready to record · Screen 1_ until the whole enumeration settles.

**Picking a screen is slow.** Opening the picker triggers the same full enumeration with
thumbnails again (`refresh` re-runs on `isSourcePickerOpen`), plus the retry loop. The older
note already priced it: _each call captures a thumbnail of every screen and window; up to five
calls in the worst case; ~1 s of loader._

**Root cause:** thumbnails are paid for when they will not be shown. The panel's initial
state only needs _which screens exist_; thumbnails are only seen once the picker opens. Both
paths use the one expensive call.

## The fixes, in impact order

1. **Two IPC calls instead of one.** `recording:get-screen-sources` takes
   `{ withThumbnails: boolean }` (or a sibling channel). On mount the panel asks for
   `types: ["screen"]` with `thumbnailSize: { width: 1, height: 1 }` — milliseconds, no
   per-window capture — and selects the primary screen from that. Thumbnails for screens
   _and_ windows are fetched only when the picker UI opens. This alone removes nearly all of
   the wait from the widget's appearance. Files: `src/main/recording-sources.ts`,
   `use-source-selection.ts`, `use-screen-sources.ts`.
2. **Pre-create the panel window at app start**, hidden, and only `show()` after
   `ready-to-show`. The first tray click stops paying the cold load. File:
   `src/main/capture-panel-window.ts` (call `create()` from `createTray`, keep `show: false`).
3. **Keep the blank-thumbnail retry only on the picker path.** The mount path has no
   thumbnails to be blank, so it must never enter the loop.
4. _Later, the parked question:_ replace polling with a window-ready signal and fetch once —
   see [screen-picker-thumbnail-perf](./screen-picker-thumbnail-perf).

Fixes 1–3 touch enumeration and the window lifecycle only, not the capture pipeline. Verify
by hand: open the widget from the tray on a desktop with many windows; the panel should show
_Ready to record · Screen 1_ with no loader, and the picker's loader should be the only one
left.
