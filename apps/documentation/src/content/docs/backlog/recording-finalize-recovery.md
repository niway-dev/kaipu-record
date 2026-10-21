---
title: "Recording finalize recovery"
description: "A take no longer disappears when the desktop app cannot move it into the vault: finalize failures offer a Save As dialog, the file is staged inside the vault, and a launch sweep recovers stranded .part files."
---

# Recording finalize recovery

> **Status: 🟢 Ready to validate** — branch `fix/audit-02-recording-finalize-recovery`
> (PR #359, 2026-10-21). Not in a release yet.

## What it does

While recording, the desktop app streams the MP4 to a `kaipu-rec-<session>.mp4.part` file.
When recording stops, it moves that file into the vault. Before this change, a failed move
(vault folder missing, drive unplugged, permissions, disk full) lost the take, and a crash
mid-recording left an orphan `.part` file nobody looked at.

- **Staging inside the vault.** The `.part` file lives in `<vault>/.kaipu/tmp`, so the final
  move is a same-volume rename. If that folder cannot be created, the app falls back to the OS
  temp folder.
- **Finalize failure keeps the take.** If the move fails, the `.part` file stays on disk and the
  app opens a Save As dialog so the user can pick another location. The chosen path is moved
  with overwrite allowed, because the native dialog already asked the user to confirm replacing
  an existing file. If the user cancels or the save fails, the renderer tells them the take was
  kept and will be recovered.
- **Launch sweep.** At startup, before the first Library list, the app scans
  `<vault>/.kaipu/tmp` and the OS temp folder for `kaipu-rec-*.mp4.part` files older than two
  minutes. Empty files are deleted. The others are moved into the vault as a localized
  "Recovered recording" (a part left by a crash mid-take has no `moov` atom and may not play;
  the user can delete it).

## How to validate manually

1. **Save elsewhere.** Make the vault unwritable (set the recordings folder to a folder, then
   rename or remove it, or eject the drive) and record a few seconds. Stop. Expect the Save As
   dialog. Pick a path and confirm the MP4 plays. Repeat, choosing an existing file in the
   dialog and confirming the overwrite: expect it to be replaced.
2. **Cancel the dialog.** Repeat step 1 and cancel. Expect the "kept, will recover" message and
   the `.part` file still in the staging folder.
3. **Launch sweep.** With the app closed, copy a non-empty file to
   `<vault>/.kaipu/tmp/kaipu-rec-test.mp4.part` and set its modified time to at least two
   minutes ago (`touch -t`). Launch the app. Expect a "Recovered recording" (or "Grabación
   recuperada" in Spanish) in the Library and the staging folder empty.
4. **Fresh files are left alone.** Repeat step 3 with a file modified less than two minutes ago.
   Expect it to stay in place.

## Limits

- The sweep relies on the single-instance lock and runs once at launch, so it does not touch
  the current session's recording. A development build and a packaged build use different
  user-data folders, so they do not share a lock; the two-minute age check is the only guard
  between them, and it only matters when the vault staging folder is unavailable and the OS
  temp folder is used.
