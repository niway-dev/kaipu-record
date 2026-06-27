import { serializeError } from "@shared/analytics";

/**
 * For secondary windows that don't run posthog-js: catch uncaught errors and
 * unhandled rejections and forward them (serialized) to the main-process sink,
 * so nothing is lost. `origin` identifies which window reported.
 */
export function installCrashForwarder(origin: string): void {
  window.addEventListener("error", (event) => {
    window.electronAPI.reportException(serializeError(event.error ?? event.message), origin, undefined);
  });
  window.addEventListener("unhandledrejection", (event) => {
    window.electronAPI.reportException(serializeError(event.reason), origin, undefined);
  });
}
