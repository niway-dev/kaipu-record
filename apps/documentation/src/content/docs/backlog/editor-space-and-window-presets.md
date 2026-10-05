---
title: "Editor space, window presets, and the menu-bar icon"
description: "What shipped alongside the mute work in #199: the video editor gives its width back to the timeline, the window is the user's except inside the video editor, and the macOS menu-bar icon follows the capture mode. Includes the decisions a reviewer will ask about and the one reversal driven by feedback."
---

# Editor space, window presets, and the menu-bar icon

> **Status: 🟢 Ready to validate — shipped in
> [#199](https://github.com/niway-dev/kaipu-record/pull/199) (2026-10-01).** Owner-verified by
> hand the same day on desktop. Not yet validated on a packaged build.

## The video editor gives its width back to the timeline

The editor spent its width on chrome the timeline needed more:

- **The title row is gone.** The recording's name moves to the window title — it is reference,
  never a control. The row's two live pieces (the ORIGINAL UNTOUCHED pill and the autosave
  state) moved into the toolbar, which already spanned the width. A leftover four-row grid for
  three children was fixed at the same time.
- **The drawing and camera tools are a vertical rail** beside the preview (`EditorToolRail`).
  Eight icons laid out horizontally claimed the full window width for a strip two icons tall.
  The rail scrolls rather than shrinking: a tool below its hit target is worse than one you
  scroll to. The hint, history, clip actions, status chips and Export stay in the top row.
- **The global nav sidebar was NOT narrowed.** That was briefly done by mistake and reverted:
  the ask was the editor's toolbar, and the nav captions were doing their job.

## The window belongs to the user; the video editor is the exception

### What was wrong first

An earlier cut gave every route its own window size and applied it on every navigation.
Record → Library → Settings → Library resized the window four times. External feedback named
why that is wrong: the app takes and releases desktop space on its own, a window placed beside
another app loses that arrangement, and a window the user deliberately enlarged gets reset.
_A screen having an ideal size does not mean it should impose it on arrival._ The feedback also
corrected the argument used for Library's minimum: that three cards fit at 1040 px does not
make 1040 the minimum — two legible cards in a smaller window beat forcing the user to enlarge.

### What shipped

- **One preset for every screen** — Record, Library, Screenshots, Shortcuts, Cloud, Settings,
  **and the screenshot editor** (its canvas and panel fit). Navigating among them never touches
  the window. Starting size 1040×760, minimum 900×670 — the minimum is what the UI needs, not the
  largest screen's.
- **The video editor is the single exception.** Entering it remembers the user's bounds and
  grows the window (1440×900, floor 1180×760 — below that the lanes stop being readable, not
  merely narrow). Leaving restores _exactly those bounds_, not a preset.
- **Resolved from the route, not from a page's mount.** The pages mount and unmount under a
  shell that does not, so a page growing the window on mount had nothing to shrink it back —
  that was the original "it stays huge" bug. `presetForPath` answers on every navigation; main
  ignores a repeat.
- **Routes are constants** (`src/shared/routes.ts`), used by the router, the sidebar and the
  preset table, so a rename is a compile error in all three.
- **The preset type carries an optional maximum. None is set, and a test holds that line.** A
  maximum stops a large display from being used; only a screen that genuinely breaks when
  wider should declare one. Main clears any previous maximum on every change.
- **Everything is clamped to the display's work area**, minimum included: a minimum larger
  than the screen leaves a window that can be neither moved nor shrunk.

### Not built

Remembering the window size **across restarts** (and validating it against the monitors
present at launch). Today the memory lives for the session.

### It grows from its centre (2026-10-05)

Entering the video editor used `setSize`, which keeps the top-left corner fixed: a window
placed in the middle of the screen stretched only right and down. It now grows around its
own centre (`boundsAroundCenter` in `shared/window-size.ts`) and slides back inside the
work area when that would cross an edge, keeping the size the editor needs. The onboarding
floor grows the same way. Leaving the editor still restores the exact bounds from before,
position included.

## The menu-bar icon follows the capture mode

Two template images, not three: the capture panel always has Record or Screenshot selected,
so there is no idle state to draw. The icon mirrors `PanelTabs`' selection through one IPC
(`tray:set-mode`); the panel's "capture" and the brand's "screenshot" vocabularies are mapped at
that single call site. The artwork is the owner's black cuts, rasterized at 20 px / 40 px and
verified pixel-by-pixel to be 100 % black-on-alpha, which is what `setTemplateImage` needs.
The old play-arrow tray art was the last place carrying the pre-fox brand.

## A rule learned the hard way

`apps/kaipu-record/src/shared/**` takes no **value** import from a workspace package. The preload
bundle externalizes workspace packages and cannot load their TypeScript; a value import there
failed the preload script, left `window.electronAPI` undefined, and opened the app to a black
window — with a green build, green types and 1,300 green tests. Now a rule in `CLAUDE.md`,
and the reason the shortcut accelerators are literals pinned by a test rather than an import.
