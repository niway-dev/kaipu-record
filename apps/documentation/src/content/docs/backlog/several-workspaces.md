---
title: "Several workspaces — separate libraries for work and personal"
description: "Proposal: keep several workspaces (folders with Kaipu files), one active at a time and switched from the rail, so work captures never mix with personal ones; per-workspace setting overrides; synced folders; move an item between workspaces; an additive, downgrade-safe migration."
---

# Several workspaces

> **Status: 🔵 Proposed** (2026-10-30). Design approved in conversation with the owner in
> three rounds; round 3 (2026-10-30) closed every open question. The spec is written; nothing is
> implemented. Design:
> [Several workspaces](/specs/2026-10-29-several-workspaces-design/) · ADRs
> [0032](/architecture/decisions/0032-workspaces-identity-in-the-folder-one-active/),
> [0033](/architecture/decisions/0033-moving-an-item-between-workspaces/) and
> [0034](/architecture/decisions/0034-per-workspace-setting-overrides/) · Linear
> [NIW2-370](https://linear.app/niway/issue/NIW2-370). The dependencies NIW2-394 (#410) and
> NIW2-398 (#412) are merged.

## Why

The owner records for work and for personal use. A leak of the work Library (a shared screen,
a folder sent to someone, a cloud listing) must never include personal captures, and the
reverse. Kaipu has paying customers, so the upgrade must change nothing they see and risk
nothing they have.

## What it adds

- **Workspaces**: any existing folder becomes one. Kaipu writes `.kaipu/workspace.json` (id,
  name, color, initials), and a folder that already has Kaipu files is adopted.
- **Workspaces are visible from the first launch, even with one.** The existing library becomes
  a workspace named "Default workspace". The rail shows its tile and a "+" tile, the status bar
  shows the chip, and a one-time dismissible hint ("New: workspaces — keep work and personal
  captures apart") points at the rail. Menus offer "Move to ▸ New workspace…" when no other
  workspace exists.
- **One active workspace**, switched with one click on its tile in the navigation rail, and
  named in the status bar, the window title and the tray (captures start without the main
  window). ⌘1…⌘n switch while the window is focused. The Library, editors, tags and new
  captures use it. Switching is locked while anything is being written, and is a transaction:
  editors flush and close, pending toasts are dropped, and main rejects calls from the old
  workspace.
- **"Saving to Work" everywhere a capture lands**: Record page (the line "Recording to Work ·
  Switch" replaces "Ready to record"), control bar (hidden when the bar is in the video), capture
  panel and overlay, export sheet, and the toast ("Saved to Work", a label with no move control).
- **Settings → Workspaces** replaces Settings → Files: add, rename (name, color, initials), show
  in Finder, remove from list, delete (Kaipu's files to the Trash; media never touched), and
  "Assign to workspace…" for cloud items that belong to no workspace on this Mac.
- **Move to** from a new "⋯" menu on Library cards and rows, the item page and both editors. It
  keeps the item's identity, remaps tags by name, adds a suffix on a name collision, removes the
  item's drag copies from the source, serializes with the editor's saves, and survives a crash
  (recovery checks both media files and rolls forward; it never deletes a target because a
  journal says `copying`). A recording with exports in the same workspace suggests "Move all 3"
  or "Move only the recording".
- **Select mode in the Library** (it has no selection model today): checkboxes, shift-click
  range, and a bottom bar "N selected · Move to ▸". Moves run one after another with an
  aggregate progress and a per-item failure list; a failure does not stop the rest, and a
  group is not a transaction.
- **Per-workspace settings**, in the first release of workspaces: five keys (badge, upload
  mode, recording quality, export quality, screenshot copy) can be overridden per workspace and
  inherit from "All workspaces" otherwise. Shortcuts are always global.
- **Synced folders**: a workspace may live in Google Drive, OneDrive or iCloud Drive. Kaipu
  labels it, keeps its scratch files outside it, always copies and verifies when a move
  touches it, and shows offloaded files as "In the cloud".
- **Cloud**: each cloud asset records its workspace on the server, and a Library hides the
  other workspaces' cloud items.
- **No combined Library view.** "All workspaces" exists only as the Settings scope for
  defaults.

## Before implementation

- Linear [NIW2-568](https://linear.app/niway/issue/NIW2-568), sidecar read hardening, lands
  first. It is hardened, not guaranteed: a read can still fail, and a failed read must never be
  mistaken for a missing sidecar.
- A short spike on the unverified File Provider behaviours listed in the spec (hard links,
  renames into a provider folder, offline reads of evicted files, the eviction heuristic,
  iCloud Desktop & Documents, conflict-copy names). A separate spike fills them in.
- ADR 0021 (tag sync) needs an amendment so sync is scoped per workspace before NIW2-368 is
  built.
- Server work (`cloud_asset.workspace_id` nullable, `PUT /assets/{assetId}/workspace`) should
  land before or with the first desktop upload, so no cloud row exists without a workspace.

There are no open design questions: the owner's answers of 2026-10-30 are decisions 19–25 in
the spec.
