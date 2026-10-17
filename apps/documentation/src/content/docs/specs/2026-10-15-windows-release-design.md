---
title: Windows release — build it in CI, publish it to the same feed, ship the beta unsigned, sign without touching the workflow later
description: Design for shipping the Windows desktop build as a labelled beta — a Windows job in the existing release workflow, one publish job for both platforms, the NSIS installer and latest.yml on the R2 feed, platform-specific shortcut defaults and tray behaviour, an honest "coming soon" for screenshots, and a signing hook that stays a no-op until the owner has a signing service.
---

# Windows release — design

**Status: 🟡 In progress · 2026-10-16.** Implemented on `feat/windows-release`, PR pending;
first dispatch and owner tasks outstanding. Code tasks 1–6 are on the branch (CI jobs,
signing hook, shortcuts, close-to-tray, tray icon); task 7 and owner tasks 8–10 are not done,
and nothing has been validated on Windows hardware. Designed 2026-10-15. Executes the owner's decision in
[Windows beta — recording first, screenshots later](/backlog/windows-beta/) (2026-09-27) and
records what that page left open. Linear: parent ticket "Windows release" in the Kaipu
project, one child per task below; owner-only tasks carry the `owner` label. Screenshots on
Windows arrive through the [screenshot capture modes design](/specs/2026-10-15-screenshot-capture-modes-design/).

## Summary (one minute)

