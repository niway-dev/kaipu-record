import type { LocalRecording, RecordingSettings } from "@shared/types";
import { sanitizeAudioSettings, type AudioSettings } from "@shared/audio-settings";
import {
  RECORDING_COUNTDOWN_SECONDS,
  type RecorderPhaseReport,
  type RecordingArea,
} from "@shared/types/ipc";
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
import { finalizeErrorKey } from "./finalize-error-message";
import { buildRecordingCapture, type RecordingCapture } from "@shared/recording-capture";
import { runtimeT } from "@renderer/lib/runtime-i18n";
import { beginRecordTiming, endRecordTiming, markRecordTiming } from "./record-timing";

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
  /** Record only this part of the source's display (ADR 0030). */
  area?: RecordingArea | null;
  microphoneDeviceId: string | null;
  systemAudio: boolean;
  /** Mic level, noise reduction, system-audio volume and ducking the take starts with. */
  audio: AudioSettings;
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

const COUNTDOWN_SECONDS = RECORDING_COUNTDOWN_SECONDS;
/**
 * How long the first tick waits for main to say the countdown is on screen (the shade window
 * loading on the chosen region). Past it the countdown runs anyway: a take never depends on it.
 */
const COUNTDOWN_VISIBLE_TIMEOUT_MS = 1500;
/**
 * How long a take may spend acquiring (session file, screen, mic, encoder) before the start
 * is called failed. Each step is a browser or IPC promise that can hang, and the main window
 * is already hidden: past this the start fails the usual way (toast, window restored).
 */
const START_TIMEOUT_MS = 10_000;
/** Minimum time the bar shows "Saving…" so it never just flashes on short clips. */
const MIN_SAVING_MS = 600;
const roundLevel = (level: number): number => Math.round(level * 100) / 100;
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
/** How the active take is captured; sent with finalize so the library can label it. */
let capture: RecordingCapture | null = null;
let clock: ElapsedState | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped by every start request, so a countdown cancelled while waiting to be visible stays cancelled. */
let countdownRequest = 0;
let stopping = false;
/**
 * The take being started (from `recordingStart` until it records). A cancel or a timeout
 * drops it without waiting for it — the start may never settle — and whatever it acquires
 * later is released by `discardStart`. `beginEngine` checks it after its await: a start that
 * is no longer this one was cancelled and must not become a take.
 */
interface PendingStart {
  id: string;
  created: Promise<unknown>;
  engine: Promise<EngineHandle> | null;
}
let pendingStart: PendingStart | null = null;
let sessionCounter = 0;
let lastResolveInput: (() => StartInput) | null = null;
/** Unsubscribes the live-settings forwarder of the active take. */
let stopLiveSettings: (() => void) | null = null;

const listeners = new Set<() => void>();
const completeListeners = new Set<(recording: LocalRecording) => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function update(patch: Partial<RecorderSnapshot>): void {
  const previous = snapshot;
  snapshot = { ...snapshot, ...patch };
  reportPhase(previous, snapshot);
  emit();
}

/**
 * Tell main where a pending start is (countdown tick, acquiring, abandoned), so it can draw
 * the countdown over the region the user chose while this window stays hidden. Only the
 * pending phases are reported; the take itself is announced by `recordingStart`.
 */
function reportPhase(previous: RecorderSnapshot, next: RecorderSnapshot): void {
  if (previous.status === next.status && previous.countdown === next.countdown) return;
  const pending = previous.status === "counting" || previous.status === "starting";
  const report: RecorderPhaseReport | null =
    next.status === "counting" && next.countdown !== null
      ? { phase: "counting", value: next.countdown }
      : next.status === "starting"
        ? { phase: "starting" }
        : next.status === "idle" && pending
          ? { phase: "idle" }
          : null;
  if (!report) return;
  try {
    window.electronAPI.reportRecorderPhase(report);
  } catch (error) {
    // The countdown on the region is a convenience; the take must not depend on it.
    console.error("recorder phase report failed", error);
  }
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
  beginRecordTiming("requestStartRecording");
  const request = ++countdownRequest;
  update({ status: "counting", countdown: COUNTDOWN_SECONDS });
  // "3" gets its whole second only once it is visible: a region countdown is drawn by a
  // window main opens on this first report, and the clock used to run while it loaded,
  // which read as "3.2...1".
  void countdownVisible().then(() => {
    // Cancelled (or cancelled and started again) while waiting.
    if (request !== countdownRequest || snapshot.status !== "counting") return;
    markRecordTiming("countdown visible, clock started");
    runCountdown(resolveInput);
  });
}

