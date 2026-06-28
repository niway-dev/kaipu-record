---
title: "Feature Flags + Error Handling — Design"
description: "Design for a PostHog analytics foundation: feature flags, broad error reporting, and a defensive two-channel error layer."
---

**Date:** 2026-06-27
**App:** `apps/kaipu-record` (desktop, Electron multi-window)
**Status:** Approved — ready for implementation plan

---

## Goal

Add a small **analytics foundation** to the desktop recorder that delivers three
things, all built on a single PostHog client:

1. **Feature flags** — remote on/off control (`bypass-login`, `watermark-enabled`),
   with the watermark gating seam (`useWatermark`) finally fed by a real flag.
2. **Error reporting** — capture as many runtime failures as possible (renderer +
   main process) during this test phase, so we can learn from crashes in the wild.
3. **Defensive handling + user-facing errors** — error boundaries so the app does
   not hard-crash, plus a `ui/toast` that shows human-readable messages while the
   full technical detail goes to PostHog.

## Architecture (summary)

PostHog client lives **renderer-primary** (`posthog-js` in the main window, where all
the app logic + the recording engine run) with a small **`posthog-node` sink in the
main process** for Node-level crashes. Secondary windows forward their errors to the
main process over IPC so nothing is lost. Everything is **offline-safe**: if the key
is missing or there is no network, the SDKs no-op and the app runs normally with
flags at their defaults.

## Tech stack

- `posthog-js` (renderer: flags + exception autocapture + identify)
- `posthog-node` (main process: Node-level crash capture)
- Existing: React 19, electron-vite 5, CSS Modules + design tokens, the main-process
  hub + `settings-store`, the `cx()` + `data-*` house style.

---

## Context & constraints

- **No auth / no user identity yet.** The product is offline-first; the backend (and
  with it, real auth + plans) comes later. So "who is this user / did they pay?"
  cannot be answered per-user today. We **prepare the seams** and stub the core.
- **One PostHog account, shared across surfaces.** Events/errors are tagged with
  super-properties `product` + `surface` so the future backend and web frontend can
  be filtered apart in the same project.
- **Privacy is non-negotiable for a screen recorder.** Session replay and DOM/click
  autocapture are **disabled**. We only ever send: exceptions, explicit feature
  events, and flag evaluations. We never capture recorded content.
- **House rules:** double quotes + semicolons, design tokens only (no hardcoded
  colors), `cx()` + `data-*` className style, no TypeScript `enum` (use `as const` +
  `(typeof X)[number]`), product/UI copy in neutral Spanish (no voseo), commit with
  `--no-verify` per the oxfmt churn hold.

---

## Architecture decision: renderer-primary + main sink (chosen)

Two viable shapes for a multi-window Electron app (4 renderer windows: `main`,
`control-bar`, `camera-bubble`, `capture-panel`; plus the Node `main` process):

**A) Renderer-primary + sink in main (CHOSEN).**

- `posthog-js` initialized once in the **main window** renderer — it owns flags,
  exception autocapture, and `identify`.
- A small **`posthog-node`** client in the **main process** captures Node-level
  `uncaughtException` / `unhandledRejection`, and acts as the **sink** for errors
  forwarded from secondary windows over IPC.
- Secondary windows install only a lightweight global handler that forwards to the
  main process (no full `posthog-js` per window).

**B) Everything centralized in main (`posthog-node` only).**

- One client in main; renderers forward all errors and request all flags over IPC.

**Why A:** PostHog Error Tracking is purpose-built for the browser/renderer (better
stack traces, sourcemap support, the Errors UI). `useWatermark` / `useFlag` are
already renderer hooks, so flags belong renderer-side. All substantial logic and the
recording engine live in the main window renderer. B would force hand-rolled error
tracking and extra IPC for something the browser SDK does natively. A loses nothing —
secondary windows and the main process funnel their errors in — and is the most
complete option, which matches the test-phase goal of capturing everything.

---

## File structure

