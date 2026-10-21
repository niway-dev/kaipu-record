import posthog from "posthog-js";

/**
 * Cookieless product analytics for the website (NIW2-477).
 *
 * `cookieless_mode: "always"` means posthog-js sets no cookie and uses no local or session storage;
 * PostHog derives an anonymous, daily-rotating visitor hash on its servers. That is why the site
 * shows no consent banner: nothing is stored on the visitor's device. If you add anything here that
 * stores an identifier on the device (identify(), persistence, session replay), the cookie policy
 * and the no-banner decision must be revisited first.
 *
 * Without `VITE_POSTHOG_KEY` nothing starts and every call below is a no-op, so dev and CI work.
 */

/** Every event the website sends. Add new names here, with their properties below. */
export const ANALYTICS_EVENTS = {
  pageview: "$pageview",
  downloadClicked: "download_clicked",
  signUpCompleted: "sign_up_completed",
} as const;

export type DownloadPlatform = "mac-arm64" | "mac-x64" | "windows";
export type DownloadPlacement = "hero" | "sticky" | "closing" | "dashboard" | "nav" | "roadmap";

/** The properties each custom event carries. No PII: no email, name or user id. */
export interface AnalyticsEventProperties {
  [ANALYTICS_EVENTS.downloadClicked]: {
    platform: DownloadPlatform;
    placement: DownloadPlacement;
  };
  [ANALYTICS_EVENTS.signUpCompleted]: { desktop: boolean };
}

/** Same scheme as apps/kaipu-record/.env.example: one PostHog project, split by these two. */
const SUPER_PROPERTIES = { product: "kaipu-recorder", surface: "web" } as const;

const DEFAULT_UI_HOST = "https://us.posthog.com";

let started = false;
let lastPageUrl: string | null = null;

function apiKey(): string {
  return (import.meta.env.VITE_POSTHOG_KEY ?? "").trim();
}

/** Browser only, once, and only when a key is configured. Safe to call from any effect. */
export function initAnalytics(): void {
  if (started || typeof window === "undefined" || apiKey() === "") return;
  started = true;
  posthog.init(apiKey(), {
    // First-party proxy (routes/ingest/$.ts): ad blockers and the CSP see our own origin.
    api_host: "/ingest",
    ui_host: analyticsUiHost(),
    cookieless_mode: "always",
    // Belt and braces: cookieless mode already keeps persistence in memory.
    persistence: "memory",
    // Pageviews are sent by hand on router navigation (`trackPageview`).
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
  });
  posthog.register(SUPER_PROPERTIES);
}

/** The PostHog app host, derived from the configured ingestion host (`us.i.posthog.com` -> `us.posthog.com`). */
export function analyticsUiHost(): string {
  const host = (import.meta.env.VITE_POSTHOG_HOST ?? "").trim();
  if (host === "") return DEFAULT_UI_HOST;
  try {
    const url = new URL(host);
    return `${url.protocol}//${url.hostname.replace(".i.posthog.com", ".posthog.com")}`;
  } catch {
    return DEFAULT_UI_HOST;
  }
}

/** Sends `$pageview` for the current URL. Repeats for the same URL (hash changes, re-resolves) are dropped. */
export function trackPageview(): void {
  if (!started || typeof window === "undefined") return;
  const { origin, pathname, search } = window.location;
  const url = `${origin}${pathname}${search}`;
  if (url === lastPageUrl) return;
  lastPageUrl = url;
  posthog.capture(ANALYTICS_EVENTS.pageview, { $current_url: url });
}

/** Sends a custom event. Fire and forget: it never throws and never waits on the network. */
export function track<E extends keyof AnalyticsEventProperties>(
  event: E,
  properties: AnalyticsEventProperties[E],
): void {
  if (!started) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Analytics must never break the page.
  }
}

/** Test seam: forget that analytics started. */
export function resetAnalyticsForTests(): void {
  started = false;
  lastPageUrl = null;
}
