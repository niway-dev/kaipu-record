---
title: Screenshot modes v2 — Frame, Window and Screen picked inside the overlay; quiet capture with a toast
description: Second iteration of the screenshot modes. Area is folded into Frame, Window becomes a mode of its own on both platforms through the OS window list, the mode is switched inside the overlay with a pill attached to the selection, and a capture whose preferences already save or copy it never opens the editor — a small always-on-top toast says what happened and offers Annotate.
---

# Screenshot modes v2 — design

**Status: 🔵 Proposed · 2026-10-17.** Iterates on the
[capture modes design](/specs/2026-10-15-screenshot-capture-modes-design/) that shipped in
desktop 0.12.0 (PR #306). Where the two differ this one wins; that spec keeps the contract,
the geometry and the overlay mechanics that stay. ADR: [0024](/architecture/decisions/0024-window-mode-and-quiet-capture/)
amends [0022](/architecture/decisions/0022-screenshot-capture-native-where-the-os-has-it/).
Design file: Claude Design "Kaipu Screenshot Modes v2" (states Page, Windows, Recording, Tray,
Overlay · Frame, Window, Screen, Copied). Linear: one parent ("Screenshot modes v2") with one
child per task in section 6. The Windows half of every task needs the Windows build from the
[Windows release design](/specs/2026-10-15-windows-release-design/) before it can be QA'd.

## Summary (one minute)

0.12.0 ships three modes chosen on the page or in the tray before the overlay opens: Area
(Apple's own drag on macOS, our drag on Windows), Screen and Frame. The owner used it and
asked for three changes. **Area goes away: Frame does the drag now.** The box can be drawn
fresh by dragging on the dim sheet, resized by its handles, and still remembers its spot per
display, so one mode covers "any rectangle" and "the same rectangle again". **Window becomes a
mode**: hovering highlights a window, clicking captures it, on macOS and on Windows alike. Main
asks the OS for the list of on-screen windows (macOS through a tiny JavaScript-for-Automation
call to `CGWindowListCopyWindowInfo`, Windows through a PowerShell script over `EnumWindows`
and `DwmGetWindowAttribute`), the overlay does the hit-testing and the highlight, and the pixels
come from `screencapture -l <windowId>` on macOS and the window source of `desktopCapturer` on
Windows — the window itself, not the screen around it. **The mode is picked inside the
overlay**: a vertical pill attached to the right edge of the selection (or a row inside the
Screen card) switches between Frame, Window and Screen with a click or the keys 1–3, and the
mode used to capture becomes the current one. The page and the tray keep one Capture button
and a row of chips; a chip opens the overlay straight in that mode. **The selection carries an action bar**: Capture (Enter) and Copy (⌘C, Ctrl+C on Windows), with a seat
reserved for Record, because recording a display or a selection is the next feature and will reuse this
overlay. Capture opens the editor unless saving is automatic; then main saves (and copies, if copying is
automatic too) and shows a small always-on-top toast on the display where the shot was taken: "Saved to
Library", size and mode, Annotate and Open in Library, gone after 6 seconds. Copy always finishes
quietly: clipboard, vault only when saving is automatic, the same toast saying "Copied to clipboard".
The editor opens only when someone still has to decide what to do with the shot.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                                                                                                                 | ADR        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Three modes: `frame`, `window`, `screen`. `area` is removed; a stored `"area"` migrates to `"frame"`, and `frame` is the default. Frame gains drag-to-draw on the sheet.                                                                                                                                                                                                                                                                  | Area and Frame were the same gesture with different memory. One box that can be redrawn or kept does both; a fourth entry in a pill of three is noise.                                                                                                                                                                                              | 0024 (new) |
| 2   | **Window mode runs on our overlay on both platforms.** Main lists on-screen windows through an OS tool with no native module (macOS: `osascript -l JavaScript` + `CGWindowListCopyWindowInfo`; Windows: PowerShell + `EnumWindows`/`DwmGetWindowAttribute`), the overlay highlights and answers a window id plus its rect.                                                                                                                | The design shows one highlight style on both OSes and the pill must work in every mode; Apple's `-w` picker would close our overlay and lose the pill. Measured here 2026-10-17: the macOS listing runs in 30 ms inside a 50 ms process. No native dependency, per the repo rule.                                                                   | 0024       |
| 3   | Window pixels are the window's own: macOS `screencapture -l <id> -o -x`; Windows the `window:<hwnd>` source of `desktopCapturer` at the window's physical size. A screen crop at the window rect is the fallback when the source is missing or empty.                                                                                                                                                                                     | Both capture the window even where another window covers it, which is what "capture this window" means. The fallback keeps the mode working on a machine where window capture fails, at the cost of showing what is on top.                                                                                                                         | 0024       |
| 4   | The mode is switched **inside the overlay**: a pill attached to the selection (Frame box, highlighted window) or a row in the Screen card; keys 1–3; the answer carries the mode and that mode becomes `screenshotMode`. Esc leaves the previous mode untouched.                                                                                                                                                                          | Choosing a mode while looking at the screen is how the native pickers work; picking it beforehand on a page cost a capture every time it was wrong. Remembering only on capture keeps a cancelled experiment from changing the shortcut's meaning.                                                                                                  | —          |
| 5   | Page and tray: one Capture button (current mode) plus a chip row Frame · Window · Screen; a chip opens the overlay in that mode. The 0.12.0 cards go.                                                                                                                                                                                                                                                                                     | The design's "one button, three chips". Chips that only selected (0.12.0) made people press twice.                                                                                                                                                                                                                                                  | —          |
| 6   | **The overlay's action decides, then the preferences.** The selection carries Capture (Enter) and Copy (⌘C / Ctrl+C). Capture opens the editor unless `screenshotSave` is `auto`, in which case main saves, copies if `screenshotCopy` is `auto`, shows the toast and never opens the editor. Copy always finishes quietly: clipboard, vault only if `screenshotSave` is `auto`, toast. The main window returns to its pre-capture state. | The owner: "if saving is on, it just saves and the window does not show" and "when we choose Copy, that's it". The explicit Copy is the per-shot "finish on the clipboard" the owner first asked for as a key; the preferences carry the rest. The editor is for deciding or annotating, and when that is already decided there is nothing to show. | 0024       |
| 7   | The **capture toast** is one frameless, always-on-top `BrowserWindow` (`?window=capture-toast`) at the top-right of the work area of the display the shot came from: thumbnail, title ("Copied to clipboard" / "Saved to Library"), `W × H · Mode`, Annotate, Open in Library or Save to Library, auto-hide 6 s, hover pauses.                                                                                                            | Same pattern as the camera bubble; a toast inside the main window would force that window on screen, which is exactly what quiet capture avoids. CleanShot X's quick-access overlay is the reference.                                                                                                                                               | —          |
| 8   | Annotate opens the editor on the saved vault item (`local` source) when the shot was saved, or on the bytes main kept for the toast's lifetime (`blob` with `origin: "quiet"`) when it was only copied. The editor runs no auto action for `origin: "quiet"`.                                                                                                                                                                             | A second auto-save on Annotate would duplicate the Library row; a second copy would re-encode what is already on the clipboard.                                                                                                                                                                                                                     | —          |
| 9   | Shortcuts: `captureScreenshot` captures with the current mode; `captureWindow` is new (`Command+Control+W`, `Control+Alt+W`); `captureScreen` and `captureFrame` stay.                                                                                                                                                                                                                                                                    | One generic key plus one per mode, as the design labels them. Area had no key of its own, so none is lost.                                                                                                                                                                                                                                          | —          |
| 10  | Nothing is disabled on Windows. The design's "Frame isn't available on Windows yet" note is stale: 0.12.0 already serves Screen and Frame there, and Window gets its Windows lister in this design.                                                                                                                                                                                                                                       | A disabled state would hide a backend that exists. Real-hardware QA, not a label, is what is missing, and it is blocked by the Windows build.                                                                                                                                                                                                       | —          |
| 11  | Analytics: `screenshot_captured` gains `after: "editor" \| "quiet"` and the `window` mode value. No titles, no window names.                                                                                                                                                                                                                                                                                                              | The owner wants to know whether quiet capture is the common path before investing further in the toast.                                                                                                                                                                                                                                             | —          |
| 12  | **Record has a reserved seat in the action bar.** The bar is `Capture · Copy · Record (soon)`; `OverlayAnswer.action` is `"capture" \| "copy"` today and `"record"` later. The overlay is the one picker for "this display or this selection" that the recording feature will reuse.                                                                                                                                                      | The owner: recording a display and a selection is the next feature; building its picker twice would be the mistake. Reserving the seat costs one disabled button and one union member.                                                                                                                                                              | —          |

### Open questions

1. **Windows window-list latency.** PowerShell with `Add-Type` is estimated at 300–800 ms cold.
   The overlay opens at once and highlights when the list arrives; if the list takes more than
   800 ms on the first Windows build, replace the script with a native module behind the same
   `WindowLister` port (the escape hatch ADR 0024 names).
2. **Window titles on macOS.** `kCGWindowName` of other apps is only filled with Screen
   Recording permission, which the app has, but the listing runs in a child `osascript` process
   and TCC attribution to the parent app is unverified. The label falls back to the owner name
   ("Safari") when the title is empty; QA confirms which one shows.
3. **⌘C for Copy, or ⌘B.** The owner first said ⌘B; the action bar uses ⌘C because inside the overlay
   the app owns the keyboard and C is what everyone presses to copy. One constant to change if the owner
   prefers B.
4. **The toast while the app is hidden.** `beforeCapture` hides the app's windows before the
   overlay opens; the toast must still show. If the hook turns out to use `app.hide()` on macOS,
   the toast is shown after `afterCapture` restores the app, which must not bring the main
   window forward. Verified in task 6.

### Out of scope

- Area as a mode, or a native picker of any kind (Apple's `-i`/`-w` chrome is no longer used).
- Scrolling capture, OCR, timers, magnifier, freeze, in-overlay annotation.
- A window chooser as a grid of thumbnails.
- Changing the editor's tools, the vault layout, or the Library.
- Recording through the overlay. The Record seat is reserved and disabled; the recording picker is its
  own design.
- Linux.

### Failures this must protect against

Each line is a test in the implementation plan; the 0.12.0 list still applies.

1. **Kaipu's own windows in the Window list.** The lister drops windows owned by this process
   (by pid on both OSes; on Windows only, Electron's `getNativeWindowHandle` HWNDs are a second
   filter — on macOS that handle is an `NSView*`, not a CGWindowID, so it cannot match), so the
   overlay, the toast and the hidden main window can never be picked.
2. **The window list arrives late or never.** The overlay is usable in Frame and Screen at
   once; Window shows the sheet and a "Finding windows…" hint until the list lands, and a
   lister that throws or times out (2 s) answers an empty list, not a stuck overlay.
3. **A stored `"area"` mode.** Settings merge maps it to `"frame"`; the generic shortcut and
   the page button capture with Frame; no `unsupported` and no crash.
4. **Quiet save writes exactly one vault item.** With `screenshotSave: auto`, the capture is
   saved once by main; pressing Annotate opens that item and the editor does not save again.
5. **Copy-only bytes outlive the toast's auto-hide while Annotate is in flight.** Main keeps
   the last quiet capture until the next capture starts or Annotate has handed it to the editor,
   whichever comes first; auto-hide alone never frees it.
6. **A new capture replaces the toast.** One toast window, re-targeted; two toasts never stack.
7. **The main window never jumps to the editor on a quiet capture.** `afterCapture` restores it
   where it was (hidden stays hidden, the Screenshots page stays the Screenshots page).
8. **Window bounds on Windows are physical pixels.** They are converted with
   `screen.screenToDipRect` before reaching the overlay; a 150 % display highlights the right
   window, and the mixed-DPI fixtures from 0.12.0 gain a window case.
9. **A window spanning two displays.** macOS `-l` and the Windows window source capture it
   whole; the crop fallback clamps to the display under the pointer and the test asserts the
   clamp, never a stitch.
10. **Mode switched then cancelled.** `screenshotMode` is unchanged after Esc; it changes only
    with a `captured` answer.
11. **Keys 1–3 and Enter during a drag.** A key press mid-drag ends the drag first; no half
    box survives a mode switch.
12. **A hotkey mashed twice, a display unplugged, a recording in progress, onboarding without a
    main window.** Exactly the 0.12.0 guards, re-run for every mode including Window.
13. **Copy with saving manual never writes the vault; Copy with saving automatic writes it once.** The
    toast says which happened ("Not saved yet" with a Save button, or "Also saved to your Library").

## 1. What exists today (desktop 0.12.0)

- `src/shared/types/screenshot-capture.ts`: `CAPTURE_MODES = ["area", "screen", "frame"]`,
  `CaptureResult` (`captured | cancelled | unsupported`), `OverlayAnswer` (`rect | display |
cancelled`), `OverlayState` (`hoverDisplayId`, `frameDisplayId`).
- `src/main/screenshots/screenshot-capture.ts`: `MacProvider` (Area via `screencapture -i -o -x`,
  Screen and Frame via the overlay then `-R`), `WindowsProvider` (every mode via the overlay then
  `desktopCapturer` + `cropForDisplay`), `runWithOverlay` (choose → hideAll → settle → capture →
  destroyAll), `UnsupportedProvider`.
- `src/main/screenshots/capture-overlay-windows.ts` + `overlay-port.ts`: one `BrowserWindow` per
  display, `pick(ui, displays)`, `hideAll()` with the hidden-ack round trip, `destroyAll()`,
  Esc in main, watchdog, `display-removed`.
- `src/renderer/src/features/screenshots/overlay/`: `capture-overlay.tsx` with `AreaDrag`,
  `ScreenChooser`, `FrameBox` (eight handles, per-display memory in `AppSettings.screenshotFrame`,
  "click another display to move the frame there"); `overlay-query.ts` parses
  `?window=capture-overlay&display&ui&index&count&bounds&work&ids&frame`.
- `capture-mode-buttons.tsx` (page hero and tray rows: cards select, the button captures),
  `use-screenshot-mode.ts` (`AppSettings.screenshotMode`, default `"area"`),
  `use-supported-capture-modes.ts` (disabled state with "Coming to Windows").
- `use-screenshot-capture.ts`: `captured` → `openCapture(blob)` → editor; the editor runs
  `autoActionsOnOpen(screenshotSave, screenshotCopy, openKind)` once on open
  (`auto-capture-policy.ts`), saving through `screenshot:save` and copying through
  `screenshot:copy`.
- Shortcuts in `@kaipu/domain` `constants/shortcuts.ts`: `captureScreenshot`
  (`Command+Control+X` / `Control+Alt+X`), `captureScreen` (`…+Shift+X`), `captureFrame`
  (`Command+Control+Shift+F` / `Control+Alt+Shift+F`).
- Floating-window patterns: `recording/camera-bubble-window.ts` (frameless, transparent,
  always-on-top, `skipTaskbar`, `setVisibleOnAllWorkspaces` with `visibleOnFullScreen`),
  `capture-panel-window.ts`; render targets in `renderer/src/main.tsx` (`?window=`).
- Channels in `desktop/ipc-contract.mdx` § Screenshots.

## 2. What the state of the art does

- **macOS `screencapture`** (checked with `screencapture -h` on this machine, 2026-10-17):
  `-w` only window selection, `-W` start in window selection, `-l <windowid>` capture that
  window, `-o` no shadow, `-R` rect, `-x` silent. `-l` is what this design uses; `-w` is the
  rejected alternative (ADR 0024).
- **`CGWindowListCopyWindowInfo`** through JavaScript for Automation returns id, owner, name,
  bounds and layer for every on-screen window with no native code. Probe on this Mac,
  2026-10-17: `ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(…)))` listed the
  on-screen windows in 30 ms; the whole `osascript -l JavaScript` process took 50 ms.
- **Electron `desktopCapturer`**: window sources have id `window:<handle>:<flag>` and the
  window title as name, with no bounds; thumbnails are the capture and `thumbnailSize` the
  resolution lever ([DesktopCapturerSource](https://electronjs.org/docs/latest/api/structures/desktop-capturer-source),
  [desktopCapturer](https://electronjs.org/docs/api/desktop-capturer)). Bounds therefore come
  from the OS list, keyed by the same handle.
- **Window bounds on Windows**: `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` gives the
  visible frame without the drop shadow, with `GetWindowRect` as the fallback
  ([Cyotek](https://www.cyotek.com/blog/getting-a-window-rectangle-without-the-drop-shadow),
  [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/537117/when-using-gdi-to-capture-the-window-image-and-sav)).
  WebRTC's WGC capturer skips `WS_EX_TOOLWINDOW` windows
  ([libwebrtc](https://asuth.searchfox.org/firefox-main/source/third_party/libwebrtc/modules/desktop_capture/win/wgc_capturer_win.h));
  the lister skips them too, plus cloaked (`DWMWA_CLOAKED`) and invisible ones.
- **CleanShot X** shows a quick-access overlay after every capture with view, annotate, copy
  and share, and lets the user choose whether a capture opens the editor, is copied or is
  saved to a folder ([Setapp](https://setapp.com/apps/cleanshot),
  [TheSweetBits](https://thesweetbits.com/tools/cleanshot/)). The capture toast is that overlay
  reduced to the two actions Kaipu has.

## 3. The contract (changes only)

```ts
// src/shared/types/screenshot-capture.ts
export const CAPTURE_MODES = ["frame", "window", "screen"] as const; // pill order = keys 1–3
/** What the user pressed in the action bar. "record" joins when the recording picker lands. */
export type CaptureAction = "capture" | "copy";

/** One on-screen window as the overlay sees it (display-relative DIP). */
export interface ListedWindow {
  id: string;        // macOS CGWindowID, Windows HWND, both as decimal strings
  title: string;     // window title, or the owner name when the title is empty
  ownerName: string;
  displayId: number; // the display holding the window's centre
  rect: CaptureRect; // display-relative DIP, clamped to that display
}

export type OverlayAnswer =
  | { kind: "rect"; mode: "frame"; action: CaptureAction; displayId: number; rect: CaptureRect }
  | { kind: "display"; mode: "screen"; action: CaptureAction; displayId: number }
  | { kind: "window"; mode: "window"; action: CaptureAction; displayId: number; windowId: string; rect: CaptureRect }
  | { kind: "cancelled" };

export interface OverlayState {
  mode: CaptureMode;            // the mode every overlay renders right now
  hoverDisplayId: number | null;
  frameDisplayId: number | null;
  windows: ListedWindow[] | null; // null until the lister answers; [] when it found none
}

/** Main → toast window. */
export interface CaptureToastPayload {
  thumbnail: string;            // data URL, ≤ 160 px wide
  width: number; height: number; mode: CaptureMode;
  saved: { id: string } | null; // vault item when saved
  copied: boolean;
}
```

- New channels: `screenshot:overlay-mode` (overlay → main, `{ mode }`: re-render every overlay
  in that mode; entering Window triggers the lister if not yet run), `screenshot:toast-show`
  (main → toast), `screenshot:toast-action` (toast → main, `annotate | open-library | save |
dismiss`). `screenshot:overlay-state` grows as above.
- `OverlayPort.pick(ui, displays)` keeps its signature; `ui` is the initial mode. The port gains
  `setWindows(list)` so main can push the list once it has it.
- A new port `WindowLister { list(displays: Display[]): Promise<ListedWindow[]> }` in
  `src/main/screenshots/window-lister.ts` with `MacWindowLister` (osascript JXA),
  `WindowsWindowLister` (PowerShell), and the pure `toListedWindows(raw, displays, self: { pids; handles })`
  that filters, converts to DIP and assigns displays. Tests inject fake raw lists.

### Backends per mode

| Mode   | macOS (`MacProvider`)                                              | Windows (`WindowsProvider`)                                                          |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| frame  | overlay → `screencapture -R x,y,w,h -x` (unchanged)                | overlay → display source + `cropForDisplay` (unchanged)                              |
| window | overlay → `screencapture -l <id> -o -x`; fallback `-R` at the rect | overlay → `getSources({ types: ["window"] })` matching `window:<id>:`; fallback crop |
| screen | overlay card → `-R <display.bounds>` (unchanged)                   | overlay card → display source (unchanged)                                            |

The provider branches on `answer.mode`, not on the requested mode: the pill may have changed it.

### After-capture policy (main)

```ts
// src/main/screenshots/after-capture-policy.ts (pure)
export type AfterCapture = { open: "editor" } | { open: "quiet"; save: boolean; copy: boolean };
export function decideAfterCapture(
  action: CaptureAction,
  save: ScreenshotSaveMode,
  copy: ScreenshotCopyMode,
): AfterCapture {
  if (action === "copy") return { open: "quiet", save: save === "auto", copy: true };
  if (save === "manual") return { open: "editor" };
  return { open: "quiet", save: true, copy: copy === "auto" };
}
```

The provider result carries the answer's `action`. Quiet: main writes the vault through the same function the `screenshot:save` handler uses
(title `Screenshot — <date>`, `manual: false`), copies the PNG with `clipboard.writeImage`,
shows the toast, and answers the renderer `{ kind: "captured", after: "quiet" }` so the hook
does nothing but `revealAfterCapture()` to its previous state. Editor: unchanged path.

### The overlay

- `CaptureOverlay` renders by `state.mode`: `FrameBox` (now also draws a new box from a drag on
  the sheet; first use shows a box of 60 % of the work area, centred), `WindowPicker` (hit-tests
  `state.windows` front to back under the pointer, draws the highlight and the title label,
  click answers), `ScreenCard` (number, name, `W × H · Built-in/External`, "Capture this
  display" with the number key, and the mode row).
- `ModePill`: vertical, attached 10 px right of the selection's top-right corner, flips to the
  left when it would leave the display; Frame · Window · Screen with 1/2/3 badges, a divider and
  a Cancel (Esc) button. In Screen the same three live in the card's bottom row.
- `ActionBar`: horizontal, attached 10 px below the selection's bottom-left corner (above it when
  there is no room): Capture (accent, Enter), Copy (⌘C / Ctrl+C), a divider, and a disabled Record · soon.
  In Screen it is the card's button row (Capture · n, Copy) plus a "Record this display · soon" line.
  Enter and ⌘C work without the bar being hovered; the bar never covers the selection.
- Hint pill at the bottom: "Enter to capture" (Frame) or "Click or Enter to capture" · "⌘C to copy" ·
  "1–3 switch mode" · "Esc to cancel".
- Single display and initial mode Screen: capture at once, as 0.12.0 does. Switching to Screen
  inside the overlay always shows the card.

### The toast

`src/main/screenshots/capture-toast-window.ts`: one lazily created `BrowserWindow`
(`frame: false, transparent: true, alwaysOnTop: true ("floating"), skipTaskbar: true,
hasShadow: false, focusable: false, resizable: false`, `setVisibleOnAllWorkspaces(true,
{ visibleOnFullScreen: true })`), 380 × 150 DIP, positioned at the top-right of
`display.workArea` with an 18 px margin, `?window=capture-toast` in `main.tsx`. `show(payload)`
re-targets and restarts the 6 s timer; pointer-over pauses it; the × and Esc-less dismiss hide
it. Actions go back over `screenshot:toast-action`; Annotate navigates the main window to
`/editor/image/:id` (saved) or `/editor/capture` with the kept bytes (copy-only) and reveals it;
Open in Library navigates to `/library/:id`; Save to Library (copy-only toast) saves and turns
the button into Open in Library.

## 4. Platform notes

- **macOS lister**: `osascript -l JavaScript -e <script>` with `kCGWindowListOptionOnScreenOnly |
kCGWindowListExcludeDesktopElements`, keep `kCGWindowLayer === 0`, drop our pid, drop windows
  under 50 × 50 pt. Bounds are global points (DIP) already; `-l` needs the same
  `kCGWindowNumber`. Menu bar and Dock are layer ≠ 0 and fall out naturally.
- **Windows lister**: `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command`
  with an `Add-Type` P/Invoke block: `EnumWindows` (z-order, front first), `IsWindowVisible`,
  `GetWindowTextW`, `GetWindowThreadProcessId`, `GetWindowLongPtr(GWL_EXSTYLE)` to drop
  `WS_EX_TOOLWINDOW`, `DwmGetWindowAttribute(DWMWA_CLOAKED)` to drop cloaked, and
  `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` with `GetWindowRect` fallback. Output one
  JSON line per window. Bounds are physical pixels: `screen.screenToDipRect(null, rect)` on the
  main side. The script is started in parallel with the overlay windows.
- **Permissions**: nothing new on macOS (Screen Recording already covers `screencapture` and
  `desktopCapturer`; see open question 2 for titles). Nothing on Windows.
- **Hiding the app** before capture is unchanged; the toast is created after the capture and is
  the one window allowed to appear while the main window stays hidden.

## 5. Settings and migration

- `AppSettings.screenshotMode` default becomes `"frame"`; the merge maps any unknown or legacy
  value (`"area"`) to `"frame"`.
- `AppSettings.screenshotFrame` is unchanged.
- No new preference. Settings → Screenshots gains one sentence under the two existing toggles:
  "When either is on, captures skip the editor and show a small notification instead."

## 6. Tasks (one Linear child each)

1. **Modes v2 contract and Frame absorbs Area** — `CAPTURE_MODES` reorder, `OverlayAnswer`
   with `mode`, migration `area → frame`, default `frame`, `captureWindow` shortcut action with
   both defaults (pinned by `shortcut-defaults.test.ts`), remove `AreaDrag` and the `-i` path,
   `FrameBox` drag-to-draw on the sheet and the 60 % default box. Tests first on the migration,
   the provider branch and the drag.
2. **Window lister** — `WindowLister` port, `MacWindowLister` (osascript JXA),
   `WindowsWindowLister` (PowerShell), pure `toListedWindows` with fixtures (own pid dropped,
   tool/cloaked dropped, physical → DIP on a 150 % display, centre-based display assignment, a
   window spanning two displays), 2 s timeout → `[]`, timing log at debug level.
3. **Overlay v2** — `OverlayState.mode`/`windows`, `screenshot:overlay-mode`, `ModePill`,
   `WindowPicker` with highlight and label, `ScreenCard` per the design, `ActionBar` (Capture, Copy,
   disabled Record) with Enter and ⌘C, the answer's `action`, keys 1–3, "Finding windows…" hint, mode
   remembered on capture only. Component tests for every keyboard path.
4. **Window capture backends** — macOS `-l <id> -o -x` with `-R` fallback; Windows window source
   at physical size with crop fallback; provider tests with injected deps. _Windows half
   blocked by the Windows build._
5. **Quiet capture in main** — `decideAfterCapture(action, save, copy)` (pure), vault write and
   clipboard copy from main, `captured.after`, the renderer hook's quiet path, `origin: "quiet"` skipped by
   `autoActionsOnOpen`, kept bytes lifecycle (failure 5), analytics `after`.
6. **Capture toast window** — `capture-toast-window.ts`, `?window=capture-toast` target, the
   React toast from the design (thumbnail, title, meta line, Annotate, Open/Save to Library,
   footer, 6 s with hover pause), re-target on a new capture, visibility while the main window is
   hidden (open question 4), `screenshot:toast-action` handlers.
7. **Page, tray, settings copy, docs** — one button plus chips on the page and in the tray
   (chips open the overlay in that mode), the Settings sentence, i18n strings, `desktop/ipc-contract.mdx`
   rows, backlog rows and the QA lists (macOS and Windows) extended with Window and quiet capture.

Order: 1 → 2 ∥ 3 ∥ 5 → 4 (after 2 and 3) and 6 (after 5) → 7. Windows QA for 2, 4 and 6 waits
for the Windows release workflow.

## 7. Sources and unverified claims

- Owner, 2026-10-17: "quitamos area solo será frame"; "agregamos windows: si seleccionamos una
  app que se seleccione, así hace mac"; "cuando estamos guardando … se guarda y tenemos un
  widget que avisa que está en portapapeles … si la opción de guardar está pues directamente se
  guarda pero no se muestra la ventana"; after the design update: "cuando elijamos copiar y ya"; later the same day: "faltan los botones
  mientras estamos seleccionando … es la siguiente feature: para grabación haremos que sea pantalla y
  también selección", which put the Capture · Copy · Record bar on the selection.
- Claude Design "Kaipu Screenshot Modes v2" (read 2026-10-17): modes Frame/Window/Screen with
  the shortcuts above, pill on the selection, Screen card with the mode row, chips on page and
  tray, "Copied to clipboard" toast with Annotate, Open in Library and "Auto-hides in 6 s · Also
  saved to your Library". Its "Frame isn't available on Windows yet" note was stale (decision 10) and was removed when the action bar
  was added to the file on 2026-10-17.
- Verified here: `screencapture` flags (`-h`), the JXA window listing and its timing.
- Unverified: PowerShell listing latency (open question 1); TCC attribution of window titles in
  a child process (open question 2); whether `desktopCapturer` window sources on Windows capture
  occluded regions on every supported Windows version (QA with the first Windows build); the
  toast's visibility while the app is hidden (open question 4).
