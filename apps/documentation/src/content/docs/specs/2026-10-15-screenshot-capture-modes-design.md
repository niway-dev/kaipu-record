---
title: Screenshot capture modes — area, full screen and frame; native where the OS has it, our overlay where it does not
description: Design for three screenshot modes (drag an area, capture one display, capture what is inside a resizable frame) behind one capture contract, with a per-platform backend — macOS keeps the system `screencapture` binary, Windows captures through desktopCapturer — and a shared overlay window that draws the frame and the display chooser on every display.
---

# Screenshot capture modes — design

**Status: 🟢 Shipped in desktop 0.12.0 (PR #306, 2026-10-17) · Windows QA pending.** Amended by
[screenshot modes v2](/specs/2026-10-17-screenshot-modes-v2-design/) (Area folded into Frame, Window mode,
mode picked inside the overlay, quiet capture with a toast). **Proposed 2026-10-15.** Supersedes section 3 ("Capture engine") of the
[screenshots brief](/backlog/screenshots/) where they differ: the "mac-only, Path A behind a
seam" decision becomes "native where the OS has it, our overlay where it does not", and the
seam grows from one method to a mode request. Linear: parent ticket in the Kaipu project
("Screenshot capture modes"), one child per task below. The Windows side depends on the
[Windows release design](/specs/2026-10-15-windows-release-design/).

## Summary (one minute)

Today a screenshot means one thing: the global shortcut runs Apple's `screencapture -i`, the
user drags an area, the PNG opens in the image editor. Outside macOS the handler returns
`null` and nothing happens. This design adds two modes and makes all three work on Windows.
**Area** stays the drag the user knows. **Screen** captures one whole display: with one display
it captures at once, with several every display shows a translucent sheet and the user clicks
the one they want (or presses its number). **Frame** shows a resizable rectangle with eight
handles that remembers its last size and position; the user adjusts it, presses Enter or
clicks Capture, and gets exactly what was inside. The renderer asks for a mode; main picks the
backend for the platform. On macOS the pixels always come from the system `screencapture`
binary (`-i` for Area, `-R x,y,w,h` for Screen and Frame): pixel-perfect, Retina and color
handled by the OS. On Windows the pixels come from Electron's `desktopCapturer` at the
display's native resolution, cropped by a tested pure function. The overlay window — one
frameless, transparent, always-on-top window per display — is the same React code on both
platforms and only ever answers "this rectangle on this display" or "cancelled". A mode the
platform cannot serve answers `unsupported`, never `null`, so the UI can say "coming soon"
instead of doing nothing. Every mode opens the same image editor and obeys the same auto-save
and auto-copy settings.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ADR        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Three modes: `area` (drag), `screen` (one display), `frame` (resizable rectangle, remembered). Window capture is out of scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | What the owner asked for, and what Cap, CleanShot and ShareX all ship as their first three. Window capture is free inside Apple's `-i` (space bar) and a later mode elsewhere.                                                                                                                                                                                                                                                                                                | —          |
| 2   | The capture contract is a **request**: `capture({ mode })` resolves `captured` (PNG + size), `cancelled`, or `unsupported`. Never `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Today's `null` on Windows is a silent no-op the backlog already flagged. A typed `unsupported` lets the capture panel and the Screenshots page show a disabled "coming to Windows" state and lets the beta ship before every mode works.                                                                                                                                                                                                                                      | 0022 (new) |
| 3   | **Native where the OS has it.** macOS: `screencapture -i -o -x` for Area, `screencapture -R x,y,w,h -x` for Screen and Frame. Windows: `desktopCapturer.getSources` at `display.size × scaleFactor`, cropped in main.                                                                                                                                                                                                                                                                                                                                                                                                                              | Apple's binary handles Retina, color profiles, multi-display and the interactive picker better than anything we can draw; it is the native path. Windows has no CLI with a completion signal (the Snipping Tool's `ms-screenclip:` writes to the clipboard and never answers), so Chromium's capture is the native path there.                                                                                                                                                | 0022       |
| 4   | **One overlay, shared.** A frameless, transparent, always-on-top `BrowserWindow` per display (`?window=capture-overlay&display=<id>`) draws the Frame handles and the Screen chooser. It returns a DIP rectangle plus a display id; it never captures.                                                                                                                                                                                                                                                                                                                                                                                             | The overlay is UI, the backend is pixels. Keeping them apart is what lets macOS use `-R` and Windows use `desktopCapturer` behind the same screen. Same render-target pattern as the control bar and camera bubble (`main.tsx`).                                                                                                                                                                                                                                              | 0022       |
| 5   | The overlay is **live**, not frozen: the desktop stays interactive-looking under a dim sheet. On confirm, main hides every overlay, waits one frame, captures, then destroys them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Apple's `-i`, Windows Snipping Tool and ShareX's region picker are live. Freezing costs a full-resolution capture of every display at open (the capture-panel-latency doc already measured that cost for thumbnails). Freeze stays a later option, not a different design.                                                                                                                                                                                                    | —          |
| 6   | Frame geometry is per display and clamped to it; a frame cannot span displays. Last size and position are remembered per display id in `AppSettings.screenshotFrame`. One frame at a time: it starts on the display under the pointer (else the primary), and the other displays offer "click to move the frame here".                                                                                                                                                                                                                                                                                                                             | A cross-display crop needs two captures stitched at two scale factors; nothing the owner asked for needs it. Remembering the frame is the point of the mode (repeatable shots of the same spot).                                                                                                                                                                                                                                                                              | —          |
| 7   | Screen mode with one display captures immediately; with several, each overlay shows "Capture this display · 1/2/3" and hover highlights; click or the number key captures that display.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | The chooser is in situ, where the user is already looking; the tray panel is a 300 px popover with no room for a thumbnail picker. ShareX's "monitor menu" and CleanShot's per-display sheet work the same way.                                                                                                                                                                                                                                                               | —          |
| 8   | Entry points: one current mode app-wide (`AppSettings.screenshotMode`, default Area, remembered). The capture panel's Capture tab and the Screenshots page show a primary `Capture · <mode>` button plus the three modes (Area, Screen, Frame) as rows or cards; clicking a mode only makes it current (it never captures; the button and shortcuts capture, per the owner on 2026-10-17, overruling the mock's one-click capture). Three global shortcut actions: `captureScreenshot` captures with the current mode (Area if the platform cannot serve it); `captureScreen` and `captureFrame` are new, rebindable, and make their mode current. | One button cannot carry three modes without a submenu nobody discovers, and three equal buttons leave no default for the generic shortcut; the Claude Design "Kaipu Screenshot Modes" mock settled on one current mode the page, the tray and the shortcut share. Shortcuts follow the existing `SHORTCUT_DEFINITIONS` shape; defaults per platform are decided in the Windows design (Frame is `Command+Control+Shift+F`: `Command+Control+F` is macOS "Enter Full Screen"). | —          |
| 9   | Crop math and DPI math are pure functions in `src/shared` or `src/main/screenshots`, tested against mixed-DPI fixtures (100% + 150%, Retina 2×, a display left of the origin), and tolerant of `desktopCapturer` returning a size other than the one requested.                                                                                                                                                                                                                                                                                                                                                                                    | Every multi-monitor screenshot tool's bug list is DPI arithmetic (EShot 3.0.2, KDE 368939). The docs say the thumbnail "may not match the requested size", so the crop scales by the actual image size, never by the requested one.                                                                                                                                                                                                                                           | —          |
| 10  | Analytics: one `screenshot_captured` event with `mode`, `platform`, `displays` and `outcome` (`captured`, `cancelled`, `unsupported` or `failed` for a provider throw); no pixels, no coordinates.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | The owner wants to know which mode people use before investing in window capture or freeze.                                                                                                                                                                                                                                                                                                                                                                                   | —          |

### Open questions

1. **Windows shortcut defaults.** Decided in the Windows design (its decision 5); this spec
   only adds two actions. The new actions default to `Command+Control+Shift+X` (Screen) and
   `Command+Control+Shift+F` (Frame) on macOS. Frame avoids `Command+Control+F` because macOS
   uses it for "Enter Full Screen" and a global registration would steal it from every app
   (changed 2026-10-16). The domain package's Windows column carries
   `Control+Alt+Shift+X` and `Control+Alt+Shift+F`, unvalidated like the rest of that column; the
   desktop app only reads the macOS defaults until the Windows release branch lands.
2. **Overlay latency.** Creating one window per display on demand is estimated at 100–250 ms.
   If a packaged build measures above 300 ms on the Mac mini, prewarm one hidden overlay per
   display the way the capture panel is prewarmed (and apply the open-only Space toggle from
   the hub's floating-windows page).
3. **Frame on macOS: `-R` vs cropping our own capture.** `-R` is chosen (decision 3). If a
   user reports color drift between Area and Frame shots, compare both against a known PNG
   before switching.

### Out of scope

- Window capture as a mode of its own (Apple's `-i` already offers it with the space bar).
- A frozen backdrop, magnifier, pixel-color readout, or in-overlay annotation toolbar.
- Scrolling capture, OCR, timer capture.
- Linux. The overlay is portable, but nothing is tested there and the Windows beta comes first.
- Changing the editor, the vault layout, the auto-save/auto-copy policy, or the Library.

### Failures this must protect against

Each line is a test in the implementation plan.

1. **The overlay is in the shot.** Capture runs only after every overlay reports hidden and one
   animation frame has passed. A fixture with a visible overlay must fail the capture step.
2. **Off-by-scale crops.** A 100 px frame on a 150% display yields 150 physical pixels; on a 2×
   Retina display 200; on a display at `x: -1920` the crop origin is relative to that display's
   bounds, not the primary's.
3. **`desktopCapturer` returns a different size than requested.** The crop uses
   `image.size / display.size` as the scale, so a 1920×1080 answer for a 2560×1440 request still
   crops the right region at lower resolution instead of the wrong region.
4. **A second request while one is in flight** (hotkey mashed, two panel clicks) returns
   `cancelled` for the second without touching the first; the existing re-entrancy guard stays.
5. **Cancel never strands the app hidden.** Esc, a display disconnecting, or the overlay
   crashing restores the main window exactly as `afterCapture(false)` does today.
6. **A display disconnects while the overlay is up.** `screen.on("display-removed")` cancels the
   request and destroys the orphan overlay.
7. **Windows never answers `null`.** The handler's platform switch is exhaustive; a platform with
   no backend for a mode answers `unsupported`, and the capture panel renders the disabled state.
8. **The frame never spans displays** and never leaves the display's work area after a
   resolution change: a remembered frame that no longer fits is re-clamped, not dropped.
9. **Recording in progress blocks every mode**, exactly as the existing hook does for Area.
10. **The hotkey during onboarding or sign-in** (no main window) does what Area does today:
    recreate the hidden window first. Covered by manual QA, no unit test: the path lives in
    `main/index.ts`, which is not unit-testable (see the QA lines in the
    [screenshots brief](/backlog/screenshots/)).

## 1. What exists today

- `src/main/screenshots/screenshot-capture.ts` — `ScreenshotCaptureProvider.captureInteractive()`
  implemented by `MacNativeProvider` (`screencapture -i -o <tmp>`); `createScreenshotProvider()`
  always returns it.
- `src/main/screenshots/screenshot-ipc.ts` — `screenshot:capture` with the only platform guard
  (`process.platform !== "darwin" → null`), the re-entrancy flag, and `CaptureWindowHooks`
  (`beforeCapture` hides the app and the camera bubble, `afterCapture` restores, `reveal`).
- `src/renderer/src/features/screenshots/use-screenshot-capture.ts` — blocks while recording,
  calls `captureScreenshot()`, opens the editor with `openCapture`, then `revealAfterCapture()`.
- Entry points: the capture panel's single Capture button, the Screenshots page button, the
  `captureScreenshot` global shortcut (`Command+Control+X`), the `screenshot:hotkey` broadcast.
- Reusable pieces: `recording-sources.ts` (`desktopCapturer` with `display_id`),
  `recording/captured-display.ts` (`pickCapturedDisplay`), the crop math in
  `features/screenshots/annotations/crop.ts` and `handles.ts`, the transparent window patterns in
  `capture-panel-window.ts`, `control-bar-window.ts` and `camera-bubble-window.ts`, and the
  render-target switch in `renderer/src/main.tsx`.
- Docs: [screenshots brief](/backlog/screenshots/) (Path A / Path B),
  [Windows beta](/backlog/windows-beta/) (screenshots out of the beta, "never a silent no-op"),
  [capture panel latency](/backlog/capture-panel-latency/).

## 2. What the state of the art does

- **Cap** (Tauri + Rust, `scap`): screenshot mode captures "a display, window, or selected
  area"; a dedicated editor follows. Sources: [cap.so/llms-full.txt](https://cap.so/llms-full.txt),
  [github.com/CapSoftware/cap](https://github.com/CapSoftware/cap).
- **CleanShot X**: All-in-One, Area, Fullscreen, Window, Scrolling, OCR; the area picker can
  freeze the screen and shows a magnifier. Sources:
  [TechRadar review](https://www.techradar.com/reviews/cleanshot-x-for-mac-review),
  [Setapp listing](https://setapp.com/apps/cleanshot).
- **ShareX**: Fullscreen, Active window, Active monitor, Monitor menu, Region, Last region,
  Custom region; Print Screen = full screen, Ctrl+Print Screen = region. Source:
  [ShareX shortcuts](https://tutorialtactic.com/blog/sharex-shortcuts/). "Last region" and
  "Custom region" are the Frame mode here.
- **Electron**: `desktopCapturer` runs in main only; thumbnails are the capture and
  `thumbnailSize` is the resolution lever; the size "may not match the requested size"; each
  source carries `display_id` matching `screen.getAllDisplays()`. Sources:
  [desktopCapturer](https://electronjs.org/docs/latest/api/desktop-capturer),
  [DesktopCapturerSource](https://www.electronjs.org/docs/latest/api/structures/desktop-capturer-source),
  [Taking desktop screenshots in Electron v35](https://yal.cc/electron-desktop-screenshots/).
- **DPI pitfalls** reported by other tools: wrong crops when geometry is DIP and pixels are
  physical, regressions on 125%/150% monitors. Sources:
  [EShot 3.0.2 notes](https://newreleases.io/project/github/Benoks/EShot/release/v3.0.2),
  [KDE bug 368939](https://bugs.kde.org/show_bug.cgi?id=368939).
- **macOS `screencapture`** (checked on this machine, 2026-10-15): `-i` interactive, `-R<x,y,w,h>`
  rect, `-D<display>` display, `-x` silent, `-o` no shadow, `-C` cursor, `-T` delay.

## 3. The contract

```ts
// src/shared/types/screenshot-capture.ts (preload-reachable: literals only)
export type CaptureMode = "area" | "screen" | "frame";

export type CaptureResult =
  | { kind: "captured"; png: ArrayBuffer; width: number; height: number; mode: CaptureMode }
  | { kind: "cancelled" }
  | { kind: "unsupported"; mode: CaptureMode; platform: NodeJS.Platform };
```

- `captureScreenshot(mode)` replaces the argument-less call in `electron-api.ts`; the hotkey
  broadcast carries the mode. The renderer hook maps `captured` to `openCapture` exactly as now,
  `cancelled` to nothing, `unsupported` to a toast that names the platform.
- Main: `ScreenshotCaptureProvider` becomes `{ capture(request: CaptureRequest): Promise<CaptureResult> }`
  with `CaptureRequest = { mode, overlay: OverlayPort }`. `createScreenshotProvider(platform)`
  returns `MacProvider` on darwin, `WindowsProvider` on win32, `UnsupportedProvider` elsewhere.

### Backends

| Mode   | macOS (`MacProvider`)                                          | Windows (`WindowsProvider`)                                                 |
| ------ | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| area   | `screencapture -i -o -x <tmp>` (unchanged)                     | overlay drag → `captureRect(display, rectDip)` via `desktopCapturer` + crop |
| screen | overlay chooser → `screencapture -R <display.bounds> -x <tmp>` | overlay chooser → `desktopCapturer` source for `display_id`, no crop        |
| frame  | overlay frame → `screencapture -R <rect> -x <tmp>`             | overlay frame → `captureRect`                                               |

`captureRect` on Windows: `getSources({ types: ["screen"], thumbnailSize: { width: display.size.width × scaleFactor, height: display.size.height × scaleFactor } })`,
pick the source whose `display_id` matches, then `cropForDisplay(image, display, rectDip)`
(pure, tested) → `nativeImage.crop` → PNG buffer. The function derives the scale from the
image it actually received.

### The overlay port

As built in `src/main/screenshots/overlay-port.ts`:

```ts
interface OverlayPort {
  /** Show one overlay per display in `ui` mode; resolve with the user's answer. */
  pick(ui: "area" | "screen" | "frame", displays: Display[]): Promise<OverlayAnswer>;
  /** Hide every overlay; resolves once they are off screen (hidden, one tick, one renderer frame, 250 ms cap). */
  hideAll(): Promise<void>;
  /** Destroy every overlay and end the session; safe to call twice. */
  destroyAll(): void;
}
type OverlayAnswer =
  | { kind: "rect"; displayId: number; rect: CaptureRect /* DIP, display-relative */ }
  | { kind: "display"; displayId: number }
  | { kind: "cancelled" };
```

`pick` never hides or destroys on its own; the provider calls `hideAll()` before grabbing
pixels and `destroyAll()` in a `finally`.

Implemented by `CaptureOverlayWindows` in `src/main/screenshots/capture-overlay-windows.ts`:
one `BrowserWindow` per display with `frame: false, transparent: true, resizable: false,
movable: false, skipTaskbar: true, hasShadow: false, enableLargerThanScreen: true`,
`setAlwaysOnTop(true, "screen-saver")`, bounds = `display.bounds`; on macOS `type: "panel"` and
the open-only `setVisibleOnAllWorkspaces` toggle from the hub's floating-windows page, so the
overlay opens over a full-screen app without blanking the menu bar. Esc anywhere cancels all.
`hideAll()` resolves after every window's `hide` plus one `setTimeout(0)` and a
`requestAnimationFrame` round-trip in the renderer, which is what "waits one frame" means in
decision 5.

Renderer: `?window=capture-overlay&display=<id>&ui=<mode>&index=<n>&count=<n>&bounds=<x,y,w,h>&work=<x,y,w,h>&ids=<id,id,...>[&frame=<id>]` (built by `overlayQuery`; `bounds` and `work` are absolute DIP, `ids` is the ordered display list so the digit keys agree across overlays; `frame` is Frame-only: the display that starts with the frame, so the first paint is right) in `main.tsx`, a `CaptureOverlay`
component in `features/screenshots/overlay/` with three children: `AreaDrag`, `ScreenChooser`,
`FrameBox` (reusing `clampCrop`, `moveCrop`, `resizeCrop`, `hitCropHandle` from
`annotations/crop.ts`). It talks to main over two channels: `screenshot:overlay-answer`
(renderer → main) and `screenshot:overlay-state` (main → every overlay: `{ hoverDisplayId, frameDisplayId }`, so the
chooser highlights only one display and only one display shows the frame), plus
`screenshot:overlay-frame-display` (renderer → main) to move the frame.

### Entry points and shortcuts

- `SHORTCUT_ACTIONS` gains `captureScreen` and `captureFrame`; `SHORTCUT_DEFINITIONS` gains the two
  rows (group `app`), and `shortcut-defaults.test.ts` pins them against `@kaipu/domain`.
- One current mode (decision 8): `AppSettings.screenshotMode`, default `"area"`. The capture
  panel's Capture tab renders a primary `Capture · <mode>` button and three rows; the
  Screenshots page renders the same model as a hero with three cards (both are
  `CaptureModeButtons`). Clicking a card or row only makes that mode current; it does not capture.
  `captureScreenshot` captures with the current mode (Area when the platform cannot serve it);
  `captureScreen` and `captureFrame` make their mode current and capture. The tray menu gains
  nothing (unchanged).
- `IPC_CHANNELS.screenshotHotkey` payload becomes `{ mode }`; `screenshotRequestCapture` too.

## 4. Platform notes

- **macOS permissions.** `screencapture` and `desktopCapturer` both need Screen Recording; the
  app already asks for it in onboarding. No new prompt.
- **Windows DPI.** Electron is per-monitor-DPI aware; `display.bounds` and `display.scaleFactor`
  are per display. The overlay uses DIP bounds; only `captureRect` touches physical pixels.
- **Windows transparent windows.** `transparent: true` requires `frame: false`; the overlay body
  background is `rgba(0,0,0,0.25)` so it stays clickable (a fully transparent region does not
  receive clicks on Windows). The control bar already uses this shape.
- **Hiding the app** before capture reuses `CaptureWindowHooks` unchanged; the overlay is
  created after `beforeCapture()` so the main window is never under it.

## 5. Tasks (one Linear child each, independently executable)

1. **Contract and providers** — `CaptureMode`/`CaptureResult`, `capture(request)` on the
   provider, `MacProvider` (area via `-i`, rect via `-R`), `WindowsProvider` skeleton returning
   `unsupported` for every mode, `UnsupportedProvider`, the exhaustive handler switch, preload +
   `electron-api.ts`, the renderer hook mapping the three results, tests for each provider with
   injected deps (as `screenshot-capture.test.ts` does today). After this task Windows shows a
   toast instead of nothing.
2. **Crop and DPI math** — `cropForDisplay(imageSize, display, rectDip)` and
   `physicalSizeFor(display)` in `src/main/screenshots/capture-geometry.ts`, pure, with the
   mixed-DPI fixtures from "Failures" 2 and 3. No Electron imports.
3. **Overlay windows (main)** — `CaptureOverlayWindows` with per-display creation, `type: "panel"`
   on macOS, Esc, `display-removed`, `hideAll()` with the frame wait, destroy on settle; mocked
   `BrowserWindow` tests as the hub page lists (created with the panel options, Space toggle only
   on show/hide).
4. **Overlay renderer** — render target in `main.tsx`, `CaptureOverlay` with `ScreenChooser`
   and `FrameBox` (handles, dimensions label, Enter/Capture, remembered geometry through
   `AppSettings.screenshotFrame`), `AreaDrag`; component tests for the keyboard paths.
5. **Screen and Frame on macOS** — wire `MacProvider` to the overlay port and `-R`; manual QA
   checklist on one and two displays, one Retina.
6. **Windows backend** — `WindowsProvider.captureRect` and display capture through
   `desktopCapturer`, using task 2; the area drag on Windows. Blocked by the Windows release
   design's CI job (needs a Windows build to QA on).
7. **Entry points, shortcuts, analytics, docs** — three buttons in the panel and on the
   Screenshots page, two new shortcut actions, the `screenshot_captured` event, the IPC contract
   table in `desktop/ipc-contract.mdx`, and the backlog rows (screenshots brief section 3 marked
   superseded, Windows beta "coming soon" row flipped when task 6 ships).

Order: 1 → 2 → 3 → 4 → 5; 6 after 4 and after the Windows CI job; 7 last. Tasks 2, 3 and 4
can run in parallel once 1 has merged.

## 6. Sources and unverified claims

- Owner, 2026-10-15: "quiero un screenshot de toda la pantalla actual con un selector de
  pantalla, y también un cuadro de selección para capturar lo que hay dentro, con un selector
  condicional para cuando usemos en Windows"; confirmed the frame reading ("exacto") and
  "cada uno tiene su forma nativa de hacerlo".
- Unverified: overlay creation latency (open question 2); `desktopCapturer` color fidelity
  against `screencapture` on the same display (open question 3); whether a Windows transparent
  window at 175% scaling receives clicks on its dim sheet (QA item in task 6).
