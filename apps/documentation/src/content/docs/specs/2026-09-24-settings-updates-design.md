---
title: "Settings → Updates — design"
description: "Design for a Check for updates button and a visible updater state machine: a pure reducer in shared/, a thin electron-updater adapter in main, and one Settings section. Updates stay mandatory — there is no off switch."
---

# Settings → Updates — design

> **Status: 🔵 Design, not implemented** (2026-09-24). Backlog page:
> [Settings → Updates](../backlog/settings-updates). Parent: [auto-update](../backlog/auto-update) (shipped).

## The problem

The owner published a release, waited several minutes and nothing happened. That is the
design working as written, not a bug:

1. **The check runs once at launch, then every six hours.** An app already open when a
   release lands will not look again for up to six hours. There is no manual trigger and
   no check on focus. Kaipu is a menu-bar resident app meant to stay open for days, so
   "check at launch" is the wrong primary trigger for something that rarely launches.
2. **Only one state is visible.** `UpdateStatus` is `idle | ready`. `electron-updater`
   emits `checking-for-update`, `update-available`, `update-not-available`,
   `download-progress`, `update-downloaded` and `error`. Four of the six are dropped on
   the floor. Between the check and the "restart" banner the app looks idle.
3. **Dev builds never check** (`if (!app.isPackaged) return;`), so a dead button in
   development would look like a broken feature.

## Scope, settled with the owner

**A button to look for updates. No switch to turn updates off.** The original proposal
included an `Automatic updates` toggle persisted in `AppSettings`; it is cut. Automatic
background updates remain mandatory and cannot be disabled from the UI. This removes a
new settings field, its persistence, and the "user silently stops receiving updates"
failure mode.

## Architecture

The state machine is a **pure reducer in `src/shared/`**, and `auto-updater.ts` becomes a
thin adapter that feeds it events and broadcasts the result. This is the pattern the repo
already uses for `shared/version-gate.ts` and `features/watermark/watermark.ts`: the rules
live somewhere with no electron and no DOM, so they are unit-testable without packaging
the app.

The alternative — growing the union and keeping the logic inside `auto-updater.ts` — was
rejected for the reason this page exists. Logic welded to electron can only be exercised
in a packaged build, which is exactly how four events came to be dropped without anyone
noticing. A third option, deriving state in each renderer from raw events, was rejected
because two windows could then disagree; the single pushed status is what prevents that.

### The status type

`UpdateStatus` in `shared/types/ipc.ts` grows from two variants to seven. `checkedAt`
(epoch ms) rides only on the variants that follow a **completed** check, which is what
keeps this a widening change rather than a rename:

```ts
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; checkedAt: number }
  | { state: "available"; version: string; checkedAt: number }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string; checkedAt: number };
```

Every existing consumer keeps working untouched. `app-root.tsx` narrows with
`update.state === "ready" && <UpdateBanner version={update.version} />`, and
`use-update-status.ts` seeds from `{ state: "idle" }`. Both stay valid.

### The reducer

New file `src/shared/updater-state.ts`, pure, no imports from electron or the DOM:

```ts
export type UpdaterEvent =
  | { type: "check-started" }
  | { type: "available"; version: string; at: number }
  | { type: "not-available"; at: number }
  | { type: "progress"; version: string; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string; at: number };

export function nextUpdateStatus(current: UpdateStatus, event: UpdaterEvent): UpdateStatus;
export function canStartCheck(status: UpdateStatus): boolean;
export function shouldCheckOnFocus(lastCheckStartedAt: number | null, now: number): boolean;
```

Three rules carry the weight, and each is a test:

- **A downloaded build outranks everything.** Once `ready`, a later failed or empty check
  must not mask it. The user has a working update on disk; nothing may hide it.
- **A check is refused while one is in flight or a download is running.**
  `canStartCheck` returns false for `checking` and `downloading`. `electron-updater` is
  not re-entrant during a download, and the manual button makes a second call reachable
  for the first time.
- **Progress only advances a download.** A stray `progress` event against `idle` is
  ignored rather than inventing a download the user never started.

`shouldCheckOnFocus` is the throttle, with `UPDATE_FOCUS_THROTTLE_MS = 30 min` beside it.
It mirrors `VERSION_GATE_THROTTLE_MS` (10 min) in shape; the interval is longer because a
125 MB download is a heavier consequence than a version-gate config fetch.

### The adapter

`main/updater/auto-updater.ts` keeps `app.isPackaged` as its guard and gains:

- Handlers for all six `electron-updater` events, each one a `nextUpdateStatus` call.
- **Broadcast to every window**, not just the main one. Today the push is
  `getMainWindow()?.webContents.send(...)`; with a second window open, one of them holds a
  stale status. `BrowserWindow.getAllWindows()` fixes it in a line.
- `checkForUpdatesNow(): Promise<UpdateStatus>` for the button, guarded by
  `canStartCheck`. When the guard refuses, it returns the current status unchanged instead
  of starting a second check.
