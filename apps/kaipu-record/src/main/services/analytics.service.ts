import { PostHog, type EventMessage } from "posthog-node";
import {
  DEFAULT_PRODUCT,
  DEFAULT_SURFACE,
  scrubPersonalPathsDeep,
  type SerializedError,
} from "@shared/analytics";

let client: PostHog | null = null;
let distinctId = "anonymous";
let handlersInstalled = false;

/** Pure: identity super-properties merged into every exception. Tested. */
export function buildExceptionProperties(
  origin: string,
  context?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    product: DEFAULT_PRODUCT,
    surface: DEFAULT_SURFACE,
    origin,
    ...context,
  };
}

/** Pure: the PostHog host, defaulted. `||`, not `??`: an unset CI variable is inlined as "". Tested. */
export function resolvePosthogHost(host: string | undefined): string {
  return host || "https://us.i.posthog.com";
}

/**
 * Runs on every event just before it is sent: strips personal file paths (`/Users/<name>/…`)
 * from the exception message, the stack frames and the context. Tested.
 */
export function scrubMainEvent(event: EventMessage | null): EventMessage | null {
  if (!event?.properties) return event;
  return { ...event, properties: scrubPersonalPathsDeep(event.properties) };
}

function startClient(key: string): void {
  client = new PostHog(key, {
    host: resolvePosthogHost(import.meta.env.MAIN_VITE_POSTHOG_HOST),
    flushAt: 1,
    flushInterval: 0,
    before_send: scrubMainEvent,
  });
}

/**
 * Initialize posthog-node once. No-op without a key. Installs process-level crash
 * handlers so Node-side failures (file writes, IPC, window management) are captured.
 * With `enabled` false (Settings → App → Send diagnostics off) no client is created,
 * so every capture below is a no-op and nothing leaves the device.
 */
export function initMainAnalytics(deviceId: string, enabled: boolean): void {
  const key = import.meta.env.MAIN_VITE_POSTHOG_KEY;
  if (!key) {
    // Releases up to 0.18.0 shipped without a key and nothing said so.
    console.warn("[analytics] no PostHog key in this build: flags use their code defaults");
    return;
  }
  if (handlersInstalled) return;
  handlersInstalled = true;
  distinctId = deviceId || "anonymous";
  if (enabled) startClient(key);

  // Deliberate: attaching these handlers suppresses Node's default exit-on-crash,
  // so the main process stays alive after an otherwise-fatal error. For this test
  // phase we prioritize capturing every failure (to learn) and not crashing the
  // app over a hard exit. The event is sent immediately (flushAt: 1). Revisit once
  // out of the test phase — a corrupted main process may warrant a controlled exit.
  // Installed whether or not diagnostics are on, so the toggle never changes crash behavior.
  process.on("uncaughtException", (error) => {
    captureMainException(error, "uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    captureMainException(reason, "unhandledRejection");
  });
}

/**
 * Follow the diagnostics setting at runtime: start the client when it is turned on,
 * flush and close it when it is turned off. No-op without a key or before init.
 */
export function setMainAnalyticsEnabled(enabled: boolean): void {
  const key = import.meta.env.MAIN_VITE_POSTHOG_KEY;
  if (!key || !handlersInstalled) return;
  if (enabled && !client) startClient(key);
  if (!enabled && client) void shutdownMainAnalytics();
}

/** Capture a live Error/throw from the main process. */
export function captureMainException(
  error: unknown,
  origin: string,
  context?: Record<string, unknown>,
): void {
  if (!client) return;
  client.captureException(error, distinctId, buildExceptionProperties(origin, context));
}

/** Send a product event. No-op without a key, like the exception paths. */
export function captureMainEvent(event: string, properties: object): void {
  if (!client) return;
  client.capture({
    distinctId,
    event,
    properties: { product: DEFAULT_PRODUCT, surface: DEFAULT_SURFACE, ...properties },
  });
}

/** Capture an exception forwarded from a secondary window (already serialized). */
export function captureSerializedException(
  payload: SerializedError,
  origin: string,
  context?: Record<string, unknown>,
): void {
  if (!client) return;
  const error = Object.assign(new Error(payload.message), {
    name: payload.name,
    stack: payload.stack ?? undefined,
  });
  client.captureException(error, distinctId, buildExceptionProperties(origin, context));
}

/**
 * Flush + close on quit so no events are lost.
 * Uses `_shutdown()` (Promise<void>) rather than the IPostHog.shutdown() (void)
 * so the caller can await true async completion.
 */
export async function shutdownMainAnalytics(): Promise<void> {
  if (!client) return;
  // Cleared before awaiting so captures racing the flush become no-ops.
  const closing = client;
  client = null;
  await closing._shutdown();
}