```
apps/kaipu-record/
  .env / .env.example            # + MAIN_VITE_POSTHOG_KEY / _HOST (main-process layer)
  src/
    shared/
      analytics.ts               # pure: super-property names, flag name constants
                                 #   (as const), event names, redact helpers
    main/
      services/
        analytics.service.ts     # posthog-node: init, captureException, shutdown;
                                 #   process-level crash handlers; deviceId owner
      ipc/                        # analytics:capture-exception sink + deviceId getter
    renderer/src/
      features/analytics/
        analytics-client.ts      # posthog-js init (privacy flags baked in), identify
        use-flag.ts              # useFlag(name): boolean, default-aware
        report-error.ts          # the two-channel helper (human msg + technical payload)
        error-boundary.tsx       # React ErrorBoundary -> fallback UI + report
      watermark/
        use-watermark.ts         # flagOn = useFlag("watermark-enabled") (was stub)
      recording/...              # toast wiring at the 3 known failure points
      ui/
        toast.tsx / toast.module.css   # NEW primitive (+ a small provider/host)
```

Secondary windows (`control-bar`, `camera-bubble`, `capture-panel`) import a tiny
`installCrashForwarder()` from `features/analytics` instead of the full client.

---

## Pillar 1 — Feature flags

- **`useFlag(name): boolean`** reads `posthog-js`. Returns a safe default when the
  flag is unresolved (offline, still loading, or SDK disabled).
- **Flag names** live as `as const` constants in `shared/analytics.ts` (no enums),
  one source for the string + its type:
  - `bypass-login` — **seam only**. There is no login screen today (no API). The hook
    reads and exposes the flag; the future login flow will consult it. We do **not**
    build login now. Default: treat as bypassed (so the app is usable pre-auth).
  - `watermark-enabled` — **remote kill-switch for prod**. Lets us turn the watermark
    on/off without shipping a release (for targeted prod testing). Default **`true`**
    (offline/unresolved → watermark still shows, preserving free behavior).
- **`useWatermark` change** (the long-promised one-line swap):
  - `flagOn = true` (stub) → `flagOn = useFlag("watermark-enabled")`.
  - `isPaid = false` stays stubbed until the backend/plans API exists.
  - The dev-only Settings toggle and `resolveWatermarkEnabled` are unchanged.
- **Identity:** `posthog.identify(deviceId)` so flags can be targeted per device/team.
  `deviceId` is a stable UUID minted once and persisted in `settings-store` (main),
  exposed to the renderer. This is the "always identify devices" requirement.

## Pillar 2 — Error reporting (maximum coverage)

Coverage is intentionally broad for the test phase:

- **Main window renderer:** `posthog-js` exception **autocapture** ON, plus explicit
  `window.onerror` / `unhandledrejection` hooks (belt and suspenders).
- **Secondary windows:** `installCrashForwarder()` — global `onerror` /
  `unhandledrejection` that posts the serialized error to the main process via IPC
  (`analytics:capture-exception`). No per-window `posthog-js`.
- **Main process:** `posthog-node` captures `uncaughtException` /
  `unhandledRejection` (file writes, IPC handlers, window management) and is the sink
  for forwarded renderer errors.
- **Super-properties:** every event/error carries `{ product, surface }` (from env,
  with a hardcoded `surface: "desktop"` fallback so it cannot be mislabeled).

### Config / env

```
# renderer (posthog-js)
VITE_POSTHOG_KEY=...
VITE_POSTHOG_HOST=https://us.i.posthog.com
VITE_POSTHOG_PRODUCT=kaipu-recorder
VITE_POSTHOG_SURFACE=desktop
# main process (posthog-node) — same values, main-layer prefix
MAIN_VITE_POSTHOG_KEY=...
MAIN_VITE_POSTHOG_HOST=https://us.i.posthog.com
```

If `*_KEY` is absent, both clients no-op (the app runs offline-normal).

## Pillar 3 — Defensive layer + user-facing errors

### The two-channel error principle (core rule)

