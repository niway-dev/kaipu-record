---
title: "Edit-state indicators — saving, and edited-but-not-exported"
description: "Proposal: a save-state indicator in the video editor (autosave makes 'unsaved changes' a sub-second state) and an 'edited, not exported' badge in the library, so nobody shares the original .mp4 believing it carries the zoom and the blur."
---

# Edit-state indicators

> **Status: 🟢 Ready to validate** — implemented in [#PR](https://github.com/csdev19/kaipu-record-monorepo/pull/PR) (2026-09-23). Originally proposed following validating video editor v2 PRs 5–6
> ([backlog](./video-editor-zoom-blur-cover)): the owner left the editor, came back, and
> the zoom edits were still there — and asked how long that lasts and whether we need a
> "changes without saving" chip. This doc answers both and proposes two small UI pieces.
> Shipped as a sibling PR on top of v2 PR 10 (polish), where the
> "ORIGINAL UNTOUCHED" pill lives.

## How long edits last (the answer)

**Indefinitely, until the recording is deleted.** Edits are not app state; they are a
session file in the vault next to the video:

```
<vault>/.kaipu/<id>.edit.json        the scene: cuts, annotations, slides, zooms, redactions
<vault>/.kaipu/<id>.edit.meta.json   { savedAt, … }
```

Since v2 PR 5 the editor **autosaves** it: a write is scheduled 800 ms after any change,
never during a drag, and flushed on unmount and `beforeunload`. The session is
`version: 1` with the v2 fields optional, so it survives app restarts and updates — a
pre-v2 build opens it and ignores the zooms. It is deleted with the recording.

The library already detects it: `hasEditSession()` sets the item's `editing` state to
`"project-available"`, which today surfaces only as a line of text on the detail page
(`editingProjectAvailable`). The card shows nothing.

## Why "unsaved changes" is the wrong chip

With autosave, "unsaved" exists for about 800 ms, or after a failed write. A chip for
that state would be either invisible or alarming. The state that actually causes harm is
different:

> **The `.mp4` in the vault is still the original.** Exporting is the only moment the
> zoom, the cursor and the privacy regions are burned into a file. A user who edits, sees
> the edits persist, and then shares the vault file from Finder — or uploads it — ships
> the **unedited** recording, blur included. For redactions that is a leak.

Nothing in the UI says so today beyond the export dialog's note. So the indicator worth
building is **edited, not exported**, and the save state is a secondary, cheap courtesy.

## Proposal

Two indicators, each where its question is asked.

### 1. In the editor — save state

Next to the `ORIGINAL UNTOUCHED` pill in the editor header (v2 PR 10):

| State                           | Chip                                                    | Driven by                                                        |
| ------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- |
| A write is pending or in flight | `Guardando…` / `Saving…`                                | `autosave.pendingRef` (expose it as React state, not only a ref) |
| Last write succeeded            | `Guardado` / `Saved` (fades after ~2 s, or stays muted) | write resolved                                                   |
| Last write failed               | `No se pudo guardar` / `Couldn't save` + retry on click | write rejected                                                   |

Same pattern as Google Docs. It does not replace the discard dialog (which already means
"a write is still pending"); it makes the dialog rare-and-explained instead of
rare-and-surprising.

### 2. In the library — edited, not exported

On the video card and the detail page:

| Condition                                                                            | Badge                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session exists **and** no export derived from this recording is newer than `savedAt` | `Editado · sin exportar` / `Edited · not exported` (accent, with a tooltip: "The file on disk is the original. Export to get a video with your edits.") |
| Session exists and a newer export exists                                             | `Editado` / `Edited` (muted)                                                                                                                            |
| No session                                                                           | nothing (as today)                                                                                                                                      |

The data is already there: exports link back to their source via `derivedFromAssetId`,
and the session's `edit.meta.json` carries `savedAt`. The probe that computes
`editing` runs per item on `list()` and is deliberately `stat`-only; comparing one
timestamp against the item's exports keeps it that cheap.

Clicking the badge opens the editor. On the detail page it sits where the
`editingProjectAvailable` line is today and replaces it.

## Copy (neutral Spanish, English)

| Key                             | es                                                                                   | en                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `videoEditor.saveStateSaving`   | Guardando…                                                                           | Saving…                                                                  |
| `videoEditor.saveStateSaved`    | Guardado                                                                             | Saved                                                                    |
| `videoEditor.saveStateFailed`   | No se pudo guardar. Toca para reintentar.                                            | Couldn't save. Click to retry.                                           |
| `library.editedNotExported`     | Editado · sin exportar                                                               | Edited · not exported                                                    |
| `library.editedNotExportedHint` | El archivo en disco es el original. Exporta para obtener un video con tus ediciones. | The file on disk is the original. Export to get a video with your edits. |
| `library.edited`                | Editado                                                                              | Edited                                                                   |

## Scope

- **In:** the two indicators above, their i18n keys, a `lastExportAt` (or equivalent)
  comparison in the library probe, tests for the three badge conditions.
- **Out:** blocking navigation on unsaved edits (rejected — the owner prefers being able
  to leave; autosave makes it safe); a "changes since last export" diff; any change to
  when or what autosave writes; cloud sync of sessions.

## Alternatives considered

- **Block leaving the editor while dirty.** Rejected: autosave already makes leaving
  safe, and the owner explicitly prefers the "come back and it's as I left it" model.
- **Only the save-state chip.** Rejected as the _only_ indicator: it answers a question
  that is almost never open (800 ms) and says nothing about the file on disk.
- **A persistent banner in the editor** ("your edits are not in the file"). Rejected: the
  editor already says it with the `ORIGINAL UNTOUCHED` pill and the export note; the
  missing signal is in the **library**, where the sharing decision is made.

## Reopen if

Sessions ever sync to the cloud (then "edited" has to distinguish local from remote), or
exports gain a "replace original" mode (then "not exported" needs a third state).
