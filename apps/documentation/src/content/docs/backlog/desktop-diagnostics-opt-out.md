---
title: Desktop diagnostics opt-out
description: The Share usage and crash reports toggle, what it stops, what keeps running with it off, the onboarding privacy step and the installer privacy notice SignPath requires.
---

# Desktop diagnostics opt-out

> **Status: 🟢 Ready to validate** ([NIW2-849](https://linear.app/niway/issue/NIW2-849)). The
> toggle, the flags-stay-on wiring, the onboarding step and notice, and the installer notice
> are in the branch. Not yet checked in a packaged Windows build, and not yet in front of the
> owner's eyes on a real first launch.

## Why

SignPath Foundation's code-signing terms say software that sends user data to systems the
user did not choose must describe it in a privacy policy, **show that policy during
installation**, and **let the user turn it off**. The desktop app sends PostHog usage events
and crash reports, so it needs both.

NIW2-849 adds two things the first version lacked. With the toggle off, remote feature flags
must still load, because that is how a release flag reaches a Mac (and how the owner's two
devices get the beta features). And the first-run flow must say what is sent before anyone
is asked to rely on it.

## What it does

- `AppSettings.diagnosticsEnabled`, on by default, under **Settings → App → Privacy → Share
  usage and crash reports**. The setting keeps its old key so existing installs keep their
  choice. The description says what is shared (which features you use, and when something
  breaks), what never is (recordings, screen, files), and that with it off Kaipu still checks
  which features are on for this Mac. It never says "nothing is sent".
- **What is sent, with it on:** `recording_started`, `screenshot_captured`,
  `editor_speed_changed`, and `editor_opened` with `{ editor: "video" | "image" }` once per
  loaded editor session (the hook is `useEditorOpened`). Plus crash reports. Identity is the
  random per-install `deviceId`; there is no account, name or email.
- **What runs with it off:** only the feature-flags request, for that `deviceId`. No event and
  no crash report leaves the Mac, from either process.
- **Renderer** (`features/analytics/analytics-client.ts`): `posthog-js` is always initialised
  (when a key exists) with `opt_out_capturing_by_default` set from the toggle and the device
  id as the bootstrap `distinctID`. Opted out, the SDK drops every capture but still loads
  flags. Toggling later calls `opt_out_capturing` / `opt_in_capturing`; `identify` runs once,
  on the first opt-in. `isFlagEnabled` and `onFlagsChanged` depend on the SDK being
  initialised, not on the toggle. `analytics-real-sdk-off.test.ts` and
  `analytics-real-sdk-on.test.ts` drive the real SDK against a recording network to prove both
  halves.
- **Main process** (`services/analytics.service.ts`): off at launch, no `posthog-node` client
  is created (main has no flags). Toggling starts the client or flushes and closes it. The
  crash handlers are installed either way, so the toggle never changes whether an uncaught
  exception exits the app. Exceptions forwarded from secondary windows go through the main
  client, so they stop too.
- **Personal paths are removed before sending.** `scrubPersonalPaths` (`src/shared/analytics.ts`)
  replaces `/Users/<name>/…`, `/home/<name>/…`, `C:\Users\<name>\…` and `file://` forms, file
  name included, with `<user-path>`. It runs in `before_send` in both SDKs, over every string
  in the event, so a path in an exception message, a stack frame or a context value never
  travels.
- **Onboarding**: a **Privacy** step sits between Shortcuts and You're set, with the approved
  copy and the toggle on. It informs and never blocks. Whoever finished onboarding before the
  step existed, or left the tour before reaching it, sees the same content once as a notice
  over the app (`PrivacyNotice`); **Got it** or Esc dismisses it for good. The flag
  `kaipu.onboarding.privacySeen` is separate from the completion flag, which is what lets the
  two groups differ, and survives a replay of the tour from Settings.
- **Windows installer**: `nsis.license` shows `build/installer-privacy-notice.txt` (English
  and Spanish) as the first page: what is sent, that personal paths are removed, how to turn
  it off, the policy URL and how to uninstall. The file is UTF-8 with BOM because
  electron-builder adds one in place otherwise.

## Decisions kept

- **The toggle stays on by default and stays opt-out.** The step informs; it is not a consent
  gate.
- **Flags are not gated by the toggle.** A flag lookup carries only the random device id.
- **The privacy step is its own flag**, not a re-run of onboarding, so nobody who already
  finished the tour is sent through it again.

## Open

- Check the installer page in a packaged Windows build.
- macOS has no installer step (drag to Applications), so the notice there is the in-app
  toggle, the first-run step and the privacy policy. Confirm SignPath only signs the Windows
  build.
- The website privacy copy and the PostHog flag rules are separate work and are not changed
  here.
