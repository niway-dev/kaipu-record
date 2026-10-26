---
title: Record capture modes — implementation plan
description: Working plan for recording an area or a display picked on the capture overlay — contract, compositor crop, cursor normalization, recording shade, camera bubble anchoring, overlay intent and the recordArea shortcut. The shipping PR deletes it.
---

# Record capture modes — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a rectangle drawn on the capture overlay (or a display picked there), cropped in the recording compositor, with a dark shade outside it while recording.

**Architecture:** The overlay answers a rectangle with a new action (`record` or `select`); main stores it as `RecordingSettings.area` next to the display's `screen:` source, so the existing start path is unchanged; the engine crops that area out of the full-display track on the compositor canvas; main shows a click-through shade and anchors the camera bubble inside the area; the cursor tracker normalizes to the area.

**Tech Stack:** Electron main + preload, React renderer, mediabunny/WebCodecs, Vitest, oxfmt/oxlint.

**Spec:** `apps/documentation/src/content/docs/specs/2026-10-26-record-capture-modes-design.md` · ADR 0030.

**Scope of this plan:** spec tasks 1–4 and 6, plus the entry points that make the feature reachable without the widget redesign: the overlay Record button in both intents and the `recordArea` shortcut. Spec task 5 (widget and Record page layout) waits for the Claude Design file.

## Implementation refinement of spec decision 1

The spec's `RecordingTarget` union is realised as **`RecordingSettings.area: RecordingArea | null`** beside the existing `selectedSource`:

- display target → `selectedSource` = that display's `screen:<id>` source, `area = null` (exactly today's full-screen path);
- area target → `selectedSource` = that display's `screen:<id>` source named "Area · W × H", `area` set;
- window target → unchanged (`selectedSource` from the picker, `area = null`).

Picking a source in the thumbnail picker clears `area`. Same behaviour as the union, no migration, and decision 11 (display and window paths unchanged) holds by construction. Task 6 updates decision 1 in the spec to say so.

## Global Constraints

- No native module; macOS and Windows share every code path (ADR 0030).
- `apps/kaipu-record/src/shared/**` takes no value import from a workspace package (repo `CLAUDE.md`).
- Every new floating window on macOS: `type: "panel"` and `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })` (ADR 0029).
- Minimum area: 64 × 64 DIP. Encoded dimensions are even (`fitToCap`).
- `recordArea` defaults: mac `Command+Control+Shift+R`, windows `Control+Alt+Shift+R`.
- Shade: dim `rgba(0, 0, 0, 0.6)` outside, 1.5 px border in the overlay's pink, content-protected, click-through.
- Copy: English and Spanish strings in `packages/i18n/messages/{en,es}.json`; Spanish neutral.
- Tools in the worktree: pinned binaries only (`node_modules/.bin/*`), never `bunx`. No local desktop E2E.

## Review Focus

1. A Retina (2×) or 150 % display: the area crop must cover exactly the selected pixels — pinned by `cropForSize` tests with 2× and 1.5× sizes (Task 1).
2. Picking a thumbnail source after an area was set must record the whole source, not the old area — pinned by the `selectSource` test (Task 2).
3. Camera toggled on mid-take with an area too small for the bubble: the bubble must stay hidden — pinned by the `CameraBubbleWindow` anchor test (Task 4).
4. `recordArea` or the overlay Record button while a take runs: refused with the "already recording" notification, take untouched — pinned in Task 5's main routing test.
5. A display unplugged between the pick and the start: the start must not fall back to another display — `selectArea` resolves no source and leaves settings untouched (Task 5 test).

---

### Task 1: Shared contract, geometry and settings

