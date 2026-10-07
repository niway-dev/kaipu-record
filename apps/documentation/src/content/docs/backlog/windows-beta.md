---
title: "Windows beta — recording first, screenshots later"
description: "Ship the working Windows build as a recording-only beta instead of waiting for screenshot parity. Owner decision 2026-09-27."
---

# Windows beta — recording first, screenshots later

> **Status: 🔵 Proposed → owner approved the direction** (2026-09-27). The Windows build exists
> and records; screenshots are not ported yet. Decision: ship what works as a labelled beta.
> Parent: [Product growth](./product-growth).

## Why now

Both direct competitors ([Recordly](/marketing/positioning/) and Cap) are on Windows. In any
launch thread "is there a Windows version?" is the first objection, and every week without an
answer costs more than a beta with a known gap. The person who records does not wait for the
person who takes screenshots.

## Scope of the beta

| In                                                    | Out (labelled "coming soon")                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Screen recording, camera bubble, mic and system audio | Screenshot capture and the screenshot editor                                          |
| The video editor and export                           | Global screenshot shortcut                                                            |
| The library and vault                                 | Anything that depends on macOS-only APIs (Dock policy, content-protected control bar) |
| Auto-update via the existing release pipeline         |                                                                                       |

## What exists today (checked 2026-09-27)

| Piece                                                                   | State                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run build:win` (rebuild native → build → `electron-builder --win`) | Exists; the owner has run it and the app records                                                                                                                                                     |
| `electron-builder.yml` `win` / `nsis` targets                           | Configured (installer name, shortcuts)                                                                                                                                                               |
| Release pipeline `release-desktop.yml`                                  | **macOS only**: one job on `macos-latest`, sign + notarize + DMG + R2 feed. No Windows job                                                                                                           |
| Windows code signing                                                    | **Not configured**: no certificate, no `CSC_*` secrets for Windows                                                                                                                                   |
| Platform guards                                                         | Recording, click hook and login-item already branch on `win32`. Screenshot capture returns `null` outside macOS (`main/screenshots/screenshot-ipc.ts`), which is a silent no-op, not a "coming soon" |
| Auto-update on Windows                                                  | Untested; the feed writer only knows the macOS artifacts                                                                                                                                             |

So the gap is not the build. It is **distribution**: CI, signing, the update feed, and the
UI telling the truth about screenshots.

## Steps, in order

1. **CI job.** Add a `windows-latest` job to `release-desktop.yml` mirroring the macOS one:
   checkout, `bun install`, `rebuild:native`, `build:win`, upload the `-setup.exe` to the
   release. Run it on a tag first, unsigned, to prove reproducibility.
2. **Screenshots say "coming soon".** Replace the silent `null` with a platform-aware state:
   hide the capture tab and the global screenshot shortcut on Windows, or show them disabled
   with a one-line "Coming to Windows" and a link to the public roadmap.
3. **Signing decision** (owner): buy a code-signing certificate now (an OV certificate is
   enough to stop SmartScreen after reputation builds; EV removes the warning immediately but
   costs more and needs hardware), or ship the first beta unsigned with an explicit
   SmartScreen walkthrough on the download page. Recommendation: ship unsigned beta now with
   the walkthrough, buy OV in parallel, sign from the second beta.
4. **Auto-update.** Extend the feed writer for the NSIS artifact (`latest.yml`) and verify a
   Windows install updates from beta 1 to beta 2.
5. **Version gate and analytics** verified against the Windows artifact.
6. **Landing and roadmap.** "Download for Windows (beta)" button, the screenshots gap stated,
   and a public-roadmap row "Windows — screenshots".
7. **Manual QA on real hardware**: record with mic and system audio, camera bubble, export,
   library, auto-zoom on clicks (the native hook), update.

## Checklist before the first public beta

- [ ] `build:win` reproducible from CI (`release-desktop.yml`), not only from a laptop.
- [ ] Code signing for Windows, or an explicit SmartScreen warning walkthrough on the download
      page until a certificate exists. An unsigned installer is the objection ScreenKite uses
      against Recordly; do not repeat it silently.
- [ ] `rebuild:native` runs for `uiohook-napi` on the Windows runner (auto-zoom on clicks).
- [ ] Screenshot entry points hidden or disabled with a "coming soon" state on Windows, never a
      silent no-op.
- [ ] Version gate and auto-update verified against a Windows artifact.
- [x] Public roadmap row (`windowsBeta`, 2026-10-07): "recording first, screenshots next", so
      the gap is visible on purpose. Flip it to shipped when the first beta is downloadable.
- [ ] Landing: "Download for Windows (beta)" next to the macOS button, with the gap stated.

## Non-goals

- Feature parity before shipping. The beta label is the parity plan.
- Linux. Not until Windows is out of beta.

## Reopens when

Screenshots ship on Windows: drop the beta label, fold this page into `desktop/`.
