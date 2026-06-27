# Kaipu Record — Backlog

Living backlog. We kill these **one by one**; each is marked done when shipped
(code + tests + docs). Product is **offline-only until the first prod upload** — no
cloud/Cloudflare work for now.

Status legend: ⬜ todo · 🔨 in progress · ✅ done

---

## Kill order

| #   | Feature                                     | Priority    | Status | Depends on            |
| --- | ------------------------------------------- | ----------- | ------ | --------------------- |
| 1   | Camera bubble (floating window)             | High        | ✅     | —                     |
| 2   | Start recording from the Capture Panel (#4) | High · easy | ✅     | —                     |
| 3   | Floating bar on the recorded display (#7)   | High · easy | ✅     | —                     |
| 4   | Feature flags via PostHog                   | Medium      | ⬜     | — (base for #6)       |
| 5   | Configurable quality (non-technical copy)   | Medium      | ✅     | —                     |
| 6   | Watermark, free → paid (scalable plan)      | Medium      | 🔨     | #4 + plan/entitlement |
| 7   | Builds + distribution                       | Medium      | ⬜     | — (parallel)          |

### Shipped beyond the kill order ✅

Emergent work done while shipping #1–#3, not originally on the list:

- **Single source of truth for recording settings** ✅ — source/toggles/mic live in the hub
  (`RecordingSettings`), broadcast to every window; `useRecordingSettings` (query-on-mount +
  subscribe + optimistic write). Record page ⇄ Capture Panel stay in sync. Replaced the old
  per-window `camera:set`.
- **Persisted app settings + Dock/app-switcher control** ✅ — first persistence layer
  (`main/infrastructure/settings-store.ts`, `settings.json` + `settings:get/update` IPC +
  OS side effects). `AppSettings.showInDock` toggle (`regular` vs `accessory`). **Fixes** the
  app vanishing from the Dock & ⌘-Tab after a recording (hub re-asserts `applyDockPolicy()` +
  `app.focus({steal:true})` on stop).
- **Mid-recording failure recovery** ✅ — engine surfaces failures (source `errorPromise` +
  screen track `ended`) via `onError`, routed to the robust `stop()` (finalize-or-abort +
  always restore window/Dock/bar); `stoppingRef` prevents double-teardown. App never gets
  stuck. _Follow-up: user-visible error toast (recovers silently to console today)._

---

## 1 — Camera bubble ✅ (shipped)

Shipped: `camera-bubble-window` (frameless/transparent/always-on-top circle) shown via
`?window=camera-bubble`, driven by the Camera toggle (`camera:set` IPC) from the Record
page, reusing the tested `useCameraPreview`. The control bar now `setContentProtection(true)`
so it's excluded from the recording while the bubble is captured. **Runtime check pending:**
confirm on macOS that the control bar is actually absent from the recorded video and the
bubble is present.

Original plan:

A floating, always-on-top **webcam bubble** (circular), like the control-bar widget:
draggable, and **captured into the recording because it's on screen** (no canvas
compositing).

**Decisions (locked):**

- Approach: **floating window**, captured by the screen recording (not CanvasSource).
- Appears when the **Camera toggle is on** (preview + position before recording, stays
  during).
- The **control bar is excluded from the video** (`setContentProtection(true)`); the
  camera bubble is NOT protected so it IS captured. (Verify exact macOS behavior on impl.)

**Scope (v1):** new `camera-bubble-window` (frameless/transparent/always-on-top, drag
region) showing the live cam via the existing tested `useCameraPreview`; IPC to show/hide
it from the Camera toggle; control bar gets content-protection. Reuses `useCameraPreview`
(already tested), so little new untested surface.

**Follow-ups:** camera device picker, resize/shape options.

**Update:** the recording **settings** (source/toggles/mic) are now a single source of
truth in the hub, broadcast to every window — so the bubble (and every control) syncs
between the Record page and the Capture Panel. The old per-window `camera:set` is gone.

## 2 — Start recording from the Capture Panel (#4) ✅ (shipped)

Panel **Start** sends `recording:request-start` → main opens/focuses the main window and
tells its Record page to run the normal start (countdown + record). The main window's
current settings apply. **v1 limitation:** if the main window is on a non-Record route, the
start signal is missed (no listener) — fine for the common case.

## 3 — Floating bar on the recorded display (#7) ✅ (shipped)

The hub resolves the recorded screen's `display_id` from the source id (one
`desktopCapturer` lookup at start) and `ControlBarWindow` positions itself on that display
(falls back to the cursor display). Kept entirely in main — no renderer plumbing.

## 4 — Feature flags via PostHog

Add PostHog + a thin flag/entitlement layer. Foundation for #6 (watermark gating) and for
rolling out #1/#5/#7. Needs: SDK init (main or renderer), a `useFlag(name)` helper, and a
way to define flags. Keep it offline-safe (flags default sensibly when offline).

## 5 — Configurable quality (non-technical copy) ✅ (shipped)

Shipped: a **Recording quality** section in Settings. Pure model in
`shared/recording-quality.ts` (presets, discrete steps, encoder mapping, validation) used by
both processes. Friendly preset chips (🚀 Liviano · 🎯 Equilibrado · ✨ Máxima calidad ·
🎛️ Personalizado) over three discrete sliders — **Resolución / Fluidez / Bitrate** — with a
live **"≈MB/min"** weight, a per-preset **caption**, and **ⓘ** deep-dive popovers. The active
chip is **derived** from the values (moving any slider → Personalizado; 4K + max bitrate only
reachable there). Persisted in `AppSettings.recordingQuality` (reuses the settings-store) and
threaded into `recorder-engine` (`width/height/frameRate/videoBitrate`, defaults preserve
1080p30·8 Mbps). Copy is neutral Spanish, benefit-first. ~162 tests green.

**Follow-ups:** runtime GUI check on multi-DPI displays; a label for the 48 fps step (left as
"48 fps" — user didn't want "Fluido"); optional estimate that also factors fps/resolution.

## 6 — Watermark, free → paid (scalable plan) 🔨 (seam + draw-pass shipped)

**Shipped:** the watermark itself + the gating **seam centralized in one hook**.
`useWatermark()` (`features/watermark/use-watermark.ts`) composes `entitlement.isPaid` +
`featureFlag` + a dev override → `{ enabled, config }`; pure `resolveWatermarkEnabled`. The
draw-pass is a canvas compositor (`watermark-compositor.ts`): screen → `<canvas>` (frame +
white-silhouette "Kaipu" wordmark, bottom-right) → `captureStream` → encoder; **zero cost
when off** (raw screen track encoded directly). A **dev-only** `VITE_WATERMARK_FORCE=free|paid`
flips it and is eliminated from prod builds (`import.meta.env.DEV` guard). Config in
`watermark.ts` (`as const` sets). See [recording-pipeline](../apps/documentation) docs.

**Pending (the "real" gating):** `isPaid` and the flag are **stubs**. The real plan/entitlement
+ flag come from **#4 (PostHog)** — when it lands, only `useWatermark` changes (the seam).
The definition of "paid" must stay a **configurable, scalable plan/entitlement**, not a
hardcoded boolean.

## 7 — Builds + distribution

electron-builder config, macOS **code signing + notarization**, an **auto-update** channel,
and a release/distribution plan (where the app is hosted/served). Largely independent of
the feature work; can run in parallel.
