---
title: "Synced workspaces — a workspace in a folder of your Google Drive, OneDrive or iCloud"
description: "Proposal: connect a workspace to a specific folder of a specific cloud account on this Mac; the provider's own client syncs it. Download cloud-only files with progress, see where each file is, free space by evicting, and get warned when the provider is disconnected or made a conflict copy."
---

# Synced workspaces

> **Status: 🔵 Proposed** (2026-11-22). Decisions approved by the owner in conversation; the spec
> is in its design PR. Design:
> [Synced workspaces](/specs/2026-11-22-synced-workspaces-design/) · ADRs
> [0068](/architecture/decisions/0068-a-workspace-is-the-root-and-accounts-are-optional-connections/)
> and
> [0069](/architecture/decisions/0069-kaipu-syncs-through-the-providers-own-client-and-evicts-never-deletes/)
> · Linear [NIW2-912](https://linear.app/niway/issue/NIW2-912). Flag: `synced-workspaces`.

## Why

The workspace is where the user works. Many users already keep their files in Google Drive,
OneDrive or iCloud, often with a personal and a company account. They want captures to land in a
specific folder of a specific account, synced by the provider they already use, without Kaipu
asking for another login.

## What it adds

- **Connect a cloud folder…**: pick an account found on this Mac, then a folder in it (for example
  `folder1/kaipu-assets`). That folder becomes the workspace.
- **Cloud folder features**, a per-workspace switch under Settings → Workspaces → Connections. On for
  a workspace made with "Connect a cloud folder…", off for a folder that became synced some other
  way; a user who never turns it on never sees any provider wording.
- **Download from the cloud** for a file the provider has offloaded, with a message and progress.
- **Where each file is**: "On this Mac" or "Cloud only" (and "Uploading"/"Uploaded" if macOS
  reports it for that provider).
- **Free up space**: asks the provider to evict a file, never deletes it.
- **Warnings** when the provider is not running and when it made a conflict copy.
- **A help page** on keeping a workspace in a cloud folder.

The safety rules for synced folders (no half-written uploads, no hard links, no implicit reads of
offloaded files) always run, with or without the switch.

## Not in it

Proxy editing (next design), team collaboration and Kaipu Cloud teams (separate design), provider
APIs, streaming, Windows.
