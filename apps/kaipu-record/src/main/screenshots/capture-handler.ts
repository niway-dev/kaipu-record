import {
  isCaptureMode,
  type CaptureMode,
  type CaptureResult,
  type CaptureToastPayload,
} from "@shared/types/screenshot-capture";
import type { ScreenshotCopyMode, ScreenshotSaveMode } from "@shared/types";
import type { ScreenshotCapturedProperties } from "@shared/analytics";
import { screenshotTitle } from "@shared/screenshot-title";
import { decideAfterCapture } from "./after-capture-policy";
import { clearLastQuietCapture, keepLastQuietCapture } from "./last-quiet-capture";
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
  /**
   * After the overlay closes. `editorTakesOver` is true only when the renderer is about
   * to show the editor (it reveals the window itself); false for a cancel and for a quiet
   * capture, where the window goes back to its pre-capture visibility.
   */
  afterCapture(editorTakesOver: boolean): void;
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
  /** The current save/copy preferences, read per capture. */
  settings(): { save: ScreenshotSaveMode; copy: ScreenshotCopyMode };
  /** The vault write the `screenshot:save` handler uses (`manual: false`); resolves the new item's id. */
  saveToVault(png: Buffer, title: string): Promise<{ id: string }>;
  /** `clipboard.writeImage` of the PNG. */
  copyToClipboard(png: Buffer): void;
  /** Data URL of the PNG at most 160 px wide, for the toast. */
  thumbnail(png: Buffer): string;
  /**
   * Seam for the capture toast (ticket 06): called once after each quiet capture.
   * Default no-op, so quiet capture works without a toast window.
   */
  onQuietCapture?(payload: CaptureToastPayload): void;
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
    const report = (
      outcome: ScreenshotCapturedProperties["outcome"],
      after?: "editor" | "quiet",
      picked?: CaptureMode,
    ): void => {
      try {
        deps.track({
          // The mode the user ended in (the pill may have changed the requested one).
          mode: picked ?? mode,
          platform: deps.platform,
          displays: deps.displayCount(),
          outcome,
          ...(after ? { after } : {}),
        });
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
    // A new capture frees the previous quiet capture's bytes.
    clearLastQuietCapture();
    let result: ProviderResult = { kind: "cancelled" };
    let answer: CaptureResult = { kind: "cancelled" };
    let failed = false;
    try {
      // Inside the try: a throw while hiding windows must still release the guard.
      deps.windows.beforeCapture();
      result = await deps.provider.capture({ mode, overlay: deps.overlay });
      if (result.kind === "captured") answer = await finish(deps, result);
      else if (result.kind === "unsupported") {
        answer = { kind: "unsupported", mode: result.mode, platform: deps.platform };
      }
    } catch (error) {
      // The renderer has no catch around this call: answer cancelled instead of throwing.
      console.error("screenshot capture failed", error);
      failed = true;
      answer = { kind: "cancelled" };
    } finally {
      capturing = false;
      // Only the editor path reveals the window itself; cancel and quiet restore it here.
      deps.windows.afterCapture(answer.kind === "captured" && answer.after === "editor");
    }
    // A throw answers `cancelled` to the renderer but is a failure for the owner's numbers.
    report(
      failed ? "failed" : result.kind,
      answer.kind === "captured" ? answer.after : undefined,
      result.kind === "captured" ? result.mode : undefined,
    );
    return answer;
  };
}

type Captured = Extract<ProviderResult, { kind: "captured" }>;

/** Applies the after-capture policy to a captured shot and builds the renderer's answer. */
async function finish(deps: CaptureHandlerDeps, shot: Captured): Promise<CaptureResult> {
  const { png } = shot;
  const { width, height } = deps.measure(png);
  const toEditor = (): CaptureResult => ({
    kind: "captured",
    after: "editor",
    // Buffer → ArrayBuffer slice for structured-clone across IPC.
    png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer,
    width,
    height,
    mode: shot.mode,
    saved: null,
    copied: false,
  });

  let decision;
  try {
    const { save, copy } = deps.settings();
    decision = decideAfterCapture(shot.action, save, copy);
  } catch (error) {
    console.error("screenshot after-capture settings failed", error);
    return toEditor();
  }
  if (decision.open === "editor") return toEditor();

  let saved: { id: string } | null = null;
  let copied = false;
  if (decision.save) {
    try {
      saved = await deps.saveToVault(png, screenshotTitle());
    } catch (error) {
      console.error("screenshot quiet save failed", error);
    }
  }
  if (decision.copy) {
    try {
      deps.copyToClipboard(png);
      copied = true;
    } catch (error) {
      console.error("screenshot quiet copy failed", error);
    }
  }
  // Nothing landed anywhere: opening the editor is better than losing the shot.
  if (!saved && !copied) return toEditor();

  // Copy-only: Annotate has no vault item to open, so main keeps the bytes for it.
  if (!saved) keepLastQuietCapture({ png, width, height, mode: shot.mode });
  try {
    deps.onQuietCapture?.({
      thumbnail: deps.thumbnail(png),
      width,
      height,
      mode: shot.mode,
      saved,
      copied,
    });
  } catch (error) {
    // A broken toast must never turn a finished capture into an error.
    console.error("screenshot capture toast failed", error);
  }
  return {
    kind: "captured",
    after: "quiet",
    png: new ArrayBuffer(0),
    width,
    height,
    mode: shot.mode,
    saved,
    copied,
  };
}
