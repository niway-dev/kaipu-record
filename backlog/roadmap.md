# Kaipu Record — Backlog

Living backlog. We kill these **one by one**; each is marked done when shipped
(code + tests + docs). Product is **offline-only until the first prod upload** — no
cloud/Cloudflare work for now.

Status legend: ⬜ todo · 🔨 in progress · ✅ done

---

## Kill order

| #   | Feature                                     | Priority    | Status | Depends on             |
| --- | ------------------------------------------- | ----------- | ------ | ---------------------- |
| 1   | Camera bubble (floating window)             | High        | ✅     | —                      |
| 2   | Start recording from the Capture Panel (#4) | High · easy | ✅     | —                      |
| 3   | Floating bar on the recorded display (#7)   | High · easy | ✅     | —                      |
| 4   | Feature flags via PostHog                   | Medium      | ✅     | — (base for #6)        |
| 5   | Configurable quality (non-technical copy)   | Medium      | ✅     | —                      |
| 6   | Watermark, free → paid (scalable plan)      | Medium      | ✅\*   | plans API for `isPaid` |
| 7   | Builds + distribution                       | High        | ⬜     | Apple Developer acct   |
| 8   | Version gate / forced update                | Medium      | ⬜     | #7 for auto-update     |

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

## 4 — Feature flags via PostHog ✅ (shipped)

**Shipped:** PostHog analytics with a **renderer-primary + main-sink** architecture:

- **`useFlag(name)` hook** (`src/renderer/src/features/analytics/`) — offline-safe; returns
  the flag default when PostHog is unreachable or no key is set.
- **Two flags:** `watermark-enabled` (remote kill-switch, default `true` — wired into
  `useWatermark` directly) and `bypass-login` (seam for the future login gate, default
  treated as bypassed).
- **Identity:** a stable `deviceId` UUID minted once per install (persisted in
  `AppSettings`), used for `posthog.identify()`. Super-properties `product=kaipu-recorder`
  - `surface=desktop` tag every event and error.
- **Offline-safe:** missing `VITE_POSTHOG_KEY` or no network → SDKs no-op; flag defaults
  apply; app runs normally.
- **Main-process sink** (`src/main/services/analytics.service.ts` + `analytics-ipc.ts`):
  `posthog-node` captures Node-level `uncaughtException`/`unhandledRejection`; IPC channel
  `analytics:capture-exception` lets secondary windows (control-bar, camera-bubble,
  capture-panel) forward errors via `installCrashForwarder(origin)`.

**Follow-up:** add a **telemetry opt-out toggle** in Settings (`posthog.optOut()/optIn()`,
persisted in `AppSettings`). Currently no user-facing way to opt out.

**⚠️ PostHog dashboard checklist (verify in the PostHog UI — the in-code defaults are only
the OFFLINE/unresolved fallback; once online, the dashboard's rollout % wins):**

- `watermark-enabled` — must **exist** and be rolled out to **100% / match-all** so the
  watermark shows in production. If created at 0% rollout it would **hide** the watermark
  online. To remotely kill the watermark on purpose: set 0%.
- `bypass-login` — rollout % per intent (was at **0%** in the dashboard, i.e. resolves
  `false` online; harmless today since there is no login UI).
- Reading/managing flag config via the PostHog **API** (not just sending events) needs a
  **personal API key**, separate from the public `phc_…` project key in `.env`.

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

## 6 — Watermark, free → paid (scalable plan) ✅\* (shipped; live gating awaits #4)

**Shipped & closed:** the watermark itself + the gating **seam centralized in one hook**.
`useWatermark()` (`features/watermark/use-watermark.ts`) composes `entitlement.isPaid` +
`featureFlag` + a dev override → `{ enabled, config }`; pure `resolveWatermarkEnabled`. The
draw-pass is a canvas compositor (`watermark-compositor.ts`): screen → `<canvas>` (frame +
white-silhouette "Kaipu" wordmark, **center-right**, ~0.059 height ratio) → `captureStream` →
encoder; **zero cost when off** (raw screen track encoded directly). A **dev-only Settings
toggle** ("simular plan pago", localStorage-backed in `features/watermark/dev-override.ts`)
flips it and is stripped from prod builds (`import.meta.env.DEV` guard). Config in
`watermark.ts` (`as const` sets — variant/position/tint/opacity/size). See
[recording-pipeline](../apps/documentation) docs.

**\* The flag wiring is done (#4 shipped):** `useWatermark` now reads `watermark-enabled`
directly — the PostHog flag gates the watermark in production. **The one remaining piece is
`isPaid`:** live paid-detection is a **one-line swap inside `useWatermark`** once a
plans/entitlement API exists; nothing else changes. The definition of "paid" must stay a
**configurable, scalable plan/entitlement**, not a hardcoded boolean.

## 7 — Builds + distribution ⬜ (next up — blocked on Apple Developer account)

**Current state in the repo (2026-06-27):**

- `electron-updater@6.3.9` + `electron-builder@26` are **already dependencies**, but
  electron-updater is **NOT wired** — zero `autoUpdater`/`checkForUpdates` usage in
  `src/main`. Only declared.
- `electron-builder.yml` has `publish: { provider: generic, url: https://example.com/auto-updates }`
  — the URL is a **placeholder** that must be replaced with the real update feed.
- App `version` is `1.0.0`.
- No code signing / notarization configured.

**What we need from you (Apple Developer parameters to gather):**

- **Apple Developer Program** membership ($99/yr) → your **Team ID**.
- **Developer ID Application** certificate (`.p12`) + its password — for signing the `.app`/`.dmg`.
- For **notarization** (notarytool): an **App Store Connect API key** (Issuer ID + Key ID +
  the `.p8` file) **or** an Apple ID + app-specific password.
- A **bundle identifier** (e.g. `com.kaipu.record`).
- **Hardened runtime + entitlements** (mic, camera, screen recording) for the signed build.
- **Where updates are hosted** (the real `publish.url`): S3 / Cloudflare R2 / GitHub Releases /
  a generic static host.

**Plan once unblocked:** electron-builder mac config (sign + notarize), a release/CI pipeline,
wire electron-updater (`checkForUpdatesAndNotify`) against the real feed, and the update channel
strategy (stable/beta). Largely parallel to feature work but **gated on the Apple account**.

## 8 — Version gate / forced update ⏸️ PAUSED (2026-06-27 — revisit with #7)

**What the user asked for:** for a **beta** product, manage versions per release and a way to
**force updates** — both a soft "actualiza para seguir usando" and a hard "esta versión ya no
se puede usar, actualiza para continuar". (Note from user: do **not** copy `anonym-recorder`'s
update flow — build from scratch to the standard top companies use.)

**Paused because:** the full delivery side needs the **Apple Developer account** (same blocker
as #7). We'll plan it together with #7's build/distribution.

**Proposed design (industry-standard, two layers — kept separate on purpose):**

- **Layer A — delivery** = `electron-updater` (download/install). This is #7 (needs signed
  builds + a real feed + Apple account).
- **Layer B — version gate / kill-switch** (this item) = a remote-config-driven
  **minimum-supported-version** check. **Buildable now, no Apple account**, except the actual
  install which falls back to a download link until #7 lands:
  - **Source of truth:** a PostHog feature flag with a **JSON payload** (no new backend), e.g.
    `version-gate` → `{ "minVersion": "1.2.0", "latestVersion": "1.4.0", "blocking": true, "message": "…" }`
    read via `posthog.getFeatureFlagPayload(...)`.
  - **Current version:** `app.getVersion()` (today `1.0.0`).
  - **Pure semver compare (testable):**
    - `current < minVersion` → **hard block**: full-screen blocker, app unusable.
      _"Esta versión ya no se puede usar. Actualiza para continuar."_
    - `current < latestVersion` (not blocking) → **soft nudge**: dismissible banner.
      _"Hay una versión nueva. Actualiza para seguir con las últimas mejoras."_
  - **Fail-open (critical):** if the flag is unresolved / offline → **never block** (no
    lockout from a network blip or PostHog outage).
  - **"Actualizar" button:** for now `shell.openExternal(downloadUrl)`; once #7 is signed, the
    same button triggers `electron-updater` — no redesign.

**Open questions to resolve when we resume (asked 2026-06-27):**

1. **v1 scope:** gate-only (enforcement) · gate + wire electron-updater · or the full #7. (User
   leaned: pause until the Apple account exists, then do it with #7.)
2. Where the **"Actualizar"** button points before auto-update exists (a releases page? a site?).
3. Hard-block **UX** (full-screen modal vs replacing the whole app shell).
4. **Re-check cadence:** startup only, or also periodically / on focus.
5. **Config shape:** confirm the PostHog-payload approach vs a dedicated remote JSON endpoint.
6. Pick a tiny **semver** compare util (or hand-roll a pure comparator — no heavy dep).

**When we resume:** brainstorm → spec → plan → subagent-driven build (same flow as #4 analytics).
