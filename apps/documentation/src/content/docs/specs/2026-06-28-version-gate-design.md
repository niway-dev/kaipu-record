---
title: Version gate — design spec
description: A fail-open, remote-config version gate for the desktop app — a hard kill-switch for builds below a minimum version and a soft nudge below the latest, evaluated in the renderer against a dedicated JSON on Cloudflare.
---

# Version gate — design spec

**Goal:** stop unsupported builds from being used (hard kill-switch) and nudge outdated-but-usable
builds to update (soft banner), driven by a remote config the team edits without shipping a new
build.

**Status:** design approved (brainstorming). Branch `feat/version-gate`. Implementation plan to
follow via `writing-plans`.

**Tech stack:** Electron + React (renderer), TypeScript, a pure shared module, a dedicated static
JSON on Cloudflare. No new backend. No `electron-updater` dependency (that is the separate
[auto-update](/backlog/auto-update) item).

---

## Scope

**In scope (v1):**

- A **hard block** when the installed version is below `minVersion` — a full-screen,
  non-dismissible overlay; the app is unusable until updated.
- A **soft nudge** when the installed version is below `latestVersion` (but at/above
  `minVersion`) — a dismissible banner.
- Config read from a **dedicated remote JSON on Cloudflare**, URL from `VITE_VERSION_GATE_URL`.
- Check on **startup + window focus**, **throttled to 10 minutes**, **fail-open** with a
  last-good cache.
- "Actualizar" button opens the **GitHub Releases page** (`window.open`, routed to the OS browser
  by the existing `setWindowOpenHandler`).

**Out of scope (separate items):**

- `electron-updater` / in-app download/install → [auto-update](/backlog/auto-update).
- Pre-release/semver-tag parsing (`1.2.0-beta.1`). v1 compares plain `x.y.z`.
- Per-platform or per-channel gates (single config for the macOS build for now).

---

## Architecture

Renderer-only logic. The main process contributes exactly one new thing — exposing the app
version. Everything else (fetch, evaluate, render) lives in the renderer, where PostHog and the
rest of the feature code already sit. The blocker is a React overlay mounted in `AppShell` (always
mounted, wraps every route).

```
AppShell
  └─ useVersionGate()                         (renderer hook)
       ├─ window.electronAPI.getAppVersion()  (one new IPC → app.getVersion())
       ├─ fetchVersionGateConfig(url)         (fetch + parse, fail-open → null)
       ├─ evaluateGate(current, config)       (pure, shared)
       └─ GateState → <VersionGateOverlay> | <VersionGateBanner> | null
```

**Why renderer-only:** the only "usable" window is the main window; secondary windows (control
bar, camera bubble, capture panel) are transient and not where a user would keep working. A
main-process check pushed over IPC would be more plumbing for no real gain here.

---

## Components

### 1. Pure shared model — `src/shared/version-gate.ts`

No `electron`/`node`/DOM imports (same constraint as `shared/analytics.ts`). House rule: `as const`
arrays + derived types, no TS enums.

```ts
export interface VersionGateConfig {
  minVersion: string;     // below → hard block
  latestVersion: string;  // below (but ≥ minVersion) → soft nudge
  message?: string;       // optional override copy
  downloadUrl?: string;   // optional; falls back to DEFAULT_DOWNLOAD_URL
}

export type GateState =
  | { kind: "ok" }
  | { kind: "soft"; message: string; downloadUrl: string }
  | { kind: "hard"; message: string; downloadUrl: string };

export const VERSION_GATE_THROTTLE_MS = 10 * 60 * 1000; // 10 min between network checks
export const DEFAULT_DOWNLOAD_URL = "https://github.com/niway-dev/kaipu-record/releases/latest";

/** -1 | 0 | 1 for a vs b on plain x.y.z. Missing/short parts treated as 0 (so "1.2" == "1.2.0"). */
export function compareSemver(a: string, b: string): -1 | 0 | 1;

/** Map current version + config → GateState. minVersion drives hard, latestVersion drives soft. */
export function evaluateGate(currentVersion: string, config: VersionGateConfig): GateState;

/** Validate untrusted JSON. Returns null on anything malformed (→ fail-open). */
export function parseVersionGateConfig(raw: unknown): VersionGateConfig | null;
```

`evaluateGate` precedence:

1. `compareSemver(current, minVersion) < 0` → `hard`
2. else `compareSemver(current, latestVersion) < 0` → `soft`
3. else → `ok`

Copy: use `config.message` when present, else a built-in default per kind. `downloadUrl` falls
back to `DEFAULT_DOWNLOAD_URL`.

> Simplification vs the original roadmap proposal: drop the separate `blocking` boolean — it is
> redundant with `minVersion`. A hard block _is_ "current < minVersion".

### 2. Fetch + hook — `src/renderer/src/features/version-gate/`

`fetch-version-gate-config.ts`:

```ts
/** Fetch + parse the remote config. Returns null on any failure (network, non-2xx, malformed). */
export async function fetchVersionGateConfig(url: string): Promise<VersionGateConfig | null>;
```

`use-version-gate.ts`:

```ts
/** Evaluate the gate against the remote config. Fail-open: returns { kind: "ok" } until/unless
 *  a fetched config says otherwise. Re-checks on window focus, throttled to VERSION_GATE_THROTTLE_MS,
 *  and caches the last good config so a throttled/failed focus check never regresses. */
export function useVersionGate(): GateState;
```

Hook behavior:

- On mount: read the app version once (`getAppVersion()`); read `VITE_VERSION_GATE_URL`. If the
  env URL is absent → permanently `ok` (gate disabled, e.g. local dev).
