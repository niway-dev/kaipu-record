import posthog, { type CaptureResult, type PostHogConfig } from "posthog-js";
// Bundled, not lazy-loaded: the SDK would fetch it from PostHog's script origin, which the
// renderer CSP (script-src 'self') blocks, and exception autocapture would stay silently off.
import "posthog-js/dist/exception-autocapture";
import {
  DEFAULT_PRODUCT,
  DEFAULT_SURFACE,
  scrubEventProperties,
  scrubPersonalPathsDeep,
  type FlagName,
} from "@shared/analytics";
import type { FlagOverrides } from "@shared/flag-overrides";

/**
 * Two switches, on purpose (NIW2-849). `initialized`: the SDK is running, so remote feature
 * flags load and read. `capturing`: the user's "Share usage and crash reports" preference is
 * on, so events and crash reports leave the app. Turning the preference off stops the second
 * and never the first: a Mac keeps asking which features are on for it.
 */
let initialized = false;
/** The preference as last applied; `null` before the first call. */
let capturing: boolean | null = null;
/** Subscribers to flag (re)loads; PostHog calls them all through one subscription. */
const flagListeners = new Set<() => void>();
/** `identify` has run: it creates the person profile, so it only runs with the preference on. */
let identified = false;

/** What the config depends on besides the host. */
export interface PosthogConfigInput {
  /** The Mac's random id: PostHog's distinct id, so flags that target a device id match. */
  deviceId: string;
  /** The preference at launch: off starts PostHog opted out of capturing. */
  capturing: boolean;
}

/**
 * Runs on every event just before it is sent. Strips personal file paths (`/Users/<name>/…`)
 * from everything inside (an exception message, a stack frame, a context value) and drops the
 * item-id properties, which can spell a recording's name.
 */
export function scrubEventBeforeSend(event: CaptureResult | null): CaptureResult | null {
  if (!event?.properties) return event;
  return { ...event, properties: scrubEventProperties(event.properties) };
}

/** Where PostHog keeps the first page's URL and referrer, and the two older shapes it replaced. */
const INITIAL_INFO_KEYS = [
  "$initial_person_info",
  "$initial_campaign_params",
  "$initial_referrer_info",
];

/**
 * PostHog stores the URL of the first page it saw and sends it with every flags request as
 * `$initial_current_url`, `$initial_pathname` and so on. `before_send` never sees that request,
 * and in a packaged build the URL can sit under the user's home folder (a per-user install on
 * Windows), so with the preference off it would send the install path. Called right after
 * `init`, before the first flags request, so what is stored and what is sent are scrubbed.
 */
export function scrubStoredInitialInfo(): void {
  const persistence = posthog.persistence;
  if (!persistence) return;
  for (const key of INITIAL_INFO_KEYS) {
    const stored = persistence.props?.[key];
    if (stored) persistence.register({ [key]: scrubPersonalPathsDeep(stored) });
  }
}

/** Privacy-locked config. Pure + exported so the privacy guarantees are tested. */
export function buildPosthogConfig(
  host: string | undefined,
  input: PosthogConfigInput,
): Partial<PostHogConfig> {
  return {
    // `||`, not `??`: an unset CI variable is inlined as "", which is not a host.
    api_host: host || "https://us.i.posthog.com",
    autocapture: false, // never capture DOM/clicks — could leak recorded UI
    capture_pageview: false,
    disable_session_recording: true, // never record the screen-recorder's own screen
    capture_exceptions: true, // PostHog Error Tracking autocapture
    person_profiles: "always",
    // The router puts ids in the hash (`#/library/<id>`), and a local id is a file-name stem.
    // Without this the hash travels in `$current_url` and in the stored first-page URL.
    disable_capture_url_hashes: true,
    // Off at launch: PostHog starts opted out, so no event or crash report can leave. Flags do
    // not depend on this switch; they load either way.
    opt_out_capturing_by_default: !input.capturing,
    // The device id is the distinct id from the first request, so flags that target it match
    // without an `identify` (which would create a person profile and send an event).
    bootstrap: input.deviceId ? { distinctID: input.deviceId } : {},
    before_send: scrubEventBeforeSend,
  };
}

