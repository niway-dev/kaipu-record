---
title: Web analytics (cookieless PostHog)
description: The events the website sends, their properties, why the analytics are cookieless, and why there is no consent banner.
---

# Web analytics (cookieless PostHog)

> **Status: 🟢 Ready to validate.** NIW2-477. Implemented in the branch; needs the two
> `VITE_POSTHOG_*` variables set and the PostHog project setting below, then a check in
> PostHog Activity.

## What it does

The website (`apps/web-hono`) counts page views and download clicks with PostHog in
**cookieless mode**. It lives in `src/lib/analytics.ts`; with no `VITE_POSTHOG_KEY` nothing
starts and every call is a no-op, so dev and CI are unaffected.

All events carry the super properties `product: "kaipu-recorder"` and `surface: "web"` (the
same scheme as the desktop app, so one PostHog project splits cleanly by surface).

| Event               | When                                        | Properties                                                                                                                    |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `$pageview`         | First load and every client-side navigation | `$current_url`                                                                                                                |
| `download_clicked`  | Click on any desktop installer link         | `platform`: `mac-arm64` / `mac-x64` / `windows`; `placement`: `hero` / `sticky` / `closing` / `dashboard` / `nav` / `roadmap` |
| `sign_up_completed` | `authClient.signUp.email` succeeded         | `desktop`: boolean (sign-up started from the desktop app). No email, name or id.                                              |

## Why cookieless, and why there is no banner

posthog-js runs with `cookieless_mode: "always"`: it sets no cookie and uses no local or
session storage. PostHog derives an anonymous visitor hash on its servers (IP + user agent +
a rotating salt), so a visitor cannot be followed across days. Because nothing is stored on
the device for analytics, the consent-banner requirement for storing or reading device data
does not apply, and the site shows none. The cookie policy ("Diagnostic technologies") says
so.

The trade-off: no per-user journeys, no identified users, no session replay. If any of that
is ever wanted, it needs a stored identifier, so the banner and the policy must be revisited
first. `autocapture`, session recording and automatic pageviews are off.

## First-party proxy

The browser sends events to `/ingest/*` on the web Worker (`src/routes/ingest/$.ts`,
`src/lib/ingest-proxy.ts`), which forwards to `us.i.posthog.com` (and `/ingest/static/*` to
`us-assets.i.posthog.com`), dropping cookies both ways. This keeps requests first-party for
ad blockers and keeps the PostHog host out of any future CSP.

## Setup the owner must do

- Enable **cookieless server hash mode** in PostHog (Project settings → Web analytics →
  cookieless). Without it PostHog ignores cookieless events.
- Set `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` (Infisical `/public`, tag `web-hono`, and
  the GitHub `production` environment variables used by `release-web.yml`).