- Fetch on mount, then on every window `focus` **only if** `Date.now() - lastCheckedAt >
VERSION_GATE_THROTTLE_MS`. Update `lastCheckedAt` only on an actual fetch attempt.
- Keep the **last-good** `VersionGateConfig` in a ref. A failed/throttled check reuses it; it is
  never cleared by a failure (fail-open never _removes_ a real hard block once seen, and never
  _adds_ one from a network blip).

### 3. UI — mounted in `AppShell`

- `version-gate-overlay.tsx` — `kind: "hard"`: a fixed, full-viewport layer above everything,
  **non-dismissible** (no close button, no backdrop dismiss, swallows Escape). Message + an
  **Actualizar** button.
- `version-gate-banner.tsx` — `kind: "soft"`: a slim dismissible banner. Message + **Actualizar**
  - dismiss (dismissal is per-session, in component state; a later session/check shows it again).
- The **Actualizar** button calls `window.open(downloadUrl, "_blank")`. The main process's
  existing `setWindowOpenHandler` (`src/main/index.ts`) routes it to `shell.openExternal` and
  denies the in-app window — so no new IPC for the link.

`AppShell` renders `useVersionGate()` once and switches: `hard` → overlay (rendered last/topmost),
`soft` → banner (above the content), `ok` → nothing.

### 4. Main process — one new IPC

- New channel `getAppVersion: "app:get-version"` in `IPC_CHANNELS` (`src/shared/types/ipc.ts`).
- `ipcMain.handle` returns `app.getVersion()`.
- Preload exposes `getAppVersion(): Promise<string>` on `window.electronAPI`.

---

## Data flow

1. `AppShell` mounts → `useVersionGate()`.
2. Hook reads `getAppVersion()` (e.g. `"1.0.0"`) and `VITE_VERSION_GATE_URL`.
3. Hook `fetchVersionGateConfig(url)` → `parseVersionGateConfig` → `VersionGateConfig | null`.
4. `evaluateGate(current, config)` → `GateState`.
5. Render overlay / banner / nothing.
6. On window focus, if throttle elapsed → re-fetch → re-evaluate → live update (a freshly
   published `minVersion` can block an open app within ≤10 min of a focus).

---

## Config JSON (hosted on Cloudflare, edited by the team)

```json
{
  "minVersion": "1.2.0",
  "latestVersion": "1.4.0",
  "message": "Optional custom copy shown in the overlay/banner",
  "downloadUrl": "https://github.com/niway-dev/kaipu-record/releases/latest"
}
```

`VITE_VERSION_GATE_URL` points at this file (e.g. `https://cdn.<domain>/version-gate.json`). Serve
with a short `Cache-Control` (the 10-min client throttle is the primary rate limiter; CDN cache is
secondary).

---

## Error handling — fail-open everywhere

The central safety property: **a build is never locked out by an infra failure.** Every failure
path resolves to `ok` (or the last-good config):

| Failure                                                    | Result                      |
| ---------------------------------------------------------- | --------------------------- |
| `VITE_VERSION_GATE_URL` absent                             | `ok` (gate disabled)        |
| Network error / offline                                    | last-good config, else `ok` |
| Non-2xx response                                           | last-good config, else `ok` |
| Malformed / partial JSON (`parseVersionGateConfig` → null) | last-good config, else `ok` |
| `app.getVersion()` unexpectedly empty                      | `ok` (cannot evaluate)      |

A real `hard` state, once fetched, persists across throttled/failed focus checks (last-good ref) —
so a momentary blip can't _clear_ a legitimate block, and can't _create_ one.

---

## Testing plan

Pure / logic (high value, fully unit-testable):

- `compareSemver` — `<`, `=`, `>`, padding (`"1.2"` vs `"1.2.0"`), multi-digit (`"1.10.0"` vs
  `"1.9.0"`).
- `evaluateGate` — below min → `hard`; at min / between min and latest → `soft`; at/above latest →
  `ok`; message + downloadUrl fallback behavior.
- `parseVersionGateConfig` — valid; missing `minVersion`/`latestVersion`; wrong types; extra fields
  ignored → null vs config.
- `fetchVersionGateConfig` — mock `fetch`: 200+valid, 500, network throw, 200+malformed → null.

Hook:

- `useVersionGate` — mock `getAppVersion` + `fetch`: returns `ok` before resolve (fail-open);
  becomes `hard`/`soft` after; **throttle** (a focus within 10 min does not re-fetch; after 10 min
  does); **last-good** retained on a failed re-fetch.

Components:

- `version-gate-overlay` — renders message; **cannot** be dismissed (no close affordance; Escape is
  a no-op); button calls `window.open` with the resolved URL.
- `version-gate-banner` — renders; dismiss hides it; button calls `window.open`.

---

## File structure

- Create `src/shared/version-gate.ts` (pure model + constants).
- Create `src/renderer/src/features/version-gate/`:
  - `fetch-version-gate-config.ts`
  - `use-version-gate.ts`
  - `version-gate-overlay.tsx` + `.module.css`
  - `version-gate-banner.tsx` + `.module.css`
  - `index.ts`
  - tests alongside each unit.
- Modify `src/shared/types/ipc.ts` (add `getAppVersion` channel).
- Modify `src/main/index.ts` (or an ipc module) — handle `app:get-version`.
- Modify `src/preload/index.ts` — expose `getAppVersion`.
- Modify `src/renderer/src/shell/app-shell.tsx` — mount the gate.
- Add `VITE_VERSION_GATE_URL` to `.env.example`.

---

## Follow-ups (not v1)

- Wire the **Actualizar** button to `electron-updater` once [auto-update](/backlog/auto-update)
  lands (one-line swap from `window.open` to the updater trigger).
- Pre-release/channel-aware semver if a `beta` channel is introduced.
- Optional analytics event when a gate is shown (reuse the existing PostHog client).