async function countdownVisible(): Promise<void> {
  const wait = window.electronAPI.waitForCountdownVisible?.();
  if (!wait) return;
  await Promise.race([wait.catch(() => undefined), delay(COUNTDOWN_VISIBLE_TIMEOUT_MS)]);
}

function runCountdown(resolveInput: () => StartInput): void {
  let remaining = COUNTDOWN_SECONDS;
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearCountdownTimer();
      // Resolved while still "counting": a throw (no source selected) then goes back to idle,
      // which main reads as an abandoned countdown — the shade comes down, Esc is released
      // and the hidden app returns. Thrown after "starting", it left all of that stranded.
      let input: StartInput;
      try {
        input = resolveInput();
      } catch (error) {
        reportError(runtimeT()("record.errorStart"), error, { context: { phase: "start" } });
        update({ status: "idle", countdown: null });
        return;
      }
      update({ status: "starting", countdown: null });
      void beginEngine(input);
    } else {
      update({ countdown: remaining });
    }
  }, 1000);
}

/**
 * Cancel a pending start, or stop an active one — a single entry point so
 * every caller (the on-page Stop button, the bar's Stop, the global stop
 * shortcut) gets correct behaviour no matter which phase the recorder is in.
 * During the countdown and during "starting" it is instant (the app comes back at once,
 * whatever the acquisition is still waiting on); once recording/paused, it finalizes.
 */
export function stopOrCancelRecording(): void {
  if (snapshot.status === "counting") {
    clearCountdownTimer();
    update({ status: "idle", countdown: null });
    return;
  }
  if (snapshot.status === "starting") {
    const start = pendingStart;
    pendingStart = null;
    if (start) discardStart(start);
    window.electronAPI.recordingStop(); // undo the early hide
    sessionId = null;
    update({ status: "idle", countdown: null });
    return;
  }
  void stopRecording();
}

