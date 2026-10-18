---
title: "Windows beta — recording first, screenshots later"
description: "Ship the working Windows build as a recording-only beta instead of waiting for screenshot parity. Owner decision 2026-09-27."
---

# Windows beta — recording first, screenshots later

> **Status: 🟡 In progress — beta downloadable, QA pending** (owner approved the direction 2026-09-27).
> Desktop 0.13.0 shipped the first Windows installer on 2026-10-18, unsigned, at
> `https://updates.kaipu.app/download/latest/kaipu-setup.exe`
> ([release](https://github.com/niway-dev/kaipu-record/releases/tag/desktop-v0.13.0)); the
> landing and /roadmap link to it. Owner QA on Windows hardware (design decision 10) starts
> on that build. Decision: ship what works as a labelled beta.
> Parent: [Product growth](./product-growth). **Design (2026-10-15):**
> [Windows release design](/specs/2026-10-15-windows-release-design/) and ADR 0023 turn the
> steps below into tickets; screenshots on Windows come from the
> [screenshot capture modes design](/specs/2026-10-15-screenshot-capture-modes-design/).
> **Per-capability state:** [Platform parity](/desktop/platform-parity/) lists what each
> platform runs and what is still unverified on Windows hardware.

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
2. **Screenshots say "coming soon".** _(Frame, Window and Screen all have Windows backends: Frame and Screen shipped in desktop
   0.12.0 (#306) and Window with [modes v2](/specs/2026-10-17-screenshot-modes-v2-design/); QA is pending on a Windows build.)_ Replace the silent `null` with a platform-aware state:
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
   library, auto-zoom on clicks (the native hook), update (including that the app relaunches
   after the update installs).

## Checklist before the first public beta

- [ ] `build:win` reproducible from CI (`release-desktop.yml`), not only from a laptop. 🟡 In progress: the `build-win` and `publish` jobs landed in the workflow; the first manual dispatch (owner) is still pending.
- [ ] Code signing for Windows, or an explicit SmartScreen warning walkthrough on the download
      page until a certificate exists. An unsigned installer is the objection ScreenKite uses
      against Recordly; do not repeat it silently.
- [ ] `rebuild:native` runs for `uiohook-napi` on the Windows runner (auto-zoom on clicks). 🟡 In progress: `build-win` runs it and fails on a stamp mismatch; unverified until the first dispatch.
- [ ] Screenshot entry points never a silent no-op on Windows. Frame, Window and Screen all have
      Windows backends (`desktopCapturer`; Frame and Screen in 0.12.0 (#306), Window in modes v2),
      so the entry points are enabled; the "Coming to Windows" state remains only as the
      `unsupported` toast of a provider that serves nothing. The tick waits for a packaged
      Windows build to QA all three modes.
- [ ] Version gate and auto-update verified against a Windows artifact.
- [x] Public roadmap row (`windowsBeta`, 2026-10-07): "recording first, screenshots next", so
      the gap is visible on purpose. The 2026-10-18 per-platform redesign (#316) retired the
      row: every roadmap row now carries its own Windows cell, and the /roadmap Windows section
      offers the beta download (2026-10-18). The cells stay `inProgress` until the owner's QA on
      Windows hardware (design decision 10) confirms each feature; they flip one by one, and
      [Platform parity](/desktop/platform-parity/) is the tracker for that.
- [x] Landing: "Download for Windows (beta)" next to the macOS buttons, with a one-line
      SmartScreen note ("More info", then "Run anyway"), shipped with desktop 0.13.0 on
      2026-10-18. The installer is unsigned; signing is being applied for (SignPath Foundation).

App behaviours on `feat/windows-release` (landed, unvalidated on Windows hardware):

- [ ] Per-platform shortcut defaults: `Control+Alt+<key>` on Windows, shown as `Ctrl+Alt+C`
      text labels rather than macOS glyphs. 🟡 Landed, unvalidated. Caveat: Ctrl+Alt is AltGr.
      On some layouts (Polish: ą ć ś ó ź) the default letters type accented characters, and a
      registered global hotkey takes them away from every app while Kaipu runs. Rebind the
      shortcut if that happens.
- [ ] Close hides to the tray. The first time, a native notification says Kaipu is still
      running and how to quit it. A second launch brings the running copy back (single
      instance) instead of starting another. 🟡 Landed, unvalidated.
- [ ] Quit: `Ctrl+Q` works only while the main window has focus; when the window is hidden in
      the tray, the tray menu's Quit is the way out. 🟡 Landed, unvalidated.
- [ ] Tray icon visible on a dark and a light taskbar (light-glyph `.ico` files). 🟡 Landed,
      unvalidated.

## Non-goals

- Feature parity before shipping. The beta label is the parity plan.
- Linux. Not until Windows is out of beta.

## Reopens when

Screenshots ship on Windows: drop the beta label, fold this page into `desktop/`.
