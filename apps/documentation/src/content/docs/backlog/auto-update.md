---
title: Auto-update (electron-updater)
description: Wire electron-updater against the real GitHub Releases feed so installed apps update themselves. The build/sign/notarize/distribute pipeline (#7) already ships the feed assets — only the updater client and the publish target are missing.
---

# Auto-update (electron-updater)

> **Status: 🟢 Shipped to prod — partial validation.** Deployed: the landing (`kaipu.app`), the
> R2 feed/installers, and the **download button works** (a real signed DMG downloads from
> `updates.kaipu.app`). ✅ validated: distribution + download. ⏳ pending: the **in-app
> self-update** flow — only provable with a **second release** (`desktop-v0.2.0`) that an installed
> `0.1.0` picks up. Spec: [/specs/2026-06-28-auto-update-design](/specs/2026-06-28-auto-update-design) ·
> Plan: [/plans/2026-06-28-auto-update](/plans/2026-06-28-auto-update).

The signed + notarized release pipeline already works (see
[roadmap → #7](./roadmap#7--builds--distribution--shipped-auto-update-split-out)). What's
missing is the app **updating itself** after install. This is the intermediate step between a
shipped build and the [version gate](./roadmap#8--version-gate--forced-update--in-progress):
once `electron-updater` is wired, the version gate's "Actualizar" button can trigger an
in-app update instead of opening a download page.

## What already exists (no work needed)

- `electron-updater@6.3.9` + `electron-builder@26` are dependencies.
- `release-desktop.yml` publishes the **exact feed assets electron-updater consumes** on every
  tagged release: `latest-mac.yml` + the `.blockmap` files, alongside the DMG/zip.
- Releases are signed with Developer ID and notarized → the updater can verify them.

## What's missing (the work)

1. **`electron-updater` is not wired** — zero `autoUpdater` / `checkForUpdates` usage in
   `src/main`. Need to add an updater module that calls `checkForUpdatesAndNotify()` (or a
   custom flow) at startup and exposes update state to the renderer.
2. **`publish.url` is a placeholder** — `electron-builder.yml` has
   `publish: { provider: generic, url: https://example.com/auto-updates }`. Point it at the
   real feed.
3. **The release builds with `--publish never`** — the workflow uploads assets to a GitHub
   Release manually (`softprops/action-gh-release`). For the updater to find them, either keep
   the generic provider pointed at a stable URL that mirrors the release assets, or switch to
   `provider: github`.

## Open decisions (resolve when we start)

- **Feed provider:** `provider: github` (read assets straight from GitHub Releases — simplest,
  no extra hosting) vs. `provider: generic` against a Cloudflare R2/Pages mirror (more control,
  matches where the version-gate JSON will live).
- **Draft/prerelease handling:** the release job currently creates **draft + prerelease**
  GitHub Releases. `provider: github` skips drafts by default — decide whether testers pull
  prereleases (`allowPrerelease`) and when a release is flipped to non-draft.
- **Update UX:** silent download + "restart to update" prompt vs. a visible "update available"
  banner. Should align with the version-gate overlay/banner styling so the two feel like one
  system.
- **Cadence:** check on startup only, or also periodically / on focus (same trade-off the
  version gate already settled — reuse that throttle pattern).
- **Channels:** single `stable` channel for now, or `stable` + `beta` from the start.

## Why it's separate from the version gate

The [version gate](./roadmap#8--version-gate--forced-update--in-progress) is a **fail-open
kill-switch** that works **without** auto-update — its "Actualizar" button opens the GitHub
Releases page until the updater exists. Auto-update is the delivery mechanism that later makes
that button a one-click in-app update. Building them separately keeps each PR focused: the gate
ships first (no external dependency), auto-update follows on its own branch.
