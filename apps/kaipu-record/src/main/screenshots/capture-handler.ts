import type { Rectangle } from "electron";
import {
  isCaptureIntent,
  isCaptureMode,
  type CaptureIntent,
  type CaptureMode,
  type CaptureResult,
  type CapturePolicy,
  type CaptureToastPayload,
  type CaptureWorkspace,
  type RecordingRatio,
  type SavedScreenshotRef,
} from "@shared/types/screenshot-capture";
import type { ScreenshotAfterCapture, ScreenshotCopyMode } from "@shared/types";
import type { ScreenshotCapturedProperties } from "@shared/analytics";
import { screenshotTitle } from "@shared/screenshot-title";
import { decideAfterCapture } from "./after-capture-policy";
import { clearLastQuietCapture, keepLastQuietCapture } from "./last-quiet-capture";
import type { OverlayPort } from "./overlay-port";
import type {
  ProviderResult,
  RecordingCaptureTarget,
  ScreenshotCaptureProvider,
} from "./screenshot-capture";

/**
 * How a capture ended, for `afterCapture`: `editor` (the renderer is about to show the
 * editor and reveals the window itself), `quiet` (main saved and optionally copied; the main
 * window stays hidden), `cancelled` (nothing was captured: Esc,
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
  /**
   * The effective copy preference of the active workspace. Read ONCE, when the capture
   * starts, and bound to it as its policy (ADR 0034, decision 4): a switch or a Settings
   * edit while the overlay is open changes nothing about this capture.
   */
  settings(): { copy: ScreenshotCopyMode; afterCapture?: ScreenshotAfterCapture };
  /**
   * The vault write the `screenshot:save` handler uses (`manual: false`); resolves the new
   * item. `workspaceId` is the workspace the capture started in: the write is refused if
   * that is no longer the active one, or if its folder is not connected.
   */
  saveToVault(png: Buffer, title: string, workspaceId?: string): Promise<SavedScreenshotRef>;
  /**
   * The active workspace, read once when the capture starts (ADR 0032, decision 9): the
   * retained bytes, the toast and its Save carry it. Optional for handlers built without it.
   */
  workspace?(): CaptureWorkspace;
  /** `clipboard.writeImage` of the PNG. */
  copyToClipboard(png: Buffer): void;
  /** Data URL of the PNG, at most `PREVIEW_THUMBNAIL_MAX_SIDE` px on its longest side, for the card. */
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
  /**
   * True while a take is active or pending AND screenshots during a take are allowed
   * (`capture-while-recording`, NIW2-688). Read ONCE as the capture starts. Such a capture
   * never opens the editor: the shot lands in the vault, the copy setting still applies, and
   * the toast shows a "Screenshot taken" notice. Absent: never (today's behaviour).
   */
  duringTake?(): boolean;
  recordingTarget?(): Promise<RecordingCaptureTarget | null>;
}

/** A recording target chosen on the overlay: display-relative DIP, `null` for all of it. */
export interface RecordTarget {
  displayId: number;
  rect: Rectangle | null;
  start: boolean;
  /** The ratio the Frame box was locked to; stored with the take's capture metadata. */
  ratio?: RecordingRatio;
  /** The overlay already ran the countdown: main and the recorder must not count again. */
  countdownDone?: true;
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

function assertInsert(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new Error(`screenshot capture: unknown insert ${JSON.stringify(value)}`);
  }
  return value;
}

