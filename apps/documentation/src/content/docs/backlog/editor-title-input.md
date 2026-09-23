---
title: "Editor — name the capture before saving"
description: "Proposal: a title input in the screenshot editor's toolbar, prefilled with the auto-generated name, editable before saving and after — so a capture is named where it is made instead of renamed later in the Library."
---

# Editor — name the capture

> **Status: 🔵 Proposed** (2026-09-23). Owner: "when we save a document, show the input
> with the name; if a capture already has a name we should be able to edit it right
> there." Future feature, not scheduled.

## Today

`screenshot-editor-page.tsx` computes the title once and never shows it:

```ts
const [baseTitle] = useState(() => source.title ?? `${t("screenshotPrefix")} — ${new Date().toLocaleString()}`);
```

Save writes that string. The only way to change it is to find the item in the Library
afterwards and use the inline rename there (`RecordingTitle`). So every capture is named
`Screenshot — 23/9/2026, 16:08:31` until someone goes looking for it.

## Proposal

An input in the toolbar's empty middle stretch (between the tools and Copy/Save — see the
owner's screenshot), prefilled with the auto title, `placeholder` = the auto title so an
emptied field still saves with a sensible name.

- **Fresh capture**: typing changes what Save writes. Nothing is persisted until Save.
- **Already saved** (re-opened from the Library, or auto-saved by
  [Settings → Screenshots](./settings-screenshots)): editing the field renames the vault
  item on blur / Enter via the existing `renameLocalRecording(id, title)` — the same call
  the Library's rename uses. No new IPC.
- Empty or whitespace-only reverts to the auto title rather than saving an untitled item.
- `Esc` reverts the field to the last committed value; the field never blocks Save.

## Scope

- **In**: the screenshot editor. It is where the owner asked and where the auto title is
  least informative.
- **Out for now**: the video editor's export dialog (it already asks for a name at export
  time — check before duplicating), and renaming during a recording.

## Acceptance

- [ ] Capture → type a name → Save: the Library shows that name, the file id is unchanged.
- [ ] Capture → Save without touching the field: the auto title, as today.
- [ ] Re-open a saved shot → edit the name → blur: renamed in the Library without saving a
      new copy.
- [ ] Clear the field → Save: the auto title, never an empty title.