**Files:**
- Modify: `apps/kaipu-record/src/shared/types/ipc.ts` (types `RecordingArea`, `RecordingSettings.area`, `RecordingStartInfo.area`, `AppSettings.recordingArea`, default `{}`)
- Modify: `apps/kaipu-record/src/shared/types/screenshot-capture.ts` (`CaptureIntent`, `CaptureAction`, `CaptureRequestPayload.intent`)
- Modify: `apps/kaipu-record/src/shared/capture-geometry.ts` (`cropForSize`, `MIN_AREA_SIZE`)
- Modify: `apps/kaipu-record/src/main/services/settings.service.ts` (`recordingArea` merged with `mergeScreenshotFrames`)
- Test: `shared/capture-geometry.test.ts`, `main/services/settings.service.test.ts`

**Interfaces — Produces:**
- `interface RecordingArea { displayId: number; rect: CaptureRect /* display-relative DIP */; displaySize: { width: number; height: number } /* DIP */ }`
- `RecordingSettings.area: RecordingArea | null` (hub default `null`); `RecordingStartInfo.area?: RecordingArea | null`
- `AppSettings.recordingArea: Record<string, CaptureRect>` — the overlay's per-display memory in record intent.
- `type CaptureIntent = "capture" | "record"`; `CaptureAction = "capture" | "copy" | "record" | "select"`; `CaptureRequestPayload { mode: CaptureMode; intent?: CaptureIntent }`
- `cropForSize(imageSize: Size, displaySize: Size, rectDip: Rectangle): Rectangle` — `cropForDisplay` delegates to it.
- `MIN_AREA_SIZE = 64`

- [ ] **Step 1: Failing tests** — `cropForSize({3024,1964},{1512,982},{100,50,640,360})` → `{200,100,1280,720}`; at 1.5× (`{2880,1620}` over `{1920,1080}`) a `{10,10,101,101}` rect → `{15,15,152,152}`; `cropForDisplay` results unchanged (existing tests stay green). `mergeSettings({ recordingArea: { "1": {x:0,y:0,width:640,height:360}, "2": "junk" } }).recordingArea` → only key `"1"`; missing → `{}`.
- [ ] **Step 2:** `node_modules/.bin/vitest run src/shared/capture-geometry.test.ts src/main/services/settings.service.test.ts` (from `apps/kaipu-record`) → FAIL.
- [ ] **Step 3:** Implement the types and functions above.
- [ ] **Step 4:** Same command → PASS; `bun run check-types` in `apps/kaipu-record` → clean (fix every `RecordingSettings` literal the compiler names by adding `area: null`).
- [ ] **Step 5:** Commit `feat(desktop): recording area contract and crop geometry`.

### Task 2: Engine crop and the renderer start path

**Files:**
- Create: `apps/kaipu-record/src/renderer/src/features/recording/area-crop.ts` (+ test)
- Modify: `renderer/src/features/recording/recorder-engine.ts`, `recording-compositor.ts`, `recorder-store.ts`, `hooks/use-recording-setup.ts`
- Modify: `shared/types/electron-api.ts`, `preload/index.ts` (`cursorTrackStart(sessionId, sourceId, area?)`)

**Interfaces:**
- Consumes: `RecordingArea`, `cropForSize`, `fitToCap`.
- Produces: `areaEncodePlan(trackSize: Size, area: RecordingArea, capHeight: number): { source: Rect; target: Size }`; `EngineOptions.area?: RecordingArea`; `StartInput.area?: RecordingArea | null`; `startRecordingCompositor(stream, target, watermark, frameRate, sourceRect?: Rect)`.