`bun run build:win` already produces an installer that records; nothing distributes it.
This design adds a **Windows job** to `release-desktop.yml` next to the macOS one, both
feeding a single **publish job** that uploads every artifact to R2 and the GitHub Release
once, so two parallel jobs never race on one draft release. The NSIS installer, its
blockmap and `latest.yml` land on the same `updates/` and `download/` prefixes the macOS
feed uses, so `electron-updater` on Windows works with the generic provider already
configured. The first beta ships **unsigned**: the download page explains the SmartScreen
"More info → Run anyway" click, and a **signing hook** (`scripts/sign-windows.cjs`) is wired
into electron-builder from day one but does nothing until signing secrets exist, so adding a
certificate later is a secrets change, not a workflow change. Its vendor entries are
validate-then-fail seams until the owner picks a vendor; implementing the chosen one is a
change to the hook only. The app gets the Windows
behaviours it lacks: per-platform **shortcut defaults** (the current `Command+Control+…`
means the Windows key), **close hides to the tray** instead of quitting (with a one-time
native notification at hide time), and a **tray icon that is visible on a dark taskbar**. (A fourth item, a screenshot button
that says **"Coming to Windows"**, is obsolete: screenshot modes v2 enables every capture mode
on Windows; see decision 8.) The landing gets a "Download for Windows
(beta)" button and the roadmap row flips when the installer is downloadable. The macOS E2E
suite remains the release gate; Windows is verified by build plus a manual QA checklist on
real hardware until there is a reason to pay for a Windows E2E lane.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                   | Why                                                                                                                                                                                                                                                  | ADR        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | One workflow, three jobs: `verify` → `build-mac` ∥ `build-win` → `publish`. Build jobs upload their `dist/` as workflow artifacts; `publish` (ubuntu) downloads both and does R2 + GitHub Release once.                                                                                                                                                                                                                                    | Two jobs each running `softprops/action-gh-release` with `draft: true` can create two drafts (drafts carry no tag to match on). One publisher, one release, one prune. Reuses ADR 0010's "checks in Actions" shape.                                  | 0023 (new) |
| 2   | `build-win` on `windows-latest`: checkout, Bun, `bash scripts/rebuild-native.sh`, `bun run build` with `MAIN_VITE_SERVER_URL`, `electron-builder --win --publish never`. No E2E on Windows.                                                                                                                                                                                                                                                | Git Bash and the MSVC toolchain are on the runner, so the existing scripts run unchanged; `uiohook-napi` rebuilds for Electron's ABI. ADR 0006 keeps the macOS E2E as the gate; a Windows lane is a cost with no user yet.                           | 0023       |
| 3   | The feed is shared: `updates/latest.yml`, `updates/<name>-<v>-setup.exe`, `.blockmap`; `download/<v>/kaipu-setup.exe`, `download/latest/kaipu-setup.exe`. Prune keeps working: `*-<v>-*` matches the exe too.                                                                                                                                                                                                                              | `electron-updater`'s generic provider reads `latest.yml` next to `latest-mac.yml` at the same URL; no second bucket, no second domain.                                                                                                               | 0023       |
| 4   | Ship the first beta unsigned, with a SmartScreen walkthrough on the download page. Signing is a hook (`win.signtoolOptions.sign: ./scripts/sign-windows.cjs`) that no-ops without `WIN_SIGN_*` secrets and prints a visible notice; its vendor entries are validate-then-fail seams until a vendor is picked.                                                                                                                              | The owner's recommendation in the backlog. Azure Artifact Signing admits individuals only in the US and Canada; the alternatives (SSL.com eSigner, Certum, DigiCert KeyLocker) are an owner purchase. The hook keeps the vendor out of the workflow. | 0023       |
| 5   | Shortcut defaults are per platform. macOS keeps `Command+Control+<key>`; Windows uses `Control+Alt+<key>`. `SHORTCUT_DEFINITIONS` carries `{ mac, win }` and main resolves by `process.platform`; the domain constant gains `.win`.                                                                                                                                                                                                        | Electron maps `Command` to the Windows key, which Windows reserves. `Control+Alt` is the conventional global-hotkey pair; `Control+Shift+<key>` collides with Chrome, Teams and Office in the focused app. Rebindable either way.                    | —          |
| 6   | Closing the main window on Windows hides it to the tray; the app keeps running like on macOS. A one-time native notification says so as the window hides; Quit lives in the tray menu and `Ctrl+Q` (focused window only). `window-all-closed` no longer quits on win32.                                                                                                                                                                    | A tray app that dies when its window closes loses the global shortcuts and the capture panel, which is the product. Same as Discord, Slack, ShareX.                                                                                                  | —          |
| 7   | Windows tray icon: a dedicated `.ico` with a light glyph (and a 32 px size); the macOS template PNGs stay macOS-only.                                                                                                                                                                                                                                                                                                                      | The current icons are black-on-alpha template images; on the default dark Windows taskbar they are invisible. `setTemplateImage` is a no-op there.                                                                                                   | —          |
| 8   | ~~Screenshot entry points on Windows render disabled with "Coming to Windows" from the `unsupported` answer of the capture contract (screenshot design, decision 2).~~ **Superseded:** screenshot modes v2 (decision 10) serves Screen, Frame and Window on Windows, so nothing is disabled there now; "Coming to Windows" survives only as the `unsupported` toast of a provider that serves nothing. Never hidden, never a silent no-op. | The backlog's checklist item. Hidden buttons make the beta look like it lacks the feature by design; a labelled disabled state keeps the roadmap honest.                                                                                             | —          |
| 9   | Landing: "Download for Windows (beta)" beside the macOS button, linking `download/latest/kaipu-setup.exe`; a short download page section with the SmartScreen steps; roadmap `windowsBeta` → `shipped` in the same PR as the first downloadable build.                                                                                                                                                                                     | The backlog's steps 6 and the roadmap row that already says "recording first, screenshots next".                                                                                                                                                     | —          |
| 10  | Manual QA on real Windows hardware before the roadmap flips: record with mic + system audio, camera bubble, auto-zoom on clicks (native hook), export, library, tray panel placement, update beta → beta+1.                                                                                                                                                                                                                                | The only verification Windows gets until a Windows E2E lane exists; it is listed so it cannot be skipped silently.                                                                                                                                   | —          |

### Open questions

1. **Signing vendor** (owner). Azure Artifact Signing is the cheapest ($9.99/month) but is
   not open to individuals outside the US and Canada as of the latest Microsoft Learn text.
   SSL.com eSigner and Certum (Open Source Code Signing) work from CI without hardware.
   Default if unanswered: the beta ships unsigned and the hook stays a no-op.
