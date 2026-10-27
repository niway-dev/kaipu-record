import type { Rectangle } from "electron";
import {
  isCaptureIntent,
  isCaptureMode,
  type CaptureIntent,
  type CaptureMode,
  type CaptureResult,
  type CaptureToastPayload,
  type RecordingRatio,
  type SavedScreenshotRef,
} from "@shared/types/screenshot-capture";
import type { ScreenshotCopyMode } from "@shared/types";
import type { ScreenshotCapturedProperties } from "@shared/analytics";
import { screenshotTitle } from "@shared/screenshot-title";
import { decideAfterCapture } from "./after-capture-policy";
import { clearLastQuietCapture, keepLastQuietCapture } from "./last-quiet-capture";
import type { OverlayPort } from "./overlay-port";
import type { ProviderResult, ScreenshotCaptureProvider } from "./screenshot-capture";

/**
 * How a capture ended, for `afterCapture`: `editor` (the renderer is about to show the
 * editor and reveals the window itself), `quiet` (main saved and copied; the window
 * comes back where it was, without taking focus), `cancelled` (nothing was captured: Esc,
 * an unsupported answer or a throw; the window comes back where it was), `recording` (the
 * overlay started a recording: the countdown runs on the chosen region and the window stays
 * out of sight, as it does for the whole take).
 */
export type CaptureEnding = "editor" | "quiet" | "cancelled" | "recording";

/**
 * Window orchestration around a capture, owned by main (which holds the windows).
 * The overlay floats above everything, so the app must get OUT of the way during a
 * capture instead of coming to the front. Production: `createCaptureWindowHooks`.
 */
export interface CaptureWindowHooks {
  /** Hide the app so it isn't in the shot. Remembers prior visibility. */
  beforeCapture(): void;
  /** After the overlay closes, with how the capture ended. */
  afterCapture(ending: CaptureEnding): void;
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
  /**
   * Make `mode` the current screenshot mode (`AppSettings.screenshotMode`). Called only for
   * a captured result, with the mode the overlay answered in: switching mode on the overlay
   * and then cancelling (Esc) leaves the previous mode untouched (spec failure 10).
   */
  rememberMode(mode: CaptureMode): void;
  /** The current copy preference, read per capture. */
  settings(): { copy: ScreenshotCopyMode };
  /** The vault write the `screenshot:save` handler uses (`manual: false`); resolves the new item. */
  saveToVault(png: Buffer, title: string): Promise<SavedScreenshotRef>;
  /** `clipboard.writeImage` of the PNG. */
  copyToClipboard(png: Buffer): void;
  /** Data URL of the PNG at most 160 px wide, for the toast. */
  thumbnail(png: Buffer): string;
  /**
   * Seam for the capture toast (ticket 06): called once after each quiet capture.
   * Default no-op, so quiet capture works without a toast window.
   */
  onQuietCapture?(payload: CaptureToastPayload): void;
  /**
   * The user chose what to record on the overlay (ADR 0030): Record (`start`) or Use
   * selection. Main sets the recording target and, for Record, starts the take. Optional,
   * so a handler built without recording support simply ignores the answer.
   */
  onRecordTarget?(target: RecordTarget): void;
}

/** A recording target chosen on the overlay: display-relative DIP, `null` for all of it. */
export interface RecordTarget {
  displayId: number;
  rect: Rectangle | null;
  start: boolean;
  /** The ratio the Frame box was locked to; stored with the take's capture metadata. */
  ratio?: RecordingRatio;
}

function assertCaptureMode(value: unknown): CaptureMode {
  if (!isCaptureMode(value)) {
    throw new Error(`screenshot capture: unknown mode ${JSON.stringify(value)}`);
  }
  return value;
}

function assertCaptureIntent(value: unknown): CaptureIntent {
  if (value === undefined) return "capture";
  if (!isCaptureIntent(value)) {
    throw new Error(`screenshot capture: unknown intent ${JSON.stringify(value)}`);
  }
  return value;
}

