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

## Checklist before the first public beta

- [ ] `build:win` reproducible from CI (`release-desktop.yml`), not only from a laptop.
- [ ] Code signing for Windows, or an explicit SmartScreen warning walkthrough on the download
      page until a certificate exists. An unsigned installer is the objection ScreenKite uses
      against Recordly; do not repeat it silently.
- [ ] `rebuild:native` runs for `uiohook-napi` on the Windows runner (auto-zoom on clicks).
- [ ] Screenshot entry points hidden or disabled with a "coming soon" state on Windows, never a
      silent no-op.
- [ ] Version gate and auto-update verified against a Windows artifact.
- [ ] Public roadmap row: "Windows — screenshots" so the gap is visible on purpose.
- [ ] Landing: "Download for Windows (beta)" next to the macOS button, with the gap stated.

## Non-goals

- Feature parity before shipping. The beta label is the parity plan.
- Linux. Not until Windows is out of beta.

## Reopens when

Screenshots ship on Windows: drop the beta label, fold this page into `desktop/`.
