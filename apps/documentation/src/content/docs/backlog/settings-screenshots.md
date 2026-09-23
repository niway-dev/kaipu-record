---
title: "Settings → Screenshots: save automatically or on click"
description: "Proposal: a Screenshots section in Settings with one toggle — save every capture to the Library automatically (recording parity) or keep it in the editor until the user clicks Save — resolving the open decision in the screenshot save strategy doc as a user preference instead of a single product answer."
---

# Settings → Screenshots

> **Status: 🟢 Ready to validate — implemented in [#155](https://github.com/csdev19/kaipu-record-monorepo/pull/155) (2026-09-23)**.
> Owner request: a Screenshots section in Settings with a control that decides whether a
> screenshot is saved automatically or requires a click on Save. Parent:
> [screenshot save strategy](./screenshot-save-strategy) (the tradeoff analysis;
> "auto-save vs explicit save" is still 🔵 open there) · [settings roadmap](./settings-roadmap).

## Context

The screenshot editor today keeps the capture in memory until "Save" writes the flat PNG
into the vault. Recordings, by contrast, are always saved on finalize. The
[save strategy doc](./screenshot-save-strategy#1-auto-save-vs-explicit-save) weighed the
two and recommended auto-save for data-loss safety and recording parity, with the
clutter cost (throwaway captures becoming Library rows) as the reason to hesitate.

The owner's answer is to **not pick for everyone**: make it a preference, defaulting to
the safe choice.

## Proposal

**Settings → Screenshots** (new section on the App page, or its own entry when more
screenshot settings arrive) with one row:

| Row                  | Control                                              | Default       |
| -------------------- | ---------------------------------------------------- | ------------- |
| **Save screenshots** | Segmented: **Automatically** · **When I click Save** | Automatically |

Description under the row: "Automatically keeps every capture in your Library the moment
it is taken. When I click Save keeps it in the editor until you save it — closing without
saving discards it."

### Behaviour

- **Automatically**: the vault row is created as soon as the editor opens, titled
  `Screenshot — <date/time>` (naming is already decided and live). The editor's Save
  becomes a confirmation of the current state — it overwrites the same row with the
  edited PNG (the re-save question in the parent doc applies unchanged). A **Discard**
  action in the editor deletes the auto-saved row, which is the pruning tool the parent
  doc asked for.
- **When I click Save**: today's behaviour, unchanged. Closing the editor with an unsaved
  capture asks once ("Discard this screenshot?") — the one guard against the fat-finger
  loss the parent doc worries about.
- The setting is read at capture time; changing it does not touch existing captures.

### Changes

- `AppSettings.screenshotSave: "auto" | "manual"` (default `"auto"`), validated in
  `settings.service.ts`, persisted by the settings store, surfaced through the existing
  `useAppSettings`.
- Screenshots page: on open, if `auto`, call `saveScreenshot` with the raw capture before
  the first edit; keep the returned id for subsequent saves. Add **Discard**.
- Settings page: the row above, in the same `Section`/`Row` shape as the other pages.
- Copy in `settings` namespace (en + es).

## Non-goals

- Choosing the destination folder per screenshot (the vault is the single Library).
- Formats other than PNG — see [export formats](./export-formats).

## Acceptance

- [ ] Default install: take a screenshot, close the editor without touching Save — the
      capture is in the Library.
- [ ] Switch to "When I click Save": take a screenshot, close without saving — prompted;
      confirm — nothing in the Library.
- [ ] Auto mode: edit, then Save — the same row is updated, no duplicate. Discard removes
      it.
- [ ] Both modes: the toggle state survives a restart and is reflected in both languages.
