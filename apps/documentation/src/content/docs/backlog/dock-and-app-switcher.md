---
title: "Decision — Dock and app switcher cannot be split on macOS"
description: "Owner asked to split the 'Show in Dock & app switcher' toggle into two. Analysis: macOS ties ⌘-Tab presence to the Dock icon through the activation policy, so the two cannot be controlled independently. Keep one toggle; improve its copy."
---

# Dock and app switcher — one toggle, by necessity

> **Status: ✅ Decided — no split** (2026-09-23). Owner request: "split that Show in Dock &
> app switcher option; let's analyse the split because we want one or the other."
> Analysis below; the outcome is a copy change, not a feature.

## What the toggle does

`AppSettings.showInDock` → `app.setActivationPolicy(showInDock ? "regular" : "accessory")`
in `main/infrastructure/settings-store.ts`.

## Why it cannot be two toggles

macOS exposes exactly three activation policies, and they are the only lever:

| Policy       | Dock icon | ⌘-Tab | Menu bar (own menu) | Can be key window |
| ------------ | --------- | ----- | ------------------- | ----------------- |
| `regular`    | yes       | yes   | yes                 | yes               |
| `accessory`  | no        | no    | no                  | yes               |
| `prohibited` | no        | no    | no                  | no                |

The app switcher lists **exactly the apps with a Dock icon** — it is the same
`regular` bit read twice, not two settings. There is no supported way to be in ⌘-Tab
without a Dock icon, nor to have a Dock icon and be hidden from ⌘-Tab. `app.dock.hide()`
is the same policy change by another name. Hacks (a helper `LSUIElement` app, `NSApp`
private flags) are not worth a Settings toggle.

## Decision

Keep one toggle. Rename it so it says what it actually chooses:

| Key                              | en                                                                                                 | es                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `settings.showInDock`            | Dock app                                                                                           | App en el Dock                                                                                                              |
| `settings.showInDockDescription` | On: a Dock icon and ⌘-Tab, like any app. Off: menu-bar only — macOS ties both to the same setting. | Activado: ícono en el Dock y ⌘-Tab, como cualquier app. Desactivado: solo barra de menú — macOS liga ambos al mismo ajuste. |

Small enough to ride along with the next Settings PR. Reopen only if Apple adds a policy
that separates the two.
