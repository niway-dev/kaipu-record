---
title: Electron security hardening for cloud accounts
description: Reduce renderer privilege and tighten navigation, IPC, protocol, and permission boundaries before Desktop handles cloud sessions.
---

# Electron security hardening for cloud accounts

> **Status: 🔵 Proposed.** Blocking Desktop cloud-recordings integration.

## Problem

Kaipu currently ships local UI, but cloud accounts introduce session-bearing network flows. All
current BrowserWindows explicitly use `sandbox: false`; navigation and external-link policy are not
centralised; sensitive IPC handlers do not consistently validate their sender; and the local media
protocol opts out of CSP with `bypassCSP: true`.

## Required work

1. Enable `sandbox: true` and explicitly set `contextIsolation: true` for every renderer window.
   Record any required preload migration rather than silently retaining elevated renderers.
2. Centralise and test navigation policy: only the packaged app or the exact trusted development
   origin may load in an app window.
3. Allow `shell.openExternal` only for parsed, allowlisted `https:` destinations.
4. Register a permission-request policy for every session; deny by default and grant only the
   capture permissions the relevant Kaipu window needs.
5. Validate the sender/origin for privileged IPC handlers. Keep preload APIs capability-specific;
   never expose raw `ipcRenderer` or broad filesystem/network access.
6. Remove `bypassCSP` from `kaipu-media` unless a tested requirement proves it necessary. Replace
   it with a restrictive CSP that declares the custom scheme only where required.
7. Enable Electron security warnings in development and assess relevant Electron fuses before
   release packaging.

## Acceptance criteria

- All renderer windows are sandboxed and context-isolated in the packaged app.
- Untrusted navigation, popup URLs, unsupported protocols, and unexpected permission prompts are
  denied in automated tests.
- A forged IPC request from an untrusted or unexpected sender is rejected.
- Local media playback, export, capture panels, updates, and the complete existing test suite still
  work under the hardened policy.

## Non-goals

- Loading arbitrary remote web content inside the Desktop app.
