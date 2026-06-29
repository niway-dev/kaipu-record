---
title: Version gate
description: A fail-open remote-config version gate — a hard kill-switch for builds below a minimum version and a soft nudge below the latest. Built on branch feat/version-gate; prod validation pending.
---

# Version gate

> **Status: 🟢 Shipped, not yet activated.** The code is in the released build, but the gate is
> **fail-open and dormant** until a `version-gate.json` is uploaded to R2 (`VITE_VERSION_GATE_URL`).
> ⏳ pending: upload a test config and confirm the soft banner + hard overlay actually trigger on a
> packaged build. Design: [/specs/2026-06-28-version-gate-design](/specs/2026-06-28-version-gate-design) ·
> Plan: [/plans/2026-06-28-version-gate](/plans/2026-06-28-version-gate).

Stops unsupported builds from being used and nudges outdated-but-usable ones to update, driven
by a remote JSON config the team edits without shipping a new build. **Fail-open everywhere** —
no infra failure can lock a user out.

## What shipped

| Piece                                     | What it does                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Pure model (`src/shared/version-gate.ts`) | `compareSemver`, `evaluateGate` (min→hard, latest→soft), `parseVersionGateConfig` (malformed → null) |
| `app:get-version` IPC                     | exposes `app.getVersion()` to the renderer                                                           |
| `fetchVersionGateConfig`                  | fetch + parse the remote config; null on any failure                                                 |
| `useVersionGate` hook                     | startup + throttled (10 min) focus checks; caches last-good config; fail-open                        |
| Overlay (hard) + banner (soft)            | full-screen non-dismissible block / slim dismissible nudge, mounted in `AppShell`                    |

## Config (hosted on Cloudflare, set `VITE_VERSION_GATE_URL` to its URL)

```json
{
  "minVersion": "1.2.0",
  "latestVersion": "1.4.0",
  "message": "Optional custom copy",
  "downloadUrl": "https://github.com/csdev19/kaipu-record-monorepo/releases/latest"
}
```

- `current < minVersion` → **hard** full-screen overlay (app unusable).
- `minVersion ≤ current < latestVersion` → **soft** dismissible banner.
- `current ≥ latestVersion` → nothing.
- No URL / offline / non-2xx / malformed → **ok** (gate disabled / fail-open).

The "Actualizar" button uses `window.open`, routed to the OS browser by the existing
`setWindowOpenHandler` — no new IPC. Wiring it to an in-app update is the
[auto-update](./auto-update) follow-up.

## Validate (prod build)

With a packaged build and `VITE_VERSION_GATE_URL` pointing at a test JSON:

- [ ] `minVersion` above the app version → **full-screen overlay**, no way to dismiss; the app is
      unusable; "Actualizar" opens the Releases page in the browser.
- [ ] `latestVersion` above the app version (but `minVersion` ≤ current) → **dismissible banner**;
      dismiss hides it for the session.
- [ ] Both at/below the app version → no overlay, no banner.
- [ ] Point the URL at an unreachable host / remove it → app runs normally (**fail-open**).
- [ ] Publish a higher `minVersion` while the app is open, refocus the window after 10 min → the
      block appears without a restart (throttled focus re-check).

After validation: flip 🟢 → ✅ and fold the lasting knowledge into a `desktop/` reference doc.

## Out of scope (separate items)

- In-app download/install → [auto-update](./auto-update) (`electron-updater`).
- Pre-release/channel-aware semver (`1.2.0-beta.1`).
