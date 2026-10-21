---
title: "Editor — name the capture before saving"
description: "Proposal: a title input in the screenshot editor's toolbar, prefilled with the auto-generated name, editable before saving and after — so a capture is named where it is made instead of renamed later in the Library."
---

# Editor — name the capture

> **Status: 🟢 Ready to validate** — implemented 2026-10-07 (NIW2-115). Owner: "when we save
> a document, show the input with the name; if a capture already has a name we should be
> able to edit it right there." Validate on a packaged build, then fold into a
> `desktop/` reference doc.

## Shipped (2026-10-07)

- `features/screenshots/use-capture-title.ts` — the field's rules (committed title,
  draft, commit / revert / adopt), free of IPC so they are unit-tested.
- `features/screenshots/capture-title-input.tsx` — the toolbar field: Enter or blur
  commits, Esc reverts, placeholder = auto title.
- `screenshot-editor-page.tsx` — Save writes the field (the live draft, so a Save that
  lands before blur still gets the typed name); on a saved shot a changed commit calls
  `renameLocalRecording` and reports a failure with a retry; Save copy and the
  overwrite dialog use the committed title.

## Before

`screenshot-editor-page.tsx` computed the title once and never showed it:

```ts
const [baseTitle] = useState(() => source.title ?? `${t("screenshotPrefix")} — ${new Date().toLocaleString()}`);
```

Save wrote that string. The only way to change it was to find the item in the Library
afterwards and use the inline rename there (`RecordingTitle`). So every capture was named
`Screenshot — 23/9/2026, 16:08:31` until someone went looking for it.

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