- [ ] **Step 1: Failing tests** — `areaEncodePlan({3024,1964}, {rect:{100,50,640,360}, displaySize:{1512,982}}, 1080)` → source `{200,100,1280,720}`, target `{1280,720}`; with cap 720 and a 1281×721 physical crop → even target ≤ 720 high; `use-recording-setup`: after `update({ area })`, `selectSource(windowSource)` sends `{ selectedSource, area: null }`; `startRecording` passes `area` into `StartInput` when set.
- [ ] **Step 2:** Run the two test files → FAIL.
- [ ] **Step 3:** Implement. Engine: with `options.area`, compute the plan from the measured track size, always run the compositor with `sourceRect`. Compositor: when `sourceRect` is set, draw that rectangle (fit into target as today); otherwise unchanged. Recorder store: `recordingStart({ sourceId, sourceName, area })` and `cursorTrackStart(id, sourceId, area)`.
- [ ] **Step 4:** Tests → PASS; existing `recorder-engine.test.tsx` and `recorder-store.test.ts` green unchanged (failure 8: no area ⇒ no compositor without watermark/resize).
- [ ] **Step 5:** Commit `feat(desktop): crop a recording area in the compositor`.

### Task 3: Cursor track normalized to the area

**Files:**
- Modify: `main/recording/captured-display.ts` (+ test), `main/recording/recording-hub.ts` (cursorTrackStart handler), `shared/cursor-track.ts` (optional `region`), `main/recording/cursor-tracker.ts` / `build-cursor-track.ts` (carry `region`)

**Interfaces:**
- Produces: `areaCapturedDisplay(display: CapturedDisplay, area: RecordingArea): CapturedDisplay & { region: { displayId: string; x: number; y: number } }` — bounds = area rect moved to global DIP; `CursorTrack.region?: { displayId: string; x: number; y: number }`.

- [ ] **Step 1: Failing tests** — display bounds `{1512,0,1512,982}`, area `{100,50,640,360}` → bounds `{1612,50,640,360}`, region `{displayId,x:100,y:50}`; a tracker built on it serializes the pointer at the area's centre as (0.5, 0.5) and a pointer left of the area as x < 0; `track.display` = `{width:640,height:360}`; parser accepts a track with and without `region`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; the hub uses `areaCapturedDisplay` when the IPC brings an area whose `displayId` matches the resolved display, else the display as today. **Step 4:** PASS. **Step 5:** Commit `feat(desktop): normalize the cursor track to a recorded area`.

### Task 4: Recording shade and camera bubble anchoring

**Files:**
- Create: `main/recording/recording-shade-window.ts`, `main/recording/area-geometry.ts` (+ tests)
- Create: `renderer/src/features/recording-shade/recording-shade.tsx` + `.module.css` (+ test)
- Modify: `renderer/src/main.tsx` (`?window=recording-shade&rect=x,y,w,h`), `main/recording/camera-bubble-window.ts`, `main/recording/recording-hub.ts`, `main/recording/floating-window-policy.test.ts`

**Interfaces:**
- Produces: `areaToGlobal(area: RecordingArea, displayBounds: Rect): Rect`; `bubbleBoundsInArea(areaGlobal: Rect, size = 224, margin = 40): Rect | null` (bottom-left inside; null when `size + 2·margin` exceeds either side); `RecordingShadeWindow.show(display: Display, rect: CaptureRect)` / `hide()`; `CameraBubbleWindow.anchorTo(areaGlobal: Rect | null)`.

- [ ] **Step 1: Failing tests** — `bubbleBoundsInArea({0,0,640,360})` → `{40,96,224,224}`; `{0,0,300,300}` → null. Shade window options pinned: `focusable:false`, `setIgnoreMouseEvents(true)`, `setContentProtection(true)`, panel + flag on darwin. Bubble: anchored to a too-small area, `show()` leaves it hidden; anchored to a fitting area, it moves there; `anchorTo(null)` restores the default corner. Shade renderer: the clear box sits at the query rect.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; hub `recordingStart` with `info.area` shows the shade on the area's display and anchors the bubble; stop, `forceReset` and abort hide the shade and `anchorTo(null)`. **Step 4:** PASS. **Step 5:** Commit `feat(desktop): shade outside a recorded area and keep the camera inside it`.

### Task 5: Overlay intent, Record action and the recordArea shortcut

