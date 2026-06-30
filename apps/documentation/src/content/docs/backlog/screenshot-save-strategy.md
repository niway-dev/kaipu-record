---
title: Screenshot save strategy (auto-save, naming, re-save)
description: Tradeoff analysis for how the screenshot editor persists captures to the unified vault — auto-save vs explicit save, the timestamped naming scheme, overwrite vs save-a-copy on re-edit, and how the answer shifts once a re-editable scene doc is persisted.
---

# Screenshot save strategy (auto-save, naming, re-save)

> **Status: 🟡 Partially shipped** (on `feat/screenshots`). **Naming** is decided and live:
> saved shots are titled `Screenshot — <locale date/time>`, stamped at capture time (mirrors
> recordings' `Recording — <date>`), so they're told apart by when they were taken; the file id
> stays `screenshot-<iso>`. **Library detail** now branches by `kind` on the single `/library/:id`
> route — recordings get the player, screenshots get a `ScreenshotViewer` (+ Copy/Reveal/Delete).
> Still 🔵: auto-save vs explicit save, and overwrite-vs-copy on re-edit (below).

## Problem / context

The screenshot editor captures → beautifies → annotates → exports a **flat composited PNG**.
Today "Guardar" writes that PNG into the unified vault via `saveScreenshot(bytes, {title})` →
`<id>.png`, where `id = screenshot-<iso-timestamp>` (mirroring how recordings name their files).
Recordings are **auto-saved on finalize**; screenshots require an explicit click. The vault is the
unified Library (recordings + screenshots, distinguished by a `kind` discriminator) and is served
back through `kaipu-media://`. The owner is undecided on the save UX. This doc captures the
tradeoffs so the decision is made once, deliberately.

## 1. Auto-save vs explicit save

**Options.** (a) **Auto-save every capture** to the vault the moment the editor opens (or on first
edit), timestamped, exactly like recordings. (b) **Explicit save** — the bytes live only in memory
until the user clicks "Guardar"; closing without saving discards.

**Tradeoffs.** Auto-save wins on **data-loss safety** (a capture is never lost to a crash or a
mis-click) and on **parity with recordings** — one consistent mental model, "anything I capture is
in my Library". Its cost is **vault clutter**: throwaway captures (a quick measurement, a color
pick) become permanent rows the user must prune. Explicit save keeps the Library curated and matches
the OS screenshot mental model (Cmd-Shift-4 doesn't save until you decide), but every unsaved capture
is one crash or fat-finger away from gone — and recordings already taught the user "capture = kept".

**Recommendation.** **Auto-save**, for safety and recording-parity — but soften the clutter:
auto-save to the vault, and let the editor's "Guardar" be a **no-op confirmation** (already saved)
rather than the only thing standing between a capture and oblivion. Add lightweight pruning later
(multi-select delete, or a "discard" action in the editor that removes the auto-saved row). Treat
auto-save as the floor; curation tools are the follow-up.

## 2. Naming

**Options.** (a) Keep `screenshot-<iso-timestamp>` as both id and default title. (b) A friendlier
default title ("Captura 1", "Captura 29 jun") **decoupled** from the collision-safe id, with rename.

**Tradeoffs.** The ISO timestamp is **collision-safe** (monotonic, unique per capture) and
**naturally sortable** (lexicographic = chronological), which is exactly what the id/filename needs.
But as a **Library title** it reads poorly — `screenshot-2026-06-29T14:32:08.123Z` is noise to a
human scanning thumbnails. Recordings share this wart, so fixing it benefits both kinds.

**Recommendation.** **Split the two concerns.** Keep the ISO timestamp as the **internal id /
filename** (collision-safety + sortability are non-negotiable there). Derive a **human default
title** for the Library — e.g. "Captura · 29 jun 14:32" (neutral Spanish, see copy rules) — and make
it **renamable** in place. The id never changes; the title is just metadata. This is a Library-wide
improvement, not screenshot-specific; do it once for both kinds.

## 3. Re-save after editing a saved screenshot

**Options.** When a saved screenshot is re-opened, modified, and "Guardar" is pressed:
(a) **Overwrite** the original `<id>.png`. (b) **Save a copy** under a new id, preserving the original.

**Tradeoffs.** Overwrite keeps the vault lean and matches "I'm fixing this image". But because we
export a **flat PNG with no re-editable source** (see §4), overwrite is **destructive and
irreversible** — the previous pixels are gone, no undo across sessions. Save-a-copy is
**non-destructive** and gives a poor-man's version history, at the cost of vault growth and "why do I
have three near-identical captures?" confusion.

**Recommendation.** **Default to overwrite** (lean vault, matches user intent of "edit this
screenshot"), and offer an explicit **"Guardar como copia"** for when the user wants to branch. This
keeps the common path simple while making preservation a deliberate, discoverable choice. Caveat:
overwrite is only safe-by-intent while edits are shallow; the moment re-edit becomes lossless (§4),
revisit the default.

## 4. Interaction with the editable document

Today there is **no persisted scene doc** — "Guardar" flattens background + framed shot + annotations
into one PNG and throws the scene away. So "re-open and edit" really means "load a PNG and draw on
top of it"; the original beautify/annotation layers are unrecoverable. That makes the §3 overwrite
default tolerable: there's no richer source to protect.

**Dependency to flag.** If **re-editable persistence** lands later (the editor saves the scene model
— background settings, layers, annotation paths — alongside or instead of the flat PNG, à la the
`SceneDoc` referenced in the [export-formats seam](./export-formats)), the §3 calculus changes:

- Overwrite now risks clobbering a **rich, lossless source**, not just a raster — the cost of getting
  it wrong goes up, pushing toward **copy-on-edit** or true versioning.
- "Save a copy" becomes cheap and meaningful (fork the scene, not just the pixels).
- The vault row likely needs to carry **both** the scene doc (for editing) and a rendered PNG (for
  `kaipu-media://` thumbnails and external sharing), which interacts with the storage layout.

Until then, do **not** build versioning machinery; just leave the seam open.

## Phasing — now vs later

1. **Now:** ship **auto-save** (safety + recording-parity) with **overwrite** as the re-save default
   and an explicit **"Guardar como copia"**. Keep the ISO timestamp id/filename as-is.
2. **Soon:** Library-wide **human-friendly default titles + rename** (decoupled from the id), and
   lightweight **pruning/discard** to offset auto-save clutter.
3. **Later (gated on re-editable scene persistence):** revisit overwrite-vs-copy — a persisted
   `SceneDoc` likely flips the default toward copy-on-edit / versioning, and reshapes the vault row.
