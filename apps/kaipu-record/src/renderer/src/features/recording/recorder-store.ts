import type { LocalRecording } from "@shared/types";
import {
  beginCursorTrackSession,
  type CursorTrackSession,
} from "@renderer/features/recording/cursor-track-session";
import {
  elapsedMs,
  pauseElapsed,
  resumeElapsed,
  startElapsed,
  type ElapsedState,
} from "@renderer/features/recording/elapsed";
import { startEngine, type EngineHandle } from "@renderer/features/recording/recorder-engine";
import type { WatermarkConfig } from "@renderer/features/watermark/watermark";
import { reportError } from "@renderer/features/analytics";
import { runtimeT } from "@renderer/lib/runtime-i18n";

export type RecorderStatus =
  | "idle"
  | "counting"
  | "starting"
  | "recording"
  | "paused"
  | "finalizing";

export interface StartInput {
  sourceId: string;
  sourceName: string;
  microphoneDeviceId: string | null;
  systemAudio: boolean;
  /** Encoder targets resolved from the user's quality preset (optional → engine defaults). */
  width?: number;
  height?: number;
  frameRate?: number;
  videoBitrate?: number;
  /** Watermark to burn in, or `null` to encode the raw screen (decided by `useWatermark`). */
  watermark?: WatermarkConfig | null;
}

export interface RecorderSnapshot {
  status: RecorderStatus;
  /** Current countdown tick (3→1) while a start is pending; null otherwise. */
  countdown: number | null;
}

const COUNTDOWN_SECONDS = 3;
/** Minimum time the bar shows "Saving…" so it never just flashes on short clips. */
const MIN_SAVING_MS = 600;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Module-singleton recorder — deliberately NOT a React hook's local state. The
 * engine, the disk-writer session, and the 3-2-1 countdown all live here so they
 * survive route navigation, page remounts (e.g. the bringToFront rescue
 * shortcut reopening a hidden window), and detours into the screenshot editor.
 * Binding this lifecycle to a page's mount was the root cause of the "recording
 * orphaned mid-navigation" bug class. Mirrors `ui/toast-store.ts`: plain
 * functions mutate module state and notify subscribers, consumed via
 * `useSyncExternalStore`.
 */

let snapshot: RecorderSnapshot = { status: "idle", countdown: null };
let engine: EngineHandle | null = null;
let cursorTrack: CursorTrackSession | null = null;
let sessionId: string | null = null;
let clock: ElapsedState | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let stopping = false;
/** Set when cancel arrives during the brief "starting" gap (streams acquiring,
 *  no engine handle yet) — consumed as soon as `startEngine` resolves so a
 *  cancel is never silently swallowed. */
let cancelRequested = false;
let sessionCounter = 0;
let lastResolveInput: (() => StartInput) | null = null;

