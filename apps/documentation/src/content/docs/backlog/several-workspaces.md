---
title: "Several workspaces — separate libraries for work and personal"
description: "Proposal: keep several workspaces (folders with Kaipu files), one active at a time, so work captures never mix with personal ones; move an item between workspaces from the Library or the editor."
---

# Several workspaces

> **Status: 🔵 Proposed** (2026-10-29). Design approved in conversation with the owner. The
> spec is written; nothing is implemented. Design:
> [Several workspaces](/specs/2026-10-29-several-workspaces-design/) · ADRs
> [0032](/architecture/decisions/0032-workspaces-identity-in-the-folder-one-active/) and
> [0033](/architecture/decisions/0033-moving-an-item-between-workspaces/) · Linear
> [NIW2-370](https://linear.app/niway/issue/NIW2-370). The dependencies NIW2-394 (#410) and
> NIW2-398 (#412) are merged.

## Why

The owner records for work and for personal use. A leak of the work Library (a shared screen,
a folder sent to someone, a cloud listing) must never include personal captures, and the
reverse.

## What it adds

- **Workspaces**: any existing folder becomes one. Kaipu writes `.kaipu/workspace.json`, and a
  folder that already has Kaipu files is adopted.
- **One active workspace**, picked from a selector at the top of the sidebar. The Library,
  editors, tags and new captures use it. Switching is locked while anything is being written.
- **Settings → Workspaces** replaces Settings → Files: add, rename, show in Finder, remove
  from list, delete (Kaipu's files to the Trash; media never touched).
- **Move to workspace** from the Library and from the editor. It keeps the item's identity,
  remaps tags by name, adds a suffix on a name collision, and survives a crash.
- **Cloud**: each cloud asset records its workspace on the server, and a Library hides the
  other workspaces' cloud items.

## Before implementation

- The owner confirms the open questions in the spec: Delete vs Remove, orphaned cloud items,
  multi-select move, exports following their source, and the default name.
- ADR 0021 (tag sync) needs an amendment so sync is scoped per workspace before NIW2-368 is
  built.
- Server work (`cloud_asset.workspace_id`, `PUT /assets/{assetId}/workspace`) should land
  before or with the first desktop upload, so no cloud row exists without a workspace.
