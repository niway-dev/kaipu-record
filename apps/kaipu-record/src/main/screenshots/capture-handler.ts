import {
  isCaptureMode,
  type CaptureMode,
  type CaptureResult,
} from "@shared/types/screenshot-capture";
import type { ScreenshotCapturedProperties } from "@shared/analytics";
import type { OverlayPort } from "./overlay-port";
import type { ProviderResult, ScreenshotCaptureProvider } from "./screenshot-capture";

/**
 * Window orchestration around a capture, owned by main (which holds the windows).
 * The native `screencapture` overlay floats above everything, so the app must get
 * OUT of the way during a capture instead of coming to the front.
 */
export interface CaptureWindowHooks {
  /** Hide the app so it isn't in the shot. Remembers prior visibility. */
  beforeCapture(): void;
  /** After the overlay closes: restore prior visibility if the user cancelled. */
  afterCapture(captured: boolean): void;
  /** Bring the app to the front (the renderer calls this once it shows the editor). */
  reveal(): void;
}

interface CaptureHandlerDeps {
  platform: NodeJS.Platform;
  provider: ScreenshotCaptureProvider;
  overlay: OverlayPort;
  windows: CaptureWindowHooks;
  /** PNG pixel size; injected so the handler needs no Electron import. */
  measure(png: Buffer): { width: number; height: number };
  /** Number of connected displays, for the analytics event. */
  displayCount(): number;
  /** Receives one `screenshot_captured` payload per answered request (no pixels, no geometry). */
  track(event: ScreenshotCapturedProperties): void;
}

function assertCaptureMode(value: unknown): CaptureMode {
  if (!isCaptureMode(value)) {
    throw new Error(`screenshot capture: unknown mode ${JSON.stringify(value)}`);
  }
  return value;
}

/** Builds the `screenshot:capture` handler: validates, guards re-entrancy, answers a typed result. */
export function createCaptureHandler(
  deps: CaptureHandlerDeps,
): (request: { mode?: unknown } | undefined) => Promise<CaptureResult> {
  // Re-entrancy guard: a second capture while one is in flight would stack overlays
  // and clobber the saved window-visibility state (leaving the app stuck hidden on
  // cancel). Answer `cancelled` without touching the first one.
  let capturing = false;

  return async (request) => {
    const mode = assertCaptureMode(request?.mode);
    const report = (outcome: ScreenshotCapturedProperties["outcome"]): void => {
      try {
        deps.track({ mode, platform: deps.platform, displays: deps.displayCount(), outcome });
      } catch (error) {
        // Analytics must never change what the user sees.
        console.error("screenshot analytics failed", error);
      }
    };
    // Answer before touching any window: an unsupported mode must not hide the app.
    if (!deps.provider.supports(mode)) {
      report("unsupported");
      return { kind: "unsupported", mode, platform: deps.platform };
    }
    if (capturing) return { kind: "cancelled" };
    capturing = true;
    deps.windows.beforeCapture();
    let result: ProviderResult = { kind: "cancelled" };
    try {
      result = await deps.provider.capture({ mode, overlay: deps.overlay });
    } catch (error) {
      // The renderer has no catch around this call: answer cancelled instead of throwing.
      console.error("screenshot capture failed", error);
    } finally {
      capturing = false;
      deps.windows.afterCapture(result.kind === "captured");
    }
    report(result.kind);
    switch (result.kind) {
      case "captured": {
        const { png } = result;
        const { width, height } = deps.measure(png);
        // Buffer → ArrayBuffer slice for structured-clone across IPC.
        return {
          kind: "captured",
          png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer,
          width,
          height,
          mode: result.mode,
        };
      }
      case "cancelled":
        return { kind: "cancelled" };
      case "unsupported":
        return { kind: "unsupported", mode: result.mode, platform: deps.platform };
    }
  };
}
