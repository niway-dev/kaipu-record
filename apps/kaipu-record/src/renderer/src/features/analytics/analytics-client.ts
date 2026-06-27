import posthog, { type PostHogConfig } from "posthog-js";
import { DEFAULT_PRODUCT, DEFAULT_SURFACE, type FlagName } from "@shared/analytics";

let started = false;

/** Privacy-locked config. Pure + exported so the privacy guarantees are tested. */
export function buildPosthogConfig(host: string | undefined): Partial<PostHogConfig> {
  return {
    api_host: host ?? "https://us.i.posthog.com",
    autocapture: false, // never capture DOM/clicks — could leak recorded UI
    capture_pageview: false,
    disable_session_recording: true, // never record the screen-recorder's own screen
    capture_exceptions: true, // PostHog Error Tracking autocapture
    person_profiles: "always",
  };
}

/**
 * Initialize PostHog once, in the main window. No-op if the key is absent (the app
 * runs offline-normal) or if already started. Registers identity super-properties
 * so events/errors can be filtered by product/surface across future backends.
 */
export function initAnalytics(deviceId: string): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || started) return;
  started = true;
  posthog.init(key, buildPosthogConfig(import.meta.env.VITE_POSTHOG_HOST));
  posthog.register({
    product: import.meta.env.VITE_POSTHOG_PRODUCT ?? DEFAULT_PRODUCT,
    surface: import.meta.env.VITE_POSTHOG_SURFACE ?? DEFAULT_SURFACE,
  });
  if (deviceId) posthog.identify(deviceId);
}

/** Send an exception with the full technical payload (developer channel). No-op if disabled. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!started) return;
  posthog.captureException(error, context);
}

/** Read a flag, returning `fallback` while unresolved/disabled. */
export function isFlagEnabled(name: FlagName, fallback: boolean): boolean {
  if (!started) return fallback;
  const value = posthog.isFeatureEnabled(name);
  return value === undefined ? fallback : value;
}

/** Subscribe to flag (re)loads. Returns an unsubscribe fn (no-op if disabled). */
export function onFlagsChanged(callback: () => void): () => void {
  if (!started) return () => {};
  return posthog.onFeatureFlags(() => callback());
}
