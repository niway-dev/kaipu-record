---
title: "Edit-state indicators — saving, and edited-but-not-exported"
description: "Proposal: a save-state indicator in the video editor (autosave makes 'unsaved changes' a sub-second state) and an 'edited, not exported' badge in the library, so nobody shares the original .mp4 believing it carries the zoom and the blur."
---

# Edit-state indicators

> **Status: 🟢 Ready to validate** — implemented in [#156](https://github.com/csdev19/kaipu-record-monorepo/pull/156) (2026-09-23), then
> **corrected** in [#159](https://github.com/csdev19/kaipu-record-monorepo/pull/159) after prod review found the badge wrong on every export
> ([see below](#correction-the-badge-rule-was-wrong-in-every-case)). Originally proposed following validating video editor v2 PRs 5–6
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

> ⚠️ **Superseded.** The rule in this table shipped and was wrong in every case. The
> rule that actually shipped is in
> [Correction](#correction-the-badge-rule-was-wrong-in-every-case) below; this table is
> kept to show what was proposed.

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

| Key                             | es                                                                                        | en                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `videoEditor.saveStateSaving`   | Guardando…                                                                                | Saving…                                                                         |
| `videoEditor.saveStateSaved`    | Guardado                                                                                  | Saved                                                                           |
| `videoEditor.saveStateFailed`   | No se pudo guardar. Toca para reintentar.                                                 | Couldn't save. Click to retry.                                                  |
| `library.editedNotExported`     | Editado · sin exportar                                                                    | Edited · not exported                                                           |
| `library.editedNotExportedHint` | El archivo en disco es el original. Exporta para obtener un video con tus ediciones.      | The file on disk is the original. Export to get a video with your edits.        |
| `library.edited`                | Editado                                                                                   | Edited                                                                          |
| `library.editedStale`           | Últimas ediciones sin exportar                                                            | Latest edits not exported                                                       |
| `library.editedStaleHint`       | Tus ediciones más recientes no están en ningún archivo. Exporta de nuevo para incluirlas. | Your newest edits are in no file yet. Export again to include them.             |
| `library.originalLabel`         | Original                                                                                  | Original                                                                        |
| `library.originalPlayerNote`    | Tus ediciones no se muestran aquí — abre el editor para verlas, o reproduce un export.    | Your edits are not shown here — open the editor to see them, or play an export. |

## Correction: the badge rule was wrong in every case

Found during prod review of #156, on the very first edited recording: the detail page
showed `Edited · not exported` directly above a populated **EXPORTS** section listing
the export it was claiming did not exist.

### Why it could never have worked

The shipped rule compared two clocks:

```ts
newest.createdAt >= video.editSavedAt ? "edited" : "not-exported";
```

Both halves are the wrong end of their interval.

- An export's `createdAt` is `birthtimeMs` (`library-vault.ts`) — the moment the encode
  **started**, not when the file was finished.
- Exporting **always** writes the session immediately afterwards. This is not the
  autosave debounce: `video-editor-page.tsx`'s `onSaved` callback explicitly saves the
  scene before navigating away, so the user can reopen the project later.

So `editSavedAt` lands after the export's birthtime on every successful export, by
construction. Measured on the recording that surfaced this: the export's birthtime was
24 s before its own `savedAt`, and the session write landed 5 ms after the encode
finished. A longer encode only widens the window — the comparison never had a correct
case, and no test caught it because the fixtures chose timestamps that agreed with the
rule rather than ones a real export produces.

### The rule that replaced it

Identity, not chronology. The question is _"is this scene's content in a file?"_, which
a stamp answers exactly and two clocks cannot.

`SessionMeta` gains `exportedSavedAt`. The save that follows an export passes
`exported: true` and stamps that write's own `savedAt`; every other save carries the
previous stamp forward untouched. The badge becomes an equality:

| Condition                                                    | Badge                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Session, and no export of this recording exists              | `Editado · sin exportar` / `Edited · not exported` (accent)             |
| Session, an export exists, `exportedSavedAt !== savedAt`     | `Últimas ediciones sin exportar` / `Latest edits not exported` (accent) |
| Session, an export exists, `exportedSavedAt === savedAt`     | `Editado` / `Edited` (muted)                                            |
| No session, or the item is itself an export, or a screenshot | nothing                                                                 |

Two details are load-bearing:

- **`exportsOf` decides whether an export exists; the stamp only decides whether it is
  current.** Deleting the only export returns the badge to "not exported" however recent
  the stamp is — the badge is about whether a _file_ carries the edits.
- **Sessions written before the stamp existed read as "latest edits not exported".**
  That points at the export button; reading them as `Edited` would promise a file
  nothing recorded the existence of.

### The third state earns its own copy

"Never exported" and "exported, then edited again" are identical to the file system and
different to the user. Showing the first one's copy above a visible Exports section is
what made the original screenshot read as a bug. Both keep the accent style — in both,
some edit exists in no file.

(The "Reopen if" note below anticipated a third state arriving with a "replace original"
mode. It arrived for an unrelated reason.)

## Correction: the player never showed the edits, and never said so

Same review, same root cause from the other side. The detail page's player is
`RecordingPlayer`, streaming `kaipu-media://recording/<id>` — the vault file, which
[ADR 0003](/architecture/decisions/0003-export-never-replaces-the-original/) guarantees
is the untouched original. **Edits are never composited there**: they are visible only in
the editor's preview and burned in only by an export.

Nothing on the page said so, which is what turned the badge into an apparent
contradiction — a "not exported" pill above a player that was, correctly, showing the
unedited video.

The fix is a caption under the player on any recording that is not itself an export:

> **ORIGINAL** · Your edits are not shown here — open the editor to see them, or play an export.

It does three jobs. It answers "which item is the original?" from the structural fact
(`derivedFromAssetId === null`) rather than the `(edited)` title suffix, which ADR 0003
already flagged as fragile. It explains the badge above it. And it makes ADR 0003's
promise **checkable** — press play and see the original is still whole, which is the
reassurance the owner asked for when the original is wanted back after a redaction goes
too far.

It is deliberately _not_ a toggle. Both halves of "view with edits / view plain" already
exist — the plain one is this player, the edited one is the export listed below — so
compositing the scene a second time in the library would duplicate the editor for no
new capability.

## Scope

- **In:** the two indicators above, their i18n keys, the `exportedSavedAt` stamp in the
  session probe, the player caption, tests for every badge condition.
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
