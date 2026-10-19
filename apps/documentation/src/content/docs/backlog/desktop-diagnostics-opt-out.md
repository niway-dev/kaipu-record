---
title: Desktop diagnostics opt-out
description: The Send diagnostics toggle, what it stops, and the installer privacy notice SignPath requires.
---

# Desktop diagnostics opt-out

> **Status: 🟢 Ready to validate.** Toggle, runtime wiring and installer notice are in the
> branch; not yet checked in a packaged Windows build.

## Why

SignPath Foundation's code-signing terms say software that sends user data to systems the
user did not choose must describe it in a privacy policy, **show that policy during
installation**, and **let the user turn it off**. The desktop app sends PostHog error
reports and technical events, so it needs both.

## What it does

- `AppSettings.diagnosticsEnabled`, on by default, under **Settings → App → Privacy → Send
  diagnostics**. The description states the cost: with it off, the team cannot see the
  errors that install hits.
- **Main process** (`services/analytics.service.ts`): off at launch, no PostHog client is
  created. Toggling starts the client or flushes and closes it. The crash handlers are
  installed either way, so the toggle never changes whether an uncaught exception exits
  the app.
- **Renderer** (`features/analytics/analytics-client.ts`): off at launch, `posthog.init` is
  never called, so no request is made. Toggled off later, it opts out of capturing
  (`posthog-js` cannot be un-initialized); back on, it opts in. Exceptions forwarded from
  secondary windows go through the main client, so they stop too.
- Feature flags fall back to their defaults while diagnostics are off.
- **Windows installer**: `nsis.license` shows `build/installer-privacy-notice.txt` (English
  and Spanish) as the first page: what is sent, how to turn it off, the policy URL and how
  to uninstall. The file is UTF-8 with BOM because electron-builder adds one in place
  otherwise.

## Open

- Check the installer page in a packaged Windows build.
- macOS has no installer step (drag to Applications), so the notice there is the in-app
  toggle and the privacy policy. Confirm SignPath only signs the Windows build.
