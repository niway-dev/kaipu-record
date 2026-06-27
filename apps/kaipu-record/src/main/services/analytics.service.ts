import { PostHog } from "posthog-node";
import { DEFAULT_PRODUCT, DEFAULT_SURFACE, type SerializedError } from "@shared/analytics";

let client: PostHog | null = null;
let distinctId = "anonymous";

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

/**
 * Initialize posthog-node once. No-op without a key. Installs process-level crash
 * handlers so Node-side failures (file writes, IPC, window management) are captured.
 */
export function initMainAnalytics(deviceId: string): void {
  const key = import.meta.env.MAIN_VITE_POSTHOG_KEY;
  if (!key || client) return;
  distinctId = deviceId || "anonymous";
  client = new PostHog(key, {
    host: import.meta.env.MAIN_VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });

  process.on("uncaughtException", (error) => {
    captureMainException(error, "uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    captureMainException(reason, "unhandledRejection");
  });
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
  await client._shutdown();
  client = null;
}