/** Builds the `screenshot:capture` handler: validates, guards re-entrancy, answers a typed result. */
export function createCaptureHandler(
  deps: CaptureHandlerDeps,
): (request: { mode?: unknown; intent?: unknown } | undefined) => Promise<CaptureResult> {
  // Re-entrancy guard: a second capture while one is in flight would stack overlays
  // and clobber the saved window-visibility state (leaving the app stuck hidden on
  // cancel). Answer `cancelled` without touching the first one.
  let capturing = false;

  return async (request) => {
    const mode = assertCaptureMode(request?.mode);
    const intent = assertCaptureIntent(request?.intent);
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
    // Set once a Record answer was handed to main without a throw: the take is starting.
    let recordStarted = false;
    try {
      // Inside the try: a throw while hiding windows must still release the guard.
      deps.windows.beforeCapture();
      result = await deps.provider.capture({ mode, overlay: deps.overlay, intent });
      if (result.kind === "captured") {
        // Before the policy: a quiet save that fails and falls back to the editor still
        // remembers the mode the user captured in.
        remember(deps, result.mode);
        answer = await finish(deps, result);
      } else if (result.kind === "record") {
        // A recording target, not a screenshot: no save, no mode memory, no analytics here.
        const { displayId, rect, start, ratio } = result;
        try {
          deps.onRecordTarget?.(
            ratio ? { displayId, rect, start, ratio } : { displayId, rect, start },
          );
          recordStarted = start && deps.onRecordTarget !== undefined;
        } catch (error) {
          console.error("recording target could not be applied", error);
        }
      } else if (result.kind === "unsupported") {
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
      deps.windows.afterCapture(
        answer.kind === "captured" ? answer.after : recordStarted ? "recording" : "cancelled",
      );
    }
    // Choosing a recording target is not a screenshot outcome.
    if (result.kind === "record") return answer;
    // A throw answers `cancelled` to the renderer but is a failure for the owner's numbers.
    report(
      failed ? "failed" : result.kind,
      answer.kind === "captured" ? answer.after : undefined,
      result.kind === "captured" ? result.mode : undefined,
    );
    return answer;
  };
}

/** Remembering the mode is a convenience: a throw never blocks the shot from reaching the user. */
function remember(deps: CaptureHandlerDeps, mode: CaptureMode): void {
  try {
    deps.rememberMode(mode);
  } catch (error) {
    console.error("screenshot mode could not be remembered", error);
  }
}

type Captured = Extract<ProviderResult, { kind: "captured" }>;

/**
 * Saves a captured shot, applies the after-capture policy and builds the renderer's
 * answer. Every capture lands in the vault; only a failed save hands the bytes over.
 */
async function finish(deps: CaptureHandlerDeps, shot: Captured): Promise<CaptureResult> {
  const { png } = shot;
  const { width, height } = deps.measure(png);
  const answer = (
    after: "editor" | "quiet",
    saved: SavedScreenshotRef | null,
    copied: boolean,
  ): CaptureResult => ({
    kind: "captured",
    after,
    // The bytes cross IPC only for the in-memory editor (a failed save); a vault item
    // is opened by its id. Buffer → ArrayBuffer slice for structured-clone.
    png:
      after === "editor" && !saved
        ? (png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer)
        : new ArrayBuffer(0),
    width,
    height,
    mode: shot.mode,
    saved,
    copied,
  });
  // The in-memory editor runs its own auto actions, so main copies nothing for it.
  const toEditor = (): CaptureResult => answer("editor", null, false);

  let decision;
  try {
    decision = decideAfterCapture(shot.action, deps.settings().copy);
  } catch (error) {
    console.error("screenshot after-capture settings failed", error);
    return toEditor();
  }

  let saved: SavedScreenshotRef | null = null;
  try {
    saved = await deps.saveToVault(png, screenshotTitle());
  } catch (error) {
    console.error("screenshot save failed", error);
  }
  // The editor opens the bytes in memory instead, where Save can retry.
  if (decision.open === "editor" && !saved) return toEditor();

  let copied = false;
  if (decision.copy) {
    try {
      deps.copyToClipboard(png);
      copied = true;
    } catch (error) {
      console.error("screenshot copy failed", error);
    }
  }
  if (decision.open === "editor") return answer("editor", saved, copied);

  // Nothing landed anywhere: opening the editor is better than losing the shot.
  if (!saved && !copied) return toEditor();

  // Copy-only (the save failed): Annotate has no vault item to open, so main keeps the bytes.
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
  return answer("quiet", saved, copied);
}