const listeners = new Set<() => void>();
const completeListeners = new Set<(recording: LocalRecording) => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function update(patch: Partial<RecorderSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

export function subscribeRecorder(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecorderSnapshot(): RecorderSnapshot {
  return snapshot;
}

/** Fires once a recording finishes saving, with the finalized record — the app
 *  shell uses this to navigate, regardless of which page is currently mounted. */
export function subscribeRecordingComplete(
  listener: (recording: LocalRecording) => void,
): () => void {
  completeListeners.add(listener);
  return () => completeListeners.delete(listener);
}

function stopTicks(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

function clearCountdownTimer(): void {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

/**
 * Begin the 3-2-1 countdown, then start the engine using the input resolved
 * (live) the instant the countdown elapses — mirrors the previous behaviour of
 * reading quality/watermark refs at start time, not at call time. No-ops
 * unless idle, so callers don't need their own re-entry guard.
 */
export function requestStartRecording(resolveInput: () => StartInput): void {
  if (snapshot.status !== "idle") return;
  lastResolveInput = resolveInput;
  let remaining = COUNTDOWN_SECONDS;
  update({ status: "counting", countdown: remaining });
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearCountdownTimer();
      update({ status: "starting", countdown: null });
      void beginEngine(resolveInput());
    } else {
      update({ countdown: remaining });
    }
  }, 1000);
}

/**
 * Cancel a pending start, or stop an active one — a single entry point so
 * every caller (the on-page Stop button, the bar's Stop, the global stop
 * shortcut) gets correct behaviour no matter which phase the recorder is in.
 * During the countdown this is instant; during "starting" it's consumed right
 * after the engine handle resolves; once recording/paused, it finalizes.
 */
export function stopOrCancelRecording(): void {
  if (snapshot.status === "counting") {
    clearCountdownTimer();
    update({ status: "idle", countdown: null });
    return;
  }
  if (snapshot.status === "starting") {
    cancelRequested = true;
    return;
  }
  void stopRecording();
}

async function beginEngine(input: StartInput): Promise<void> {
  const id = `session-${++sessionCounter}`;
  sessionId = id;
  // Hide the main window BEFORE the engine acquires streams, not after — so the
  // app's own window is never the first thing on screen when the recording
  // starts (previously ~0.5-1s of the app itself was captured every time).
  window.electronAPI.recordingStart({ sourceId: input.sourceId, sourceName: input.sourceName });
  try {
    await window.electronAPI.recordingCreate(id);
    // Best-effort, and started CONCURRENTLY with the engine: main resolves the
    // captured display through desktopCapturer.getSources(), which costs
    // 100–500 ms, and the recording must never wait for it. The call never
    // throws — it resolves to a no-op session when main declines (window source,
    // unknown display), when IPC fails, or after its own 500 ms timeout.
    const [track, handle] = await Promise.all([
      beginCursorTrackSession(window.electronAPI, id, input.sourceId),
      startEngine({
        sourceId: input.sourceId,
        microphoneDeviceId: input.microphoneDeviceId,
        systemAudio: input.systemAudio,
        width: input.width,
        height: input.height,
        frameRate: input.frameRate,
        videoBitrate: input.videoBitrate,
        watermark: input.watermark,
        onChunk: (data, position) => window.electronAPI.recordingWrite(id, data, position),
        // A failure mid-recording (encoder error or the screen capture ending)
        // runs the same robust stop — finalize-or-abort + always restore the
        // window/Dock/bar — so the app never gets stuck.
        onError: (error) => {
          reportError(runtimeT()("record.errorStopped"), error, {
            context: { sourceId: input.sourceId, phase: "mid-recording" },
            retry: () => {
              if (lastResolveInput) requestStartRecording(lastResolveInput);
            },
          });
          void stopRecording();
        },
      }),
    ]);
    cursorTrack = track;

    if (cancelRequested) {
      cancelRequested = false;
      await handle.stop();
      await window.electronAPI.recordingAbort(id);
      window.electronAPI.recordingStop(); // undo the early hide
      cursorTrack = null;
      sessionId = null;
      update({ status: "idle", countdown: null });
      return;
    }

    engine = handle;
    const activeTrack = cursorTrack;
    void handle.firstMediaTimestamp.then(({ rendererMs, quality }) =>
      activeTrack?.anchor(rendererMs, quality),
    );
    clock = startElapsed(Date.now());
    update({ status: "recording", countdown: null });

    tickTimer = setInterval(() => {
      if (!clock || !engine) return;
      const paused = clock.pausedAt !== null;
      window.electronAPI.recordingReportTick({
        elapsedSeconds: Math.floor(elapsedMs(clock, Date.now()) / 1000),
        levels: paused ? [0, 0, 0, 0, 0] : engine.readLevels(),
        status: paused ? "paused" : "recording",
      });
    }, 100);
  } catch (error) {
    cancelRequested = false;
    reportError(runtimeT()("record.errorStart"), error, {
      context: { sourceId: input.sourceId, phase: "start" },
      retry: () => {
        if (lastResolveInput) requestStartRecording(lastResolveInput);
      },
    });
    if (sessionId) await window.electronAPI.recordingAbort(sessionId);
    // The window was hidden optimistically above — a start failure must never
    // leave it hidden with nothing recording.
    window.electronAPI.recordingStop();
    engine = null;
    cursorTrack = null;
    sessionId = null;
    // Back to idle (not a separate "error" state) so the Start button is
    // immediately usable again; the toast above carries the retry action.
    update({ status: "idle", countdown: null });
  }
}

export function pauseRecording(): void {
  if (!engine || !clock) return;
  const pausedAt = performance.now();
  engine.pause();
  cursorTrack?.pause(pausedAt);
  clock = pauseElapsed(clock, Date.now());
  update({ status: "paused" });
}

export function resumeRecording(): void {
  if (!engine || !clock) return;
  const resumedAt = performance.now();
  engine.resume();
  cursorTrack?.resume(resumedAt);
  clock = resumeElapsed(clock, Date.now());
  update({ status: "recording" });
}

async function stopRecording(): Promise<void> {
  const activeEngine = engine;
  const activeSessionId = sessionId;
  // Guard re-entry: the user clicking Stop and an engine-failure can both fire.
  if (stopping || !activeEngine || !activeSessionId) return;
  stopping = true;
  update({ status: "finalizing", countdown: null });
  const durationSeconds = clock ? Math.floor(elapsedMs(clock, Date.now()) / 1000) : 0;
  // Flip the bar to "Saving…" before the timer stops, so the finalize wait reads
  // as progress instead of a frozen widget.
  window.electronAPI.recordingReportTick({
    elapsedSeconds: durationSeconds,
    levels: [0, 0, 0, 0, 0],
    status: "saving",
  });
  stopTicks();

  let recording: LocalRecording | null = null;
  try {
    const title = `Recording — ${new Date().toLocaleString()}`;
    // Run the real finalize and a minimum dwell together so "Saving…" is visible
    // even when the clip is tiny and the write is instant.
    [recording] = await Promise.all([
      (async (): Promise<LocalRecording> => {
        await activeEngine.stop();
        return window.electronAPI.recordingFinalize(activeSessionId, {
          title,
          durationSeconds,
          thumbnail: activeEngine.thumbnail,
        });
      })(),
      delay(MIN_SAVING_MS),
    ]);
  } catch (error) {
    reportError(runtimeT()("record.errorSave"), error, {
      context: { sessionId: activeSessionId, phase: "finalize" },
      retry: () => {
        if (lastResolveInput) requestStartRecording(lastResolveInput);
      },
    });
    await window.electronAPI.recordingAbort(activeSessionId);
  }

  // Notify BEFORE the main window reappears, so completion listeners (the app
  // shell's navigation) land before the window shows the previous page first.
  if (recording) for (const listener of completeListeners) listener(recording);
  window.electronAPI.recordingStop();
  engine = null;
  cursorTrack = null;
  sessionId = null;
  clock = null;
  stopping = false;
  update({ status: "idle", countdown: null });
}

// The bar's buttons and the global stop shortcut arrive as relayed commands.
// Registered ONCE here at module scope — not inside a React effect tied to a
// page's mount — so it is never dropped by navigation, unmounting, or a page
// remount, and correctly cancels a pending countdown instead of only ever
// acting on a live engine.
window.electronAPI.onRecordingCommand((command) => {
  if (command === "pause") pauseRecording();
  else if (command === "resume") resumeRecording();
  else if (command === "stop") stopOrCancelRecording();
});