async function beginEngine(input: StartInput): Promise<void> {
  const id = `session-${++sessionCounter}`;
  sessionId = id;
  markRecordTiming("beginEngine");
  // Hide the main window BEFORE the engine acquires streams, not after — so the
  // app's own window is never the first thing on screen when the recording
  // starts (previously ~0.5-1s of the app itself was captured every time).
  window.electronAPI.recordingStart({
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    area: input.area ?? null,
  });
  const start: PendingStart = {
    id,
    created: window.electronAPI.recordingCreate(id),
    engine: null,
  };
  pendingStart = start;
  try {
    const acquired = (async () => {
      await start.created;
      start.engine = startEngine({
        sourceId: input.sourceId,
        area: input.area ?? null,
        microphoneDeviceId: input.microphoneDeviceId,
        systemAudio: input.systemAudio,
        audio: input.audio,
        width: input.width,
        height: input.height,
        frameRate: input.frameRate,
        videoBitrate: input.videoBitrate,
        watermark: input.watermark,
        // A discarded start still flushes on stop: its chunks go nowhere.
        onChunk: (data, position) => {
          if (sessionId === id) window.electronAPI.recordingWrite(id, data, position);
        },
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
      });
      // Best-effort, and started CONCURRENTLY with the engine: main resolves the
      // captured display through desktopCapturer.getSources(), which costs
      // 100–500 ms, and the recording must never wait for it. The call never
      // throws — it resolves to a no-op session when main declines (window source,
      // unknown display), when IPC fails, or after its own 500 ms timeout.
      return Promise.all([
        beginCursorTrackSession(
          window.electronAPI,
          id,
          input.sourceId,
          input.area ? { area: input.area } : {},
        ),
        start.engine,
      ]);
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const [track, handle] = await Promise.race([
      acquired,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`recording start timed out after ${START_TIMEOUT_MS} ms`)),
          START_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    // Cancelled while acquiring: the cancel restored the app and released this start.
    if (pendingStart !== start) return;
    pendingStart = null;
    cursorTrack = track;

    engine = handle;
    capture = buildRecordingCapture({
      sourceId: input.sourceId,
      area: input.area ?? null,
      output: handle.outputSize,
    });
    stopLiveSettings = forwardLiveSettings(handle, input);
    const activeTrack = cursorTrack;
    void handle.firstMediaTimestamp.then(({ rendererMs, quality }) =>
      activeTrack?.anchor(rendererMs, quality),
    );
    clock = startElapsed(Date.now());
    update({ status: "recording", countdown: null });
    endRecordTiming("status recording");

    tickTimer = setInterval(() => {
      if (!clock || !engine) return;
      const paused = clock.pausedAt !== null;
      window.electronAPI.recordingReportTick({
        elapsedSeconds: Math.floor(elapsedMs(clock, Date.now()) / 1000),
        levels: paused ? [0, 0, 0, 0, 0] : engine.readLevels(),
        // Rounded so a steady room produces identical ticks and main does not re-broadcast.
        micLevels: paused ? [0, 0, 0, 0, 0] : engine.readMicLevels().map(roundLevel),
        status: paused ? "paused" : "recording",
        systemAudioAvailable: engine.hasSystemAudio,
      });
    }, 100);
  } catch (error) {
    // Cancelled first: the cancel already restored the app, and this is its fallout.
    if (pendingStart !== start) return;
    pendingStart = null;
    // A timed-out start can still resolve later: release what it acquires.
    discardStart(start);
    reportError(runtimeT()("record.errorStart"), error, {
      context: { sourceId: input.sourceId, phase: "start" },
      retry: () => {
        if (lastResolveInput) requestStartRecording(lastResolveInput);
      },
    });
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

/**
 * Release a start that will not become a take, without waiting on it: the engine is stopped
 * whenever it resolves, and the session's temp file is aborted once main has created it.
 */
function discardStart(start: PendingStart): void {
  void start.engine?.then((handle) => handle.stop()).catch(() => undefined);
  void start.created
    .catch(() => undefined)
    .then(() => window.electronAPI.recordingAbort(start.id))
    .catch(() => undefined);
}

/**
 * While a take runs, forward the user's live toggles (any window, any shortcut —
 * they all just write `RecordingSettings`) to the engine. When the engine answers
 * "unavailable", write the setting back to `false` so every surface shows the
 * truth. Calls are serialized so a quick off/on never lands out of order.
 *
 * Also forwards the persisted `AppSettings.audio` (level, noise, volume, ducking) the same
 * way: only the fields that differ from what the engine last got, on the same queue. The
 * mic device is never switched mid-take.
 * Returns the unsubscribe.
 */
function forwardLiveSettings(handle: EngineHandle, input: StartInput): () => void {
  let micOn = input.microphoneDeviceId !== null;
  let sysOn = input.systemAudio;
  let queue: Promise<void> = Promise.resolve();
  let active = true;
  const writeBack = (patch: Partial<RecordingSettings>): void => {
    if (active) window.electronAPI.updateRecordingSettings(patch);
  };

  // System audio requested but no loopback (e.g. a macOS dev build): the toggle
  // must not claim "on" for a take that cannot carry it.
  if (sysOn && !handle.hasSystemAudio) {
    sysOn = false;
    writeBack({ isSystemAudioEnabled: false });
  }

  let audio = input.audio;
  const unsubscribeAudio = window.electronAPI.onSettingsChanged((appSettings) => {
    const next = sanitizeAudioSettings(appSettings.audio);
    const previous = audio;
    audio = next;
    if (next.micLevel !== previous.micLevel) {
      queue = queue.then(() => handle.setMicLevel(next.micLevel));
    }
    if (next.noiseSuppression !== previous.noiseSuppression) {
      queue = queue.then(
        async () => void (await handle.setNoiseSuppression(next.noiseSuppression)),
      );
    }
    if (next.systemAudioVolume !== previous.systemAudioVolume) {
      queue = queue.then(() => void handle.setSystemAudioVolume(next.systemAudioVolume));
    }
    if (next.duckSystemAudioWhileTalking !== previous.duckSystemAudioWhileTalking) {
      queue = queue.then(() => void handle.setDucking(next.duckSystemAudioWhileTalking));
    }
  });
  const unsubscribe = window.electronAPI.onRecordingSettingsChanged((settings) => {
    if (settings.isMicrophoneEnabled !== micOn) {
      micOn = settings.isMicrophoneEnabled;
      const on = micOn;
      const deviceId = settings.selectedMicrophone?.deviceId ?? null;
      queue = queue.then(async () => {
        const result = await handle.setMicrophoneEnabled(on, deviceId);
        if (result === "unavailable" && on) {
          micOn = false;
          writeBack({ isMicrophoneEnabled: false });
        }
      });
    }
    if (settings.isSystemAudioEnabled !== sysOn) {
      sysOn = settings.isSystemAudioEnabled;
      if (handle.setSystemAudioEnabled(sysOn) === "unavailable" && sysOn) {
        sysOn = false;
        writeBack({ isSystemAudioEnabled: false });
      }
    }
  });
  return () => {
    active = false;
    unsubscribe();
    unsubscribeAudio();
  };
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
  const activeCapture = capture;
  // Guard re-entry: the user clicking Stop and an engine-failure can both fire.
  if (stopping || !activeEngine || !activeSessionId) return;
  stopping = true;
  beginRecordTiming("stop requested", true);
  stopLiveSettings?.();
  stopLiveSettings = null;
  update({ status: "finalizing", countdown: null });
  const durationMs = clock ? elapsedMs(clock, Date.now()) : 0;
  const durationSeconds = Math.floor(durationMs / 1000);
  // Flip the bar to "Saving…" before the timer stops, so the finalize wait reads
  // as progress instead of a frozen widget.
  window.electronAPI.recordingReportTick({
    elapsedSeconds: durationSeconds,
    levels: [0, 0, 0, 0, 0],
    micLevels: [0, 0, 0, 0, 0],
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
        markRecordTiming("engine.stop resolved");
        // Settled by stop (or given up on): a poster frame still pending saves without one.
        const thumbnail = await Promise.race([activeEngine.thumbnail, Promise.resolve(null)]);
        const finalized = await window.electronAPI.recordingFinalize(activeSessionId, {
          title,
          durationSeconds,
          durationMs,
          thumbnail,
          capture: activeCapture,
        });
        markRecordTiming("finalize resolved");
        return finalized;
      })(),
      delay(MIN_SAVING_MS),
    ]);
  } catch (error) {
    reportError(runtimeT()(finalizeErrorKey(error)), error, {
      context: { sessionId: activeSessionId, phase: "finalize" },
      retry: () => {
        if (lastResolveInput) requestStartRecording(lastResolveInput);
      },
    });
    await window.electronAPI.recordingAbort(activeSessionId); // no-op for a stranded take
  }

  // Notify BEFORE the main window reappears, so completion listeners (the app
  // shell's navigation) land before the window shows the previous page first.
  if (recording) for (const listener of completeListeners) listener(recording);
  window.electronAPI.recordingStop();
  engine = null;
  cursorTrack = null;
  sessionId = null;
  capture = null;
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
