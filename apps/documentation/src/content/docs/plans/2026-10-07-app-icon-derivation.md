---
title: Derive the desktop app icon from the brand package
description: Plan for NIW2-181 — regenerate the macOS app icon (Dock, ⌘-Tab, Finder, DMG) from packages/brand with a script, and show it in dev runs.
---

# Derive the desktop app icon from the brand package

**Status: 🟡 In progress · 2026-10-07.** Linear: [NIW2-181](https://linear.app/niway/issue/NIW2-181). Reference: `origin/main` at `400c80e`. Closes the "desktop bundle icon export" step of [Brand identity and website rollout](/plans/2026-09-27-brand-and-website-rollout/).

## Problem

The window content shows the new fox (`@kaipu/brand`), but the OS shows the old pink
"play" triangle in the Dock and ⌘-Tab. Two causes:

1. **Packaged app.** `apps/kaipu-record/build/icon.icns` (electron-builder
   `directories.buildResources`) and `build/icon.png` are hand exports from before the
   brand package existed. Nothing ties them to `packages/brand/assets/logo-app.svg`.
2. **Dev run.** The main process never calls `app.dock.setIcon()`, so `bun run dev` shows
   Electron's default icon. `resources/icon.png` (the Linux window icon) is also the old art.

## Plan

1. `apps/kaipu-record/scripts/generate-app-icons.sh` (macOS, headless, `sips` + `iconutil`):
   - Wraps `logo-app.svg` in a 1024-unit SVG that places the artwork on Apple's icon grid
     (824 px body, 100 px margin) so it sits at the same size as other Dock icons.
   - Renders every iconset size straight from the vector (no raster upscaling), builds
     `build/icon.icns` with `iconutil`, writes `build/icon.png` (1024) and
     `resources/icon.png` (512, dev Dock + Linux window).
   - Writes `build/icon.source.sha256`: the hash of the SVG source and the script.
   - `bun run icons` in `apps/kaipu-record` runs it.
2. Main process: in dev on macOS, `app.dock.setIcon(icon)` so the dev Dock/⌘-Tab shows the
   brand icon. Packaged builds keep the bundle `.icns` (calling `setIcon` there would mask a
   stale bundle icon, which is exactly the bug).
3. Test (vitest, main project, runs on Linux CI too): the stamp matches the current hash of
   `logo-app.svg` + the script, so editing the source without regenerating fails CI.
4. Note in the rollout plan which step this closes.

## Not verified at night

Visual check in the Dock, ⌘-Tab and Finder for `bun run dev` and a fresh DMG install
(`killall Dock` may be needed to flush the icon cache).