**Files:**
- Modify: `main/screenshots/capture-overlay-windows.ts` (`pick(ui, displays, intent)`, `overlayQuery(..., intent)`, `parseAction` accepts the four actions)
- Modify: `main/screenshots/overlay-port.ts`, `screenshot-capture.ts` (`ProviderResult` kind `record`), `capture-handler.ts` (`onRecordTarget` dep), `screenshot-ipc.ts`, `main/index.ts`
- Modify: `main/recording/recording-hub.ts` (`selectArea`), `renderer/.../overlay/overlay-query.ts`, `overlay-keys.ts`, `capture-overlay.tsx`, `frame-box.tsx`, `screen-card.tsx`, `selection-chrome.tsx`, `use-screenshot-capture.ts`, the AppShell hotkey listener, `preload/index.ts`, `shared/types/electron-api.ts`
- Modify: `packages/domain/src/constants/shortcuts.ts`, the desktop `SHORTCUT_DEFINITIONS`, `main/shortcuts/global-shortcuts.ts`, i18n messages

**Interfaces:**
- Produces: `ProviderResult | { kind: "record"; start: boolean; displayId: number; rect: Rectangle | null }`; handler dep `onRecordTarget(target: { displayId: number; rect: Rectangle | null; start: boolean }): void`; hub `selectArea(displayId: number, rect: CaptureRect | null): Promise<boolean>` (false when the display has no source; settings untouched); `isRecordKey(event, platform)` (⌘R / Ctrl+R); `primaryAction(intent): "capture" | "select"`.
- Record-intent bar: **Use selection** (Enter, primary) · Record (⌘R / Ctrl+R) · Capture (click) · Cancel. Capture-intent bar: Capture (Enter) · Copy · **Record** (⌘R, enabled) · Cancel. Frame memory: `recordingArea` in record intent, `screenshotFrame` otherwise.

- [ ] **Step 1: Failing tests** — overlay query round-trips `intent=record` (absent ⇒ capture); `parseAction` accepts `record`/`select`, rejects others; Enter in record intent answers `select`, ⌘R answers `record` in both intents; record intent persists to `recordingArea` and not `screenshotFrame`; Frame answers smaller than 64 DIP are not sent (button disabled); `runWithOverlay` with a `record` action returns `{kind:"record"}` without calling the capture backend and still destroys the overlays; handler forwards it to `onRecordTarget`, answers `{kind:"cancelled"}`, sends no `screenshot_captured`; `selectArea` with an unknown display returns false; `resolveShortcutCapture` unchanged; domain test pins `recordArea` defaults.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. Main `onRecordTarget`: if the hub is active, the already-recording notification; else `await hub.selectArea(...)` and, when `start`, `triggerStartRecording()`. `recordArea` shortcut: refuse while recording, else forward `screenshotHotkey` with `{ mode: "frame", intent: "record" }`. **Step 4:** PASS, then `bun run check-types`, `node_modules/.bin/oxlint`, full desktop unit suite. **Step 5:** Commit `feat(desktop): record from the capture overlay and the recordArea shortcut`.

### Task 6: Analytics and docs

**Files:**
- Modify: `shared/analytics.ts` (`RECORDING_STARTED_EVENT = "recording_started"`, closed payload `{ mode: "screen" | "area" | "window"; platform; displays }`), `main/recording/recording-hub.ts` (send at `recordingStart`)
- Modify docs: `desktop/ipc-contract.mdx`, `desktop/recording-pipeline.mdx` (area crop paragraph), spec status + decision 1 text, ADR 0030 status, backlog page and row to 🟢, delete this plan in the shipping PR.

- [ ] **Step 1:** Failing test: the payload builder drops unknown keys and maps `area`/`screen:`/`window:` correctly. **Step 2–4:** implement, PASS, `oxfmt --check`. **Step 5:** Commit `feat(desktop): recording_started analytics` and `docs: record capture modes shipped behind owner QA`.