/** Builds the `screenshot:capture` handler: validates, guards re-entrancy, answers a typed result. */
export function createCaptureHandler(
  deps: CaptureHandlerDeps,
): (
  request: { mode?: unknown; intent?: unknown; insert?: unknown } | undefined,
) => Promise<CaptureResult> {
  // Re-entrancy guard: a second capture while one is in flight would stack overlays
  // and clobber the saved window-visibility state (leaving the app stuck hidden on
  // cancel). Answer `cancelled` without touching the first one.
  let capturing = false;

  return async (request) => {
    const mode = assertCaptureMode(request?.mode);
    const intent = assertCaptureIntent(request?.intent);
    const insert = assertInsert(request?.insert);
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
    // An insert belongs to the open editor, which is not reachable during a take.
    if (insert && readDuringTake(deps)) return { kind: "cancelled" };
    capturing = true;
    // A new capture frees the previous quiet capture's bytes. An insert does not replace it
    // (it never reaches the toast), so the toast's Save retry keeps its shot.
    if (!insert) clearLastQuietCapture();
    const workspace = readWorkspace(deps);
    // An insert never reads the capture policy: nothing is saved, copied or toasted.
    const policy = insert ? null : readPolicy(deps, workspace);
    const duringTake = readDuringTake(deps);
    let result: ProviderResult = { kind: "cancelled" };
    let answer: CaptureResult = { kind: "cancelled" };
    let failed = false;
    // Set once a Record answer was handed to main without a throw: the take is starting.
    let recordStarted = false;
    try {
      // Inside the try: a throw while hiding windows must still release the guard.
      deps.windows.beforeCapture();
      const recordingTarget = duringTake ? await deps.recordingTarget?.() : undefined;
      // Never open a selector over a take, even if its source can no longer be resolved.
      result =
        duringTake && !recordingTarget
          ? { kind: "cancelled" }
          : await deps.provider.capture({
              mode,
              overlay: deps.overlay,
              intent,
              ...(recordingTarget ? { recordingTarget } : {}),
            });
      if (result.kind === "captured") {
        // Before the policy: a quiet save that fails and falls back to the editor still
        // remembers the mode the user captured in.
        // The instant shortcut is an exception: it never becomes the current mode.
        if (!duringTake && intent !== "instant") remember(deps, result.mode);
        answer = await finish(deps, result, workspace, policy, duringTake, insert);
      } else if (result.kind === "record" && insert) {
        // The overlay's Record switch, from the editor's Add image: an insert only adds a
        // picture, so it never starts a recording. Answered as a cancel.
      } else if (result.kind === "record") {
        // A recording target, not a screenshot: no save, no mode memory, no analytics here.
        const { displayId, rect, start, ratio, countdownDone } = result;
        try {
          deps.onRecordTarget?.({
            displayId,
            rect,
            start,
            ...(ratio ? { ratio } : {}),
            ...(countdownDone ? { countdownDone } : {}),
          });
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
      // Only the editor path reveals the window itself; cancel restores it here; quiet keeps it hidden.
      deps.windows.afterCapture(
        answer.kind === "captured" ? answer.after : recordStarted ? "recording" : "cancelled",
      );
    }
    // Choosing a recording target is not a screenshot outcome, and an insert adds an image
    // to the open editor: counting it would inflate the "captured, opened the editor" numbers.
    // A failed insert is still reported, so a broken insert path shows up as failures.
    if (result.kind === "record" || (insert && !failed)) return answer;
    // A throw answers `cancelled` to the renderer but is a failure for the owner's numbers.
    report(
      failed ? "failed" : result.kind,
      answer.kind === "captured" ? answer.after : undefined,
      result.kind === "captured" ? result.mode : undefined,
    );
    return answer;
  };
}

function readDuringTake(deps: CaptureHandlerDeps): boolean {
  try {
    return deps.duringTake?.() ?? false;
  } catch (error) {
    console.error("screenshot capture: take state unknown", error);
    return false;
  }
}

function readWorkspace(deps: CaptureHandlerDeps): CaptureWorkspace | null {
  try {
    return deps.workspace?.() ?? null;
  } catch (error) {
    console.error("screenshot capture: active workspace unknown", error);
    return null;
  }
}

/**
 * The settings this capture starts with. A throw leaves no policy and the capture falls back to
 * the editor (`finish`), where nothing is copied behind the user's back.
 */
function readPolicy(
  deps: CaptureHandlerDeps,
  workspace: CaptureWorkspace | null,
): CapturePolicy | null {
  try {
    const settings = deps.settings();
    return {
      workspaceId: workspace?.id ?? null,
      screenshotCopy: settings.copy,
      ...(settings.afterCapture ? { screenshotAfterCapture: settings.afterCapture } : {}),
    };
  } catch (error) {
    console.error("screenshot capture: settings unknown", error);
    return null;
  }
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
async function finish(
  deps: CaptureHandlerDeps,
  shot: Captured,
  workspace: CaptureWorkspace | null,
  policy: CapturePolicy | null,
  duringTake: boolean,
  insert: boolean,
): Promise<CaptureResult> {
  const { png } = shot;
  const { width, height } = deps.measure(png);
  if (insert) {
    // For the open editor's canvas: the bytes go back as they are, whatever the policy says.
    return {
      kind: "captured",
      after: "editor",
      png: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer,
      width,
      height,
      mode: shot.mode,
      saved: null,
      copied: false,
      policy: null,
    };
  }
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
    policy,
  });
  // The in-memory editor runs its own auto actions, so main copies nothing for it.
  // During a take the editor never opens (its window is hidden and would reappear inside the
  // recording): a shot that could not be saved or copied stays in the toast, whose Save retries.
  const toEditor = (): CaptureResult => answer("editor", null, false);
  const fallback = (): CaptureResult => (duringTake ? holdForToast() : toEditor());
  const holdForToast = (): CaptureResult => {
    if (!policy) return answer("quiet", null, false);
    keepLastQuietCapture({
      png,
      width,
      height,
      mode: shot.mode,
      workspaceId: workspace?.id ?? null,
      policy,
    });
    notifyQuiet(null, false);
    return answer("quiet", null, false);
  };
  const notifyQuiet = (saved: SavedScreenshotRef | null, copied: boolean): void => {
    try {
      const confirmation = shot.action === "copy" && copied && saved !== null;
      deps.onQuietCapture?.({
        // During a take the notice wins: it tells the user the shot was taken.
        ...(duringTake
          ? { presentation: "taken" as const }
          : confirmation
            ? { presentation: "copied" as const }
            : {}),
        thumbnail: deps.thumbnail(png),
        width,
        height,
        mode: shot.mode,
        saved,
        copied,
        workspace,
        policy,
      });
    } catch (error) {
      // A broken toast must never turn a finished capture into an error.
      console.error("screenshot capture toast failed", error);
    }
  };

  // No policy (the settings could not be read when the capture started): the editor opens, and
  // copies nothing on its own.
  if (!policy) return fallback();
  const decided = decideAfterCapture(
    shot.action,
    policy.screenshotCopy,
    policy.screenshotAfterCapture,
  );
  // The copy setting still applies during a take; only the editor is ruled out.
  const decision = duringTake ? { ...decided, open: "quiet" as const } : decided;

  let saved: SavedScreenshotRef | null = null;
  try {
    saved = await deps.saveToVault(png, screenshotTitle(), workspace?.id);
  } catch (error) {
    console.error("screenshot save failed", error);
  }
  // The editor opens the bytes in memory instead, where Save can retry.
  if (decision.open === "editor" && !saved) return fallback();

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
  if (!saved && !copied) return fallback();

  // Copy-only (the save failed): Annotate has no vault item to open, so main keeps the bytes.
  if (!saved) {
    keepLastQuietCapture({
      png,
      width,
      height,
      mode: shot.mode,
      workspaceId: workspace?.id ?? null,
      policy,
    });
  }
  notifyQuiet(saved, copied);
  return answer("quiet", saved, copied);
}