/**
 * Apply Settings → App → Share usage and crash reports. No-op if the key is absent (the app
 * runs offline-normal). The first call initializes PostHog whatever the value, so remote
 * flags work with the preference off; the value only decides whether capturing is opted in.
 * The first call with the preference on also registers identity super-properties (so
 * events/errors can be filtered by product/surface across future backends) and identifies
 * the Mac by its random device id.
 */
export function setAnalyticsEnabled(enabled: boolean, deviceId: string): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || enabled === capturing) return;
  capturing = enabled;
  if (!initialized) {
    initialized = true;
    posthog.init(
      key,
      buildPosthogConfig(import.meta.env.VITE_POSTHOG_HOST, { deviceId, capturing: enabled }),
    );
    scrubStoredInitialInfo();
    posthog.onFeatureFlags(() => flagListeners.forEach((listener) => listener()));
    posthog.register({
      product: import.meta.env.VITE_POSTHOG_PRODUCT ?? DEFAULT_PRODUCT,
      surface: import.meta.env.VITE_POSTHOG_SURFACE ?? DEFAULT_SURFACE,
    });
  }
  // The consent persists in PostHog's storage, so each launch states it explicitly.
  if (!enabled) {
    if (!posthog.has_opted_out_capturing()) posthog.opt_out_capturing();
    return;
  }
  if (deviceId && !identified) {
    identified = true;
    posthog.identify(deviceId);
  }
  if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
}

/**
 * Send an exception with the full technical payload (developer channel). No-op if disabled.
 * In development it is also printed: the CSP blocks PostHog there, so otherwise a caught
 * error (an export failure, say) leaves no trace anywhere.
 */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (import.meta.env.DEV) console.error("[captureException]", context ?? {}, error);
  if (!capturing) return;
  posthog.captureException(error, context);
}

/**
 * Send a named product event with structured properties (developer channel) —
 * for diagnostics that aren't errors, e.g. a rare state we couldn't reproduce
 * locally and want to catch in the wild. No-op if analytics is disabled.
 */
export function captureEvent(name: string, props?: Record<string, unknown>): void {
  if (!capturing) return;
  posthog.capture(name, props);
}

/** Overrides pushed by main after a Developer page toggle; `null` until the first push. */
let liveOverrides: FlagOverrides | null = null;
let overridesSubscribed = false;

/**
 * The active overrides: the latest set main pushed, else the launch set the preload read
 * (`KAIPU_FLAG_OVERRIDES`). Unpackaged builds only; always empty in a packaged one.
 */
export function currentFlagOverrides(): FlagOverrides {
  return liveOverrides ?? window.electronAPI?.flagOverrides ?? {};
}

function subscribeToOverrideChanges(): void {
  if (overridesSubscribed) return;
  const subscribe = window.electronAPI?.onFlagOverridesChanged;
  if (!subscribe) return;
  overridesSubscribed = true;
  subscribe((overrides) => {
    liveOverrides = overrides;
    for (const listener of flagListeners) listener();
  });
}

/** Where a flag's effective value comes from, in the order `isFlagEnabled` reads them. */
export type FlagSource = "override" | "posthog" | "default";

/** The effective value of a flag and which layer decided it. */
export function flagState(
  name: FlagName,
  fallback: boolean,
): { value: boolean; source: FlagSource } {
  const override = currentFlagOverrides()[name];
  if (override !== undefined) return { value: override, source: "override" };
  if (initialized) {
    const value = posthog.isFeatureEnabled(name);
    if (value !== undefined) return { value, source: "posthog" };
  }
  return { value: fallback, source: "default" };
}

/**
 * Read a flag, returning `fallback` while unresolved or when the build has no PostHog key.
 * It does not depend on the usage-and-crash-reports preference. An override (unpackaged
 * builds only: `KAIPU_FLAG_OVERRIDES` at launch, or the Developer page while running) wins
 * over PostHog, initialized or not.
 */
export function isFlagEnabled(name: FlagName, fallback: boolean): boolean {
  return flagState(name, fallback).value;
}

/**
 * Subscribe to flag changes: PostHog (re)loads, and, in a dev build, overrides changed from
 * the Developer page. Returns an unsubscribe fn. A component usually mounts before the
 * settings arrive and PostHog starts, so listeners are kept here and wired to PostHog once it
 * does, instead of being dropped.
 */
export function onFlagsChanged(callback: () => void): () => void {
  flagListeners.add(callback);
  subscribeToOverrideChanges();
  return () => {
    flagListeners.delete(callback);
  };
}
