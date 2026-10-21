import posthog, { type PostHogConfig } from "posthog-js";
import { DEFAULT_PRODUCT, DEFAULT_SURFACE, type FlagName } from "@shared/analytics";

/** `posthog.init` has run; it cannot be undone, only opted out of. */
let initialized = false;
/** Capturing is on: initialized and the user has diagnostics enabled. */
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
 * Start or stop PostHog in the main window, following Settings → App → Send diagnostics.
 * No-op if the key is absent (the app runs offline-normal). The first start initializes
 * and registers identity super-properties so events/errors can be filtered by
 * product/surface across future backends. While off, PostHog is never initialized (a
 * launch with diagnostics off makes no request at all) or is opted out of capturing.
 */
export function setAnalyticsEnabled(enabled: boolean, deviceId: string): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || enabled === started) return;
  started = enabled;
  if (!enabled) {
    posthog.opt_out_capturing();
    return;
  }
  if (!initialized) {
    initialized = true;
    posthog.init(key, buildPosthogConfig(import.meta.env.VITE_POSTHOG_HOST));
    posthog.register({
      product: import.meta.env.VITE_POSTHOG_PRODUCT ?? DEFAULT_PRODUCT,
      surface: import.meta.env.VITE_POSTHOG_SURFACE ?? DEFAULT_SURFACE,
    });
    if (deviceId) posthog.identify(deviceId);
  }
  // The opt-out persists in PostHog's storage, so a later launch has to lift it.
  if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
}

/**
 * Send an exception with the full technical payload (developer channel). No-op if disabled.
 * In development it is also printed: the CSP blocks PostHog there, so otherwise a caught
 * error (an export failure, say) leaves no trace anywhere.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (import.meta.env.DEV) console.error("[captureException]", context ?? {}, error);
  if (!started) return;
  posthog.captureException(error, context);
}

/**
 * Send a named product event with structured properties (developer channel) —
 * for diagnostics that aren't errors, e.g. a rare state we couldn't reproduce
 * locally and want to catch in the wild. No-op if analytics is disabled.
 */
export function captureEvent(name: string, props?: Record<string, unknown>): void {
  if (!started) return;
  posthog.capture(name, props);
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