Every surfaced error has **two faces**, and they never mix:

- **User-facing:** a short, human-readable message in neutral Spanish (the toast / the
  boundary fallback). Never a stack trace, never jargon.
- **Developer-facing:** the full technical payload sent to PostHog — `error.stack`,
  error name/message, the operation that failed, and relevant context (e.g. source
  id, output path). This is what we learn from.

A single helper, `reportError(userMessage, error, context?)`, enforces this: it shows
the user message (via the toast/boundary) **and** captures the technical payload to
PostHog in one call.

### Don't-crash measures

- **React `ErrorBoundary`** wrapping each renderer entry: instead of a white screen,
  a calm fallback ("Algo salió mal…") with a way to recover, and it reports the
  exception.
- **Hardened main IPC handlers:** wrap the risky ones (recording writer, settings,
  window ops) so a throw reports + degrades gracefully instead of taking down the
  process. Extends the existing mid-recording recovery.

### `ui/toast` (new primitive)

- New `ui/toast.tsx` + `toast.module.css` following the house style (`cx()` +
  `data-*`, design tokens) and a small host/provider mounted near the app root.
- Wired at the **three known recording failures** that today die in `console.error`
  (`use-screen-recorder.ts`): **start**, **mid-recording**, **finalize**.
- Each toast: human-readable message + auto-dismiss (~5s) + a **"Reintentar"** action.
  Retry is safe to offer everywhere because starting a recording is a fully local
  operation (no API call): Retry re-runs the start flow (for mid/finalize, that means
  starting a fresh recording).

---

## Data flow

```
Flags:    posthog-js (main window)  ──identify(deviceId)──>  PostHog
          useFlag("watermark-enabled") ──> useWatermark.flagOn
          useFlag("bypass-login")      ──> exposed seam

Errors:   main-window renderer  ──autocapture + onerror──>  PostHog (posthog-js)
          secondary windows     ──IPC: analytics:capture-exception──>  main
          main process          ──uncaughtException / sink──>  PostHog (posthog-node)
          reportError(msg, err) ──> toast (user) + captureException (us)
```

## Privacy

- `disable_session_recording: true`, `autocapture: false`. No DOM, no inputs, no
  recorded content — only exceptions, explicit events, and flag evaluations.
- Telemetry **opt-out in Settings** is intentionally deferred (see Out of scope); for
  this test phase capture is maximal by design.

## Offline behavior

- Missing key or no network → SDKs no-op, the app runs normally.
- `useFlag` returns documented defaults (`watermark-enabled` → `true`,
  `bypass-login` → bypassed) so behavior is deterministic offline.

## Testing strategy

- **Pure (`shared/analytics.ts`):** flag-name constants, default resolution, the
  redact/serialize helpers — node project tests.
- **`useFlag`:** default when unresolved; reads the (mocked) client when resolved.
- **`useWatermark`:** `flagOn` now comes from `useFlag` — update existing tests to
  drive it via a mocked flag; assert default-on and flag-off paths.
- **`reportError`:** asserts both channels fire (user message shown + technical
  payload captured) and that they don't leak into each other.
- **`ui/toast`:** renders message, auto-dismiss, Retry invokes the callback.
- **`ErrorBoundary`:** renders fallback on child throw + reports once.
- SDKs are mocked in tests; no real network. Keeps the suite offline + deterministic.

---

## Out of scope (deliberate)

- **Real login** — only the `bypass-login` seam; no login UI/flow (no API yet).
- **Real paid/entitlement** — `isPaid` stays stubbed `false` until the plans API.
- **Telemetry opt-out toggle** in Settings — important for a shipping screen recorder,
  deferred past this test phase. Documented follow-up.
- **Main-process flag evaluation** — flags are renderer-side; main only reports errors.

## Open follow-ups

- Telemetry opt-out + a privacy note when the product leaves the test phase.
- Per-user entitlement once auth/backend lands (swap the `isPaid` stub).
- Optional: sourcemap upload to PostHog for symbolicated prod stack traces.
