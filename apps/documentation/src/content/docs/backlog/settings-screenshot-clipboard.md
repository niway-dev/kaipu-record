---
title: "Settings → Screenshots: copy to the clipboard automatically"
description: "A second, independent toggle in Settings → Screenshots that puts every fresh capture on the system clipboard the moment its editor opens, so the capture shortcut alone is enough to paste — with a combined Saved & copied indicator when both auto preferences are on."
---

# Settings → Screenshots — copy to the clipboard automatically

> **Status: 🟢 Ready to validate** — implemented on `feat/screenshot-auto-clipboard`.
> Sibling of [Settings → Screenshots: save automatically or on click](./settings-screenshots);
> parent analysis: [screenshot save strategy](./screenshot-save-strategy).

## Context

Taking a capture already opens the editor, and [auto-save](./settings-screenshots) can put it
in the Library without a click. Pasting it somewhere still required clicking **Copy**. For the
common "capture and paste it into a chat" loop, that click is the whole task.

Copying is not a substitute for saving: a user may want the clipboard without the Library row,
the Library row without touching their clipboard, both, or neither. So this is a second
preference, not a third value of the existing one.

## Decision

Two independent toggles in **Settings → Screenshots**:

| Setting            | Field                        | Default | Effect on a fresh capture           |
| ------------------ | ---------------------------- | ------- | ----------------------------------- |
| Save automatically | `AppSettings.screenshotSave` | `auto`  | Written to the Library on open      |
| Copy automatically | `AppSettings.screenshotCopy` | `auto`  | Put on the system clipboard on open |

Both default to `auto`: it is the combination with the least chance of losing a capture, and
the clipboard is cheap to overwrite.

### The four states

The editor acts on both preferences through one pure policy,
`autoActionsOnOpen(saveMode, copyMode, sourceKind)` in
`features/screenshots/auto-capture-policy.ts`:

| `screenshotSave` | `screenshotCopy` | On open                | Indicator        |
| ---------------- | ---------------- | ---------------------- | ---------------- |
| `auto`           | `auto`           | copy, then save        | _Saved & copied_ |
| `auto`           | `manual`         | save only              | _Saved_          |
| `manual`         | `auto`           | copy only              | _Copied_         |
| `manual`         | `manual`         | nothing — today's flow | —                |

Rules that hold across all four:

- **Fresh captures only.** A screenshot re-opened from the Library (`source.kind === "local"`)
  triggers neither action: re-opening is browsing, not capturing, and it must not create a
  duplicate row or overwrite whatever the user has on their clipboard.
- **On open, not per edit.** The auto actions fire once, when the image is first exportable.
  Annotating afterwards does not re-copy or re-save — that would be thousands of writes.
  The explicit **Copy** and **Save** buttons are how an edited version is taken.
- **Sequential, copy first.** Both paths composite the same scene and take the editor's `busy`
  lock, so running them together would silently drop one. Copy goes first because it is what
  the user is waiting on; the save round-trips to disk.
- **The modes are read once, on open.** Changing the preference while an editor is open does
  not retroactively save, un-save or copy that capture.
- **Failures degrade, never lie.** A failed auto-save leaves the editor dirty and guarded with
  a retry (unchanged behaviour); a failed auto-copy reports with a retry and the indicator
  simply does not light.

## Out of scope

- Copying at capture time in the main process, before the editor opens. It would be faster,
  but it would put the **unframed** PNG on the clipboard while the editor shows the beautified
  one — two different images called "the capture". Revisit only if the on-open latency proves
  annoying in real use.
- Any clipboard behaviour for recordings.

## Failures this must protect against

1. A re-opened Library shot silently overwriting the user's clipboard, or creating a second row.
2. Auto-save and auto-copy racing on the `busy` lock, so only one of them actually happens.
3. Both actions firing and only one indicator showing, leaving the user unsure what happened.
4. An unknown persisted value (a `screenshotCopy` from a future build) crashing `mergeSettings`
   instead of coercing to the default.

## Validation pending

- The 2600 ms indicator window (`FEEDBACK_MS`) was tuned for a click the user made. The auto
  indicator appears without them looking; the owner will use it and say whether it needs longer.
- Real-world latency between the capture shortcut and the clipboard being ready.