- A `browser-window-focus` check gated by `shouldCheckOnFocus`.
- The six-hour interval, unchanged, as the fallback.

### IPC and preload

One new channel. `update:get-status`, `update:status` and `update:install` already exist.

| Channel        | Kind     | Purpose                                             |
| -------------- | -------- | --------------------------------------------------- |
| `update:check` | `invoke` | Run a check now; resolves with the resulting status |

`KaipuElectronAPI` gains `checkForUpdates(): Promise<UpdateStatus>`, exposed in
`src/preload/index.ts` next to `getUpdateStatus`.

## The UI

A new `Updates` section on the **App** settings page, built from the existing `Section`
and `Row` primitives, following `screenshot-save-settings.tsx`. It is a section rather
than a new sidebar entry because it is two rows and the nav already carries seven items.

| Row         | Content                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| **Version** | `Kaipu Record 0.8.0` from the existing `getAppVersion()`, with the last-checked time as the description |
| **Status**  | One line following the state, with the matching button                                                  |

**On the last-checked line.** `checkedAt` rides only on `up-to-date`, `available` and
`error`, so `checking`, `downloading` and `ready` carry no timestamp. The row shows the
time when the current status has one and **omits the description entirely when it does
not** — it never renders a stale or invented value. This is deliberate: during those three
states the status line below is the more informative of the two, and persisting a
last-checked value across states would mean either widening every variant or holding
renderer state that resets on unmount. Neither is worth it for a nicety.

State to copy to button:

| State         | Copy                                   | Button                               |
| ------------- | -------------------------------------- | ------------------------------------ |
| `idle`        | "Not checked yet."                     | Check for updates                    |
| `checking`    | "Checking…"                            | disabled                             |
| `up-to-date`  | "You're on the latest version."        | Check for updates                    |
| `available`   | "Version {v} is available."            | disabled (download starts by itself) |
| `downloading` | "Downloading {v} — {n}%"               | disabled                             |
| `ready`       | "{v} is ready to install."             | Restart and install                  |
| `error`       | "Couldn't check for updates." + reason | Try again                            |

`autoDownload` stays `true`, so `available` is a brief pass-through on the way to
`downloading` rather than a state the user must act on.

In development the section renders "Updates are disabled in development builds" instead
of a dead button, keyed off `import.meta.env.DEV` — the same signal `settings-layout.tsx`
already uses for the Developer nav entry.

Copy lives in the existing `updates` namespace of `packages/i18n/messages/{en,es}.json`,
which currently holds `ready`, `restart`, `close`, `update` and `updateRequired`.

## Files

| File                                                  | Change                                             |
| ----------------------------------------------------- | -------------------------------------------------- |
| `src/shared/updater-state.ts`                         | new, pure reducer + guards + throttle constant     |
| `src/shared/updater-state.test.ts`                    | new, the rules above                               |
| `src/shared/types/ipc.ts`                             | grow `UpdateStatus`, add `updateCheck` channel     |
| `src/shared/types/electron-api.ts`                    | add `checkForUpdates()`                            |
| `src/preload/index.ts`                                | expose it                                          |
| `src/main/updater/auto-updater.ts`                    | six event handlers, broadcast, manual check, focus |
| `src/main/index.ts`                                   | register the handler, wire focus                   |
| `src/renderer/src/pages/settings/update-settings.tsx` | new section component + test                       |
| `src/renderer/src/pages/settings/settings-pages.tsx`  | mount the section on the App page                  |
| `packages/i18n/messages/{en,es}.json`                 | the copy above                                     |

## Non-goals

- **No off switch.** Automatic updates stay mandatory. Owner's explicit call.
- **No release-notes link.** Deferred; it needs a stable URL per version and adds nothing
  to the question the owner actually hit.
- **No channels or downgrades.** The feed is single-channel.
- **Not a replacement for the version gate.** The gate is the fail-open kill-switch that
  works without the updater. This page is the updater's face. They already share the
  restart banner.

## Acceptance

- [ ] Older packaged build, newer version on the feed: **Check for updates** goes
      checking → downloading with moving progress → ready, and **Restart and install**
      installs it. No six-hour wait.
- [ ] On the latest version, the button reports "You're on the latest version" with a
      last-checked time that updates.
- [ ] Airplane mode: the error copy shows with its reason, **Try again** recovers when
      back online, nothing throws.
- [ ] Pressing the button during a download does not start a second one.
- [ ] Two windows open: both show the same status.
- [ ] `bun run dev`: the section explains updates are off in development.

**Verification caveat, stated plainly:** none of the first five can be verified in
development, because `initAutoUpdater` returns early when the app is not packaged. They
need a packaged build one version behind the live feed. The reducer's rules are unit-
tested and provable in CI; the wiring is not, and must be signed off on hardware.