2. **Ctrl+Alt on Latin-American layouts.** `Control+Alt` is AltGr there. None of the seven
   default keys (C, S, O, X, M, A, K) produce a character with AltGr on the LatAm or Spanish
   layouts, but this was not tested on hardware. Default: keep `Control+Alt`, verify in QA,
   rebindable regardless.
3. **Per-machine vs per-user install.** NSIS default is one-click, per user, no admin prompt.
   Default: keep it; revisit when a managed-install request appears.

### Out of scope

- Linux (the backlog's non-goal).
- Feature parity before shipping; the beta label is the parity plan.
- A Windows Playwright lane (reopen condition in ADR 0023).
- Microsoft Store packaging (MSIX), winget manifests.
- Any change to the macOS job beyond moving its publish steps into the shared `publish` job.

### Failures this must protect against

1. **Two draft releases for one tag.** Only `publish` touches the GitHub Release; both build
   jobs upload artifacts and nothing else. A test on the workflow YAML (the repo already lints
   workflows) asserts no `gh-release` step outside `publish`.
2. **A tag with no Windows artifact silently published.** `publish` fails if either artifact
   download is empty (`if-no-files-found: error` on upload, an explicit `test -n` on download).
3. **`latest.yml` overwritten by `latest-mac.yml` or vice versa.** Different file names, same
   prefix; the copy uses explicit `--include` lists per platform and never `--recursive *`.
4. **Unsigned build shipped while secrets exist.** The sign hook fails the build if a
   signing variable (`WIN_SIGN_*`, `AZURE_*` from the workflow's list) is set while
   `WIN_SIGN_VENDOR` is empty, naming the variables; with a vendor set, any signing error (and,
   today, every vendor seam) fails the build. It only no-ops when none is set, and prints
   `::warning::Windows build is unsigned` so the run log says so.
5. **Shortcuts registered with `Command` on Windows.** `shortcut-defaults.test.ts` asserts no
   Windows default contains `Command` or `Super`, and that every action has a default on both
   platforms.
6. **Close quits on Windows.** A main-process test on the `close` handler with
   `process.platform` forced to `win32`: `preventDefault` + `hide`, and `app.quit` is not
   called from `window-all-closed`. The recording-in-progress and export-in-progress guards
   keep precedence.
7. **Update from beta N to N+1 fails on Windows.** QA step 10 installs beta N, publishes
   N+1 to a staging prefix, and watches the status banner reach `ready`.
8. **`rebuild:native` skipped on the Windows runner.** The job fails if
   `node_modules/.native-deps-electron-version` does not match the installed Electron after the
   rebuild step (same stamp the setup doctor reads).
9. **Tray icon invisible.** QA step 10 checks the icon on a dark and a light taskbar.

## 1. What exists today (checked 2026-10-15)

| Piece                                                         | State                                                                                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run build:win`                                           | Exists: `rebuild-native.sh` → `bun run build` → `electron-builder --win`. The owner has run it; the app records.                                                              |
| `electron-builder.yml`                                        | `win.executableName`, `nsis` (artifact `${name}-${version}-setup.${ext}`, shortcuts), `build/icon.ico` present, `npmRebuild: false`.                                          |
| `release-desktop.yml`                                         | `verify` (ubuntu) → `release-mac` (macos-latest): build, E2E, sign, notarize, R2 publish, prune, GitHub Release. No Windows job.                                              |
| Windows signing                                               | Nothing: no certificate, no secrets, no hook.                                                                                                                                 |
| Auto-updater (`main/updater/auto-updater.ts`)                 | `electron-updater`, generic provider `https://updates.kaipu.app/updates/`; platform-agnostic; the feed writer only uploads macOS files.                                       |
| Platform guards                                               | Dock policy, `type: "panel"`, `setLoginItemSettings`, permissions panes, click hook all branch on `win32`/`darwin` already.                                                   |
| Shortcut defaults (`shared/types/ipc.ts`)                     | `Command+Control+<key>` for all seven actions; `@kaipu/domain` has `DEFAULT_ACCELERATORS.mac` only.                                                                           |
| `window-all-closed` (`main/index.ts`)                         | `app.quit()` unless darwin.                                                                                                                                                   |
| Tray (`main/tray.ts`)                                         | Template PNGs (`tray-recording.png`, `tray-screenshot.png`) with `setTemplateImage(true)`.                                                                                    |
| Screenshot capture                                            | Returns `null` outside darwin (`main/screenshots/screenshot-ipc.ts`).                                                                                                         |
| Roadmap (`web-hono/src/components/roadmap/roadmap-config.ts`) | `windowsBeta: planned`.                                                                                                                                                       |
| Release automation                                            | release-please, component `desktop`, tag `desktop-v*`; hub page [release-automation](https://github.com/csdev19/general-knowledge/blob/main/monorepos/release-automation.md). |

## 2. What the state of the art does

- **electron-builder Windows signing**: `win.azureSignOptions` (publisherName, endpoint,
  certificateProfileName, codeSigningAccountName; env `AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET`),
  or `win.signtoolOptions.sign` for a custom script; EV hardware tokens do not work on hosted
  CI. Sources: [code-signing-win](https://www.electron.build/docs/features/code-signing/code-signing-win),
  [WindowsConfiguration](https://www.electron.build/app-builder-lib.interface.windowsconfiguration).
- **Azure Artifact Signing** (renamed from Trusted Signing): Basic $9.99/month for 5,000
  signatures; Public Trust for organizations in a list of regions, individuals only in the
  US and Canada. Sources: [product page](https://azure.microsoft.com/en-us/products/trusted-signing),
  [quickstart](https://learn.microsoft.com/azure/artifact-signing/quickstart),
  [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq),
  [Electron docs commit on availability](https://ayakael.net/mirrors/electron/commit/d1c2d06baebefda14fc1253b47a199435cb8baeb).
- **Cap** signs its Windows builds through SignPath's open-source program
  ([signpath.org/projects/cap](https://signpath.org/projects/cap)); an option once Kaipu is public
  under AGPL, with its own eligibility review.
- **Native deps on Windows runners**: the hub's
  [native-dependencies](https://github.com/csdev19/general-knowledge/blob/main/desktop/native-dependencies.md)
  pattern (explicit rebuild, stamp, every packaging path calls it) applies unchanged.

## 3. The workflow

```yaml
jobs:
  verify:        # unchanged
  build-mac:     # today's release-mac minus the R2/GitHub steps; uploads dist/ as `desktop-mac`
  build-win:
    needs: verify
    runs-on: windows-latest
    environment: production
    steps:
      - checkout, setup-bun 1.3.4, bun install --frozen-lockfile
      - run: bash scripts/rebuild-native.sh
      - run: bun run build            # env MAIN_VITE_SERVER_URL, same guard as mac
        working-directory: apps/kaipu-record
      - run: bunx electron-builder --win --publish never
        env: { WIN_SIGN_VENDOR, WIN_SIGN_* }   # absent → unsigned, with a ::warning::
      - upload-artifact: desktop-win  (dist/*-setup.exe, *.blockmap, latest.yml), if-no-files-found: error
  publish:
    needs: [build-mac, build-win]
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    environment: production
    steps:
      - download both artifacts; fail if either is empty
      - R2: updates/ (mac zip+blockmap+latest-mac.yml; win exe+blockmap+latest.yml)
            download/<v>/{kaipu-arm64.dmg,kaipu-x64.dmg,kaipu-setup.exe}, download/latest/…
      - prune (unchanged script; now sees the exe under download/<v>/)
      - softprops/action-gh-release once, draft+prerelease, with every file
```

Manual dispatch keeps today's behaviour: build jobs run, `publish` is skipped, both artifacts
stay as short-lived workflow artifacts.

## 4. The app changes

- `shared/types/ipc.ts`: `defaultAccelerator: { mac: string; win: string }`; `defaultShortcutsFor(platform)`
  in `shared/shortcut-defaults.ts`; the renderer receives resolved strings as it does now, and
  renders them as text labels (`Ctrl+Alt+C`) on Windows, glyphs on macOS.
  `packages/domain` gets `DEFAULT_ACCELERATORS.win`; `shortcut-defaults.test.ts` pins both.
- `main/index.ts`: on win32, `close` → `preventDefault` + `hide` + a first-time native
  notification shown at hide time (`trayHintShown` persisted once it was shown); `Ctrl+Q` quits
  while the main window has focus; the tray menu's existing "Quit" item (`tray.quit`) is the
  path when the window is hidden; `window-all-closed` quits only on linux. A single-instance
  lock makes a second launch bring the running copy's window back instead of starting a
  second process.
- `main/tray.ts`: `resources/tray-windows-recording.ico` and
  `resources/tray-windows-screenshot.ico` (light glyph) selected on win32; template PNGs
  unchanged on macOS.
- `scripts/sign-windows.cjs` + `electron-builder.yml` `win.signtoolOptions.sign`.
- Screenshot "coming soon" state comes from the capture contract (other spec, task 1).

## 5. Tasks (one Linear child each)

Code (agent-executable):

1. **Workflow: `build-win` job** — the job above, build-only, artifact upload, the
   `rebuild:native` stamp check. Prove it on a manual dispatch before any tag.
2. **Workflow: shared `publish` job** — move the R2 publish, prune and GitHub Release out of
   the macOS job into `publish`; add the Windows files; the workflow-lint assertion from
   "Failures" 1.
3. **Signing hook** — `scripts/sign-windows.cjs` (no-op + warning without secrets; fails loudly
   with secrets but no vendor, and on any signing error; vendor entries are seams), `electron-builder.yml` wiring, a unit test for the no-op branch.
4. **Per-platform shortcut defaults** — `{ mac, win }` in `SHORTCUT_DEFINITIONS`, domain
   `.win`, resolver, tests from "Failures" 5, the Shortcuts page shows the platform's default.
5. **Close to tray on Windows** — `close`/`window-all-closed` behaviour, Quit menu item, the
   one-time notification, the main-process test from "Failures" 6.
6. **Windows tray icon** — `.ico` asset derived from the brand source (see
   [app icon derivation plan](/plans/2026-10-07-app-icon-derivation/)), selection on win32.
7. **Landing and roadmap** — "Download for Windows (beta)" button, SmartScreen walkthrough
   section, roadmap flip. Blocked by the first tag that produces a downloadable exe.

Owner (manual, `owner` label):

8. **Decide and buy the signing service**; add `WIN_SIGN_VENDOR` and the vendor's secrets to the
   `production` environment (Azure: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
   plus the four `azureSignOptions` values; SSL.com: the eSigner credentials).
9. **Confirm the `production` environment is available to `build-win`** (it is scoped per
   environment, not per OS; verify `MAIN_VITE_SERVER_URL` and the R2 secrets resolve) and run
   the first manual dispatch.
10. **Manual QA on Windows hardware** per decision 10, including the beta → beta+1 update and
    the AltGr check from open question 2. Record results on the Windows beta backlog page.

Order: 1 → 2 → 9 → (3, 4, 5, 6 in parallel) → first tag → 7 and 10; 8 whenever the owner
decides, it changes nothing in code.

## 6. Sources and unverified claims

- Owner, 2026-10-15: "habilitar el release build para windows… aparte de habilitar el build en el
  pipeline algo más?"; "todo lo accionable de código… lo quiero; yo haré las configs manuales".
- Unverified: that `windows-latest` compiles `uiohook-napi` without extra toolchain steps (the
  first manual dispatch proves it); AltGr collisions on LatAm layouts; whether SignPath's
  open-source program would accept Kaipu.
