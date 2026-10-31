import type { LocalRecording, RecordingSettings } from "@shared/types";
import { sanitizeAudioSettings, type AudioSettings } from "@shared/audio-settings";
import {
  DEFAULT_RECORDING_COUNTDOWN_SECONDS,
  sanitizeCountdownSeconds,
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
import {
  prepareEngine,
  type EngineHandle,
  type LiveAudioControls,
  type LiveWebcamControls,
  type PreparedEngine,
} from "@renderer/features/recording/recorder-engine";
import { WebcamGapLog } from "./webcam-gaps";
import type { WatermarkConfig } from "@renderer/features/watermark/watermark";
import { reportError } from "@renderer/features/analytics";
import { showToast } from "@renderer/ui/toast-store";
import { finalizeErrorKey } from "./finalize-error-message";
import { buildRecordingCapture, type RecordingCapture } from "@shared/recording-capture";
import { runtimeT } from "@renderer/lib/runtime-i18n";
import { beginRecordTiming, endRecordTiming, markRecordTiming } from "./record-timing";
import {
  WEBCAM_FPS,
  webcamStartOffset,
  type WebcamGap,
  type WebcamRecordedLayout,
  type WebcamTrackMeta,
} from "@shared/webcam-track";

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
  /**
   * Record the webcam into its own file (ADR 0032): the camera, the lines to ask for and the
   * bubble as it looks now (stored on the sidecar). Absent or null with the camera off.
   */
  webcam?: { deviceId: string | null; lines: number; bubble: WebcamRecordedLayout } | null;
}

export interface RecorderSnapshot {
  status: RecorderStatus;
  /** Current countdown tick (3→1, or 5→1) while a start is pending; null otherwise. */
  countdown: number | null;
}

/**
 * The countdown length from Settings (0, 3 or 5), read when a start is requested. Kept here
 * because a start is synchronous: it is primed from the settings file and follows the
 * broadcast, so a change applies to the very next take with no restart.
 */
let countdownSeconds: number = DEFAULT_RECORDING_COUNTDOWN_SECONDS;
/**
 * How long the first tick waits for main to say the countdown is on screen (the shade window
 * loading on the chosen region). Past it the countdown runs anyway: a take never depends on it.
 */
const COUNTDOWN_VISIBLE_TIMEOUT_MS = 1500;
/**
 * How long a take may still spend acquiring (session file, screen, mic, encoder) once its
 * countdown is over before the start is called failed. Each step is a browser or IPC promise
 * that can hang, and the main window is already hidden: past this the start fails the usual
 * way (toast, window restored).
 */
const START_TIMEOUT_MS = 10_000;
/**
 * How long a take acquired during the countdown waits, after main hid an app window that was
 * on screen (the Record page's countdown), before it encodes. Its capture is already running,
 * and the frames in flight when the window is ordered out still show it: about one frame at
 * 30 fps plus one display refresh. Nothing is waited when the window was already hidden.
 */
export const WINDOW_HIDE_SETTLE_MS = 50;
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
/** The bubble as the active take started with it, for its webcam file's sidecar entry. */
let webcamBubble: WebcamRecordedLayout | null = null;
/**
 * The active take asked for the webcam and its camera did not open: the face is in the screen
 * recording instead, which the user is told once the take is saved (the app is hidden until
 * then, so a toast during the take would expire unseen).
 */
let webcamUnavailable = false;
let clock: ElapsedState | null = null;
/** Video-time clock: zero = the MP4's first media sample, renderer `performance.now()`, pauses removed. */
let videoClock: ElapsedState | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped by every start request, so a countdown cancelled while waiting to be visible stays cancelled. */
let countdownRequest = 0;
let stopping = false;
/**
 * The take being acquired: from the start of the countdown (or from `recordingStart` with the
 * countdown off) until it records. A cancel or a timeout drops it without waiting for it — the
 * acquisition may never settle — and whatever it acquires later is released by `discardStart`.
 * `beginTake` checks it after each await: a start that is no longer this one was cancelled and
 * must not become a take.
 */
interface PendingStart {
  id: string;
  /** What it was acquired with: a take whose input changed during the countdown re-acquires. */
  input: StartInput;
  created: Promise<unknown>;
  /** The webcam's writer session, with the camera on: true once main created it. */
  webcamCreated: Promise<boolean>;
  engine: Promise<PreparedEngine> | null;
  /** Session file, devices and cursor track, all acquired; nothing is encoded yet. */
  acquired: Promise<[CursorTrackSession, PreparedEngine]>;
  /** Audio settings changed while the engine was still being acquired. */
  audio: AudioSettingsTracker;
  /**
   * The user's live settings, forwarded to the prepared engine from the moment it is acquired
   * (during the countdown too), then to the take.
   */
  live: LiveSettingsForwarder | null;
  /** The engine failed before the take was set up; the start fails with it once acquired. */
  failure?: unknown;
  /**
   * The take asked for the webcam and got none: its camera did not open, or main could not
   * create its session (not the old-Windows legacy path, which is by design).
   */
  webcamUnavailable?: boolean;
}
let pendingStart: PendingStart | null = null;
let sessionCounter = 0;
let lastResolveInput: (() => StartInput) | null = null;
/** Unsubscribes the live-settings forwarder of the active take. */
let stopLiveSettings: (() => void) | null = null;
/** The active take's live-settings forwarder: its camera-off gaps go into the sidecar. */
let liveSettings: LiveSettingsForwarder | null = null;
/** Stops following whether any window listens to the mic levels, for the active take. */
let stopMicLevelListening: (() => void) | null = null;
/** Whether any window subscribed to the mic levels; only then are they read and sent. */
let micLevelsListening = false;
let lastMicLevels: number[] | null = null;

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
  if (report) sendPhaseReport(report);
}

function sendPhaseReport(report: RecorderPhaseReport): void {
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
 * Begin the countdown (3-2-1 by default; 5 or none per Settings), acquiring the take while it
 * runs, then start it with the input resolved (live) the instant the countdown elapses —
 * mirrors the previous behaviour of reading quality/watermark refs at start time, not at call
 * time. With the countdown off the take starts right away: no "counting" state, no wait for
 * the countdown to be on screen. No-ops unless idle, so callers don't need their own re-entry
 * guard.
 */
export function requestStartRecording(resolveInput: () => StartInput): void {
  if (snapshot.status !== "idle") return;
  lastResolveInput = resolveInput;
  beginRecordTiming("requestStartRecording");
  const request = ++countdownRequest;
  const seconds = countdownSeconds;
  if (seconds === 0) {
    markRecordTiming("countdown off");
    startTake(resolveInput);
    return;
  }
  update({ status: "counting", countdown: seconds });
  // "3" gets its whole second only once it is visible: a region countdown is drawn by a
  // window main opens on this first report, and the clock used to run while it loaded,
  // which read as "3.2...1".
  void countdownVisible().then(() => {
    // Cancelled (or cancelled and started again) while waiting.
    if (request !== countdownRequest || snapshot.status !== "counting") return;
    markRecordTiming("countdown visible, clock started");
    runCountdown(resolveInput, seconds);
    acquireDuringCountdown(resolveInput);
  });
}

/**
 * Open the take's devices while the numbers run, so it can start the moment they end: the
 * acquisition (session file, screen, mic, encoder, cursor track) took about a second, spent in
 * "Starting…" after the countdown. Nothing is encoded and the app is not hidden until then.
 *
 * The input is resolved here, once the countdown is on screen (after the region's shade has
 * loaded, by which time main's broadcast of the chosen target has landed), and resolved again
 * when it ends: that one is the take's. If they differ, this acquisition is released and the
 * take acquires again then, as without it. One that cannot be resolved yet acquires nothing.
 */
function acquireDuringCountdown(resolveInput: () => StartInput): void {
  let input: StartInput;
  try {
    input = resolveInput();
  } catch {
    return; // Resolved again when the countdown ends, which reports the failure.
  }
  markRecordTiming("acquiring during countdown");
  const start = acquireStart(input);
  void start.acquired.then(
    () => {
      if (pendingStart === start && snapshot.status === "counting") {
        markRecordTiming("acquired during countdown");
      }
    },
    () => undefined,
  );
}

async function countdownVisible(): Promise<void> {
  const wait = window.electronAPI.waitForCountdownVisible?.();
  if (!wait) return;
  await Promise.race([wait.catch(() => undefined), delay(COUNTDOWN_VISIBLE_TIMEOUT_MS)]);
}

function runCountdown(resolveInput: () => StartInput, seconds: number): void {
  let remaining = seconds;
  countdownTimer = setInterval(() => {
    remaining -= 1;
    // Each second is a heartbeat: a timeline that stops here had its renderer stall.
    markRecordTiming(`countdown tick (${remaining} left)`);
    if (remaining <= 0) {
      clearCountdownTimer();
      startTake(resolveInput);
    } else {
      update({ countdown: remaining });
    }
  }, 1000);
}

/**
 * The countdown is over (or was never asked for): resolve the take's input, hide the app and
 * start the take — with what the countdown acquired when the input is the same, acquiring now
 * otherwise. Resolved while still pending: a throw (no source selected) then goes back to
 * idle, which main reads as an abandoned countdown — the shade comes down, Esc is released
 * and the hidden app returns. Thrown after "starting", it left all of that stranded.
 */
function startTake(resolveInput: () => StartInput): void {
  const countdownEndedAt = snapshot.status === "counting" ? performance.now() : null;
  let early = pendingStart;
  let input: StartInput;
  try {
    input = resolveInput();
  } catch (error) {
    if (early) {
      pendingStart = null;
      discardStart(early);
    }
    reportError(runtimeT()("record.errorStart"), error, { context: { phase: "start" } });
    const wasIdle = snapshot.status === "idle";
    update({ status: "idle", countdown: null });
    // Without a countdown the recorder never left idle, so `update` reports nothing: tell main
    // the prepared start is dead, or the hidden app waits out the region's expiry.
    if (wasIdle) sendPhaseReport({ phase: "idle" });
    return;
  }
  // A webcam the user turned off during the countdown is closed for good on the prepared
  // engine: turned on again, the input matches but that engine would record no webcam.
  if (early && (needsNewAcquisition(early.input, input) || early.live?.webcamEnded())) {
    markRecordTiming("input changed during countdown, acquiring again");
    pendingStart = null;
    discardStart(early);
    early = null;
  }
  if (countdownEndedAt !== null) markRecordTiming("countdown ended");
  update({ status: "starting", countdown: null });
  const hidden = hideAppForTake(input);
  // Acquired after the hide was asked for, as before the countdown acquired: the screen's
  // first frames never show the app, whatever the margin below.
  if (!early) markRecordTiming("acquiring");
  const start = early ?? acquireStart(input);
  void beginTake(start, input, hidden, countdownEndedAt);
}

/**
 * Whether the input resolved at the end of the countdown needs another acquisition than the
 * one made during it: what a prepared engine cannot change live. Left out on purpose, because
 * the live-settings forwarder applies them to the prepared engine (`sync` at the end of the
 * countdown, broadcasts before): system audio on/off (loopback is acquired either way, "off"
 * is a gain), mic on/off (a mute, or a late open of the device), and the audio settings (mic
 * level, noise suppression, which reopens the same device, system volume and ducking). Not
 * left out: switching from one mic to another, which no take does live.
 */
function needsNewAcquisition(early: StartInput, input: StartInput): boolean {
  const fixed = (start: StartInput): string =>
    JSON.stringify([
      start.sourceId,
      start.area ?? null,
      start.width ?? null,
      start.height ?? null,
      start.frameRate ?? null,
      start.videoBitrate ?? null,
      start.watermark ?? null,
      // The webcam opens with the take: turned on or off during the countdown, it acquires again.
      start.webcam ? [start.webcam.deviceId, start.webcam.lines] : null,
    ]);
  if (fixed(early) !== fixed(input)) return true;
  return (
    early.microphoneDeviceId !== null &&
    input.microphoneDeviceId !== null &&
    early.microphoneDeviceId !== input.microphoneDeviceId
  );
}

/**
 * Hide the main window and announce the take (`recordingStart`: the bar, the shade, Esc
 * released). Resolves once the take may encode: at once when the window was already out of
 * sight, `WINDOW_HIDE_SETTLE_MS` after main hid one that was on screen. The question goes
 * first, on the same IPC pipe, so main answers it before `recordingStart` hides the window.
 */
async function hideAppForTake(input: StartInput): Promise<void> {
  const wasVisible = window.electronAPI.recordingHideMainWindow();
  window.electronAPI.recordingStart({
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    area: input.area ?? null,
  });
  // No answer: wait as if it was on screen, a margin is cheaper than the app in the take.
  if (await wasVisible.catch(() => true)) await delay(WINDOW_HIDE_SETTLE_MS);
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
    markRecordTiming("cancelled during the countdown");
    clearCountdownTimer();
    // Acquired during the countdown: released, whatever it is still waiting on. The app was
    // never hidden for it, so there is nothing to restore.
    const start = pendingStart;
    pendingStart = null;
    if (start) discardStart(start);
    update({ status: "idle", countdown: null });
    return;
  }
  if (snapshot.status === "starting") {
    markRecordTiming("cancelled while starting");
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

/**
 * Acquire a take: its session file, then the engine (screen, mic, encoder) and the cursor
 * track, without encoding anything. It becomes the pending start.
 */
function acquireStart(input: StartInput): PendingStart {
  // Unique across renderer restarts: a recreated renderer must not reuse a dead take's id.
  const id = `session-${Date.now().toString(36)}-${++sessionCounter}`;
  const created = window.electronAPI.recordingCreate(id, "screen", "take");
  // The webcam's own session (ADR 0032), only with the camera on and where this OS can leave
  // the bubble out of the capture. Elsewhere (Windows before 10 2004, the legacy path) the
  // face is recorded in the screen by design and the user is told nothing. A session that
  // cannot be created leaves the take without a webcam, never without the take. Created after
  // the screen's, as main expects: the capability answer comes back after that request left.
  const webcamCreated = input.webcam
    ? window.electronAPI
        .recordingWebcamTrackSupported()
        // Unanswered: treat it as unsupported, the safe side (no webcam file, the bubble stays
        // in the capture), so an old Windows never gets a notice it should not.
        .catch(() => false)
        .then((supported) =>
          supported
            ? window.electronAPI.recordingCreate(id, "webcam", "take").then(
                () => true,
                (error: unknown) => {
                  console.warn("webcam session could not be created — recording without it", error);
                  // Main already put the bubble back in the capture: tell the user.
                  start.webcamUnavailable = true;
                  return false;
                },
              )
            : false,
        )
    : Promise.resolve(false);
  // Reads `start` only after its first await, once `start` exists.
  const acquire = async (): Promise<[CursorTrackSession, PreparedEngine]> => {
    await created;
    const withWebcam = await webcamCreated;
    // Cancelled while the take's file was being created: the engine must not open the
    // screen or the mic for a take that is already gone (`discardStart` aborts the file).
    if (pendingStart !== start) throw new Error("start cancelled before it was created");
    start.engine = prepareEngine({
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
      webcam:
        withWebcam && input.webcam
          ? { deviceId: input.webcam.deviceId, lines: input.webcam.lines }
          : null,
      // Chunks only flow once the take has begun; a discarded take's go nowhere.
      onChunk: (data, position) => {
        if (sessionId === id) window.electronAPI.recordingWrite(id, data, position);
      },
      onWebcamChunk: (data, position) => {
        if (sessionId === id) window.electronAPI.recordingWrite(id, data, position, "webcam");
      },
      // The camera did not open: main puts the bubble back in the screen capture, and the
      // engine waits for it before it requests the screen (ADR 0032).
      onWebcamUnavailable: async () => {
        start.webcamUnavailable = true;
        await window.electronAPI.recordingWebcamEnded(id);
      },
      // The webcam file ended mid-take (or before it began): main puts the bubble back in
      // the screen capture, so a camera left on or turned on again is recorded there.
      onWebcamEnded: () => {
        void window.electronAPI.recordingWebcamEnded(id).catch((error: unknown) => {
          console.warn("could not report the webcam's end to main", error);
        });
      },
      // A failure mid-recording (encoder error or the screen capture ending)
      // runs the same robust stop — finalize-or-abort + always restore the
      // window/Dock/bar — so the app never gets stuck.
      onError: (error) => {
        // Not recording yet (the countdown, or the cursor session still opening): there is
        // no take to stop, and the start would go on to record a dead capture.
        if (pendingStart === start) {
          start.failure ??= error;
          return;
        }
        // A discarded start's engine: the take on screen, if any, is another one.
        if (sessionId !== id) return;
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
    // unknown display), when IPC fails, or after its own 500 ms timeout. Opened during
    // the countdown, it samples the pointer early: those samples come before the take's
    // time 0 (its anchor) and are dropped when the track is built.
    const [track, prepared] = await Promise.all([
      beginCursorTrackSession(
        window.electronAPI,
        id,
        input.sourceId,
        input.area ? { area: input.area } : {},
      ),
      start.engine,
    ]);
    // From here a level, volume, noise or ducking change reaches the prepared engine: during
    // the countdown it is in effect before the first frame. Changes made while acquiring
    // were kept by `start.audio`.
    if (pendingStart === start) start.live = forwardLiveSettings(prepared, input, start.audio);
    return [track, prepared];
  };
  // Audio settings the user changes while the engine is still acquiring (up to seconds)
  // are kept, then applied once it exists; subscribing only after it resolved lost them.
  const audio = trackAudioSettings(input.audio);
  const start: PendingStart = {
    id,
    input,
    created,
    webcamCreated,
    engine: null,
    acquired: acquire(),
    audio,
    live: null,
  };
  // Nobody awaits an acquisition cancelled during the countdown: its failure is not an error.
  start.acquired.catch(() => undefined);
  pendingStart = start;
  return start;
}

/**
 * The countdown is over: wait for the take's acquisition (done already when the countdown
 * covered it) and for the app to be out of the shot, then begin encoding and start the clock.
 * The take's time 0 is its first encoded frame, after this moment, so the duration and the
 * cursor track's anchor both start at the end of the countdown.
 */
async function beginTake(
  start: PendingStart,
  input: StartInput,
  hidden: Promise<void>,
  countdownEndedAt: number | null,
): Promise<void> {
  const { id } = start;
  try {
    const began = (async (): Promise<[CursorTrackSession, EngineHandle]> => {
      const [track, prepared] = await start.acquired;
      await hidden;
      if (pendingStart !== start) throw new Error("start cancelled before it began");
      if (start.failure !== undefined) throw start.failure;
      // Settings the forwarder could not have seen (changed before the engine was acquired):
      // brought in line with the input resolved at the end of the countdown, before encoding.
      start.live?.sync(input);
      // Before `begin`: the output's first chunk is written as it starts.
      sessionId = id;
      return [track, await prepared.begin()];
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const [track, handle] = await Promise.race([
      began,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`recording start timed out after ${START_TIMEOUT_MS} ms`)),
          START_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    // Cancelled while acquiring: the cancel restored the app and released this start.
    if (pendingStart !== start) return;
    if (start.failure !== undefined) throw start.failure;
    pendingStart = null;
    cursorTrack = track;

    engine = handle;
    capture = buildRecordingCapture({
      sourceId: input.sourceId,
      area: input.area ?? null,
      output: handle.outputSize,
    });
    webcamBubble = input.webcam?.bubble ?? null;
    webcamUnavailable = start.webcamUnavailable === true;
    // The forwarder attached when the take was acquired keeps running for the take.
    stopLiveSettings = start.live?.stop ?? null;
    liveSettings = start.live;
    stopMicLevelListening = followMicLevelListeners();
    const activeTrack = cursorTrack;
    void handle.firstMediaTimestamp.then(({ rendererMs, quality }) => {
      activeTrack?.anchor(rendererMs, quality);
      // Same t0 the cursor track is anchored to. Skip if the take already ended.
      if (engine === handle) videoClock = startElapsed(rendererMs);
    });
    clock = startElapsed(Date.now());
    update({ status: "recording", countdown: null });
    if (countdownEndedAt !== null) {
      const late = Math.round(performance.now() - countdownEndedAt);
      markRecordTiming(`clock started at countdown end +${late}ms`);
    }
    endRecordTiming("status recording");

    // The first tick at once: the bar shows "Starting…" until one arrives.
    reportTick();
    tickTimer = setInterval(reportTick, 100);
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
    videoClock = null;
    // Back to idle (not a separate "error" state) so the Start button is
    // immediately usable again; the toast above carries the retry action.
    update({ status: "idle", countdown: null });
  }
}

/** Timer, levels and status to the bar. */
function reportTick(): void {
  if (!clock || !engine) return;
  const paused = clock.pausedAt !== null;
  window.electronAPI.recordingReportTick({
    elapsedSeconds: Math.floor(elapsedMs(clock, Date.now()) / 1000),
    levels: paused ? [0, 0, 0, 0, 0] : engine.readLevels(),
    status: paused ? "paused" : "recording",
    systemAudioAvailable: engine.hasSystemAudio,
  });
  reportMicLevels(paused);
}

/**
 * Follow whether any window subscribed to the mic levels. They go on their own channel, not
 * the activity tick: broadcast to every window ~10 times a second they would re-render
 * pages that never show them. Returns the unsubscribe.
 */
function followMicLevelListeners(): () => void {
  micLevelsListening = false;
  lastMicLevels = null;
  let heard = false;
  const unsubscribe = window.electronAPI.onMicLevelsListening((listening) => {
    heard = true;
    micLevelsListening = listening;
    lastMicLevels = null;
  });
  // A window may already be listening when the take starts; an event that arrived first wins.
  void window.electronAPI
    .getMicLevelsListening()
    .then((listening) => {
      if (!heard) micLevelsListening = listening;
    })
    .catch(() => undefined);
  return () => {
    unsubscribe();
    micLevelsListening = false;
    lastMicLevels = null;
  };
}

/** Sends the mic's bars to main while someone listens; identical bars are not re-sent. */
function reportMicLevels(paused: boolean): void {
  if (!micLevelsListening || !engine) return;
  // Rounded so a steady room produces identical bars and nothing is re-sent.
  const levels = paused ? [0, 0, 0, 0, 0] : engine.readMicLevels().map(roundLevel);
  if (lastMicLevels && levels.every((level, i) => level === lastMicLevels![i])) return;
  lastMicLevels = levels;
  window.electronAPI.recordingReportMicLevels(levels);
}

/**
 * Release a start that will not become a take, without waiting on it: its settings listeners
 * stop at once, the engine's devices are released whenever it resolves (or the take stopped,
 * if it had begun), and the session's temp file is aborted once main has created it, which
 * also discards its cursor track.
 */
function discardStart(start: PendingStart): void {
  start.audio.stop();
  start.live?.stop();
  void start.engine?.then((prepared) => prepared.release()).catch(() => undefined);
  // After both sessions exist: an abort that reached main before the webcam's create would
  // leave that file open with nobody to delete it.
  void Promise.all([start.created.catch(() => undefined), start.webcamCreated])
    .then(() => window.electronAPI.recordingAbort(start.id))
    .catch(() => undefined);
}

interface AudioSettingsTracker {
  /** The newest audio settings seen so far (the start's own until one changes). */
  latest(): AudioSettings;
  stop(): void;
}

/** Remembers the newest `AppSettings.audio` broadcast from now on. */
function trackAudioSettings(initial: AudioSettings): AudioSettingsTracker {
  let latest = initial;
  let unsubscribe: (() => void) | null = window.electronAPI.onSettingsChanged((appSettings) => {
    latest = sanitizeAudioSettings(appSettings.audio);
  });
  return {
    latest: () => latest,
    stop: () => {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

interface LiveSettingsForwarder {
  /**
   * Apply the mic and system-audio toggles of `input` where they differ from what the engine
   * last got: a toggle changed before the forwarder existed reached no broadcast listener.
   * The audio settings are not taken from `input`: the tracker and the broadcasts that feed
   * the forwarder are at least as new as it.
   */
  sync(input: StartInput): void;
  /** Whether it ended the engine's webcam (camera turned off); the engine cannot reopen it. */
  webcamEnded(): boolean;
  /** The take's camera-off periods (screen ms), one still open closed at `endMs`. */
  webcamGaps(endMs: number): WebcamGap[];
  /** The camera was turned on again mid-take and could not be opened: the face went to the screen. */
  webcamReopenFailed(): boolean;
  stop(): void;
}

/**
 * Now on the take's screen timeline (ms from its first media sample, pauses removed): where a
 * camera-off gap starts or ends. The wall clock until the first sample's time is known.
 */
function takeTimeMs(): number {
  if (videoClock) return elapsedMs(videoClock, performance.now());
  return clock ? elapsedMs(clock, Date.now()) : 0;
}

/**
 * From the moment a take is acquired (during the countdown too) until it ends, forward the
 * user's live toggles (any window, any shortcut — they all just write `RecordingSettings`)
 * to the engine. When the engine answers
 * "unavailable", write the setting back to `false` so every surface shows the
 * truth. Calls are serialized so a quick off/on never lands out of order.
 *
 * Also forwards the persisted `AppSettings.audio` (level, noise, volume, ducking) the same
 * way: only the fields that differ from what the engine last got, on the same queue. The
 * mic device is never switched mid-take.
 * Returns the unsubscribe.
 */
function forwardLiveSettings(
  handle: LiveAudioControls & LiveWebcamControls & Pick<EngineHandle, "endWebcam">,
  input: StartInput,
  early: AudioSettingsTracker,
): LiveSettingsForwarder {
  let micOn = input.microphoneDeviceId !== null;
  // Turning the camera off mid-take releases the camera and keeps the webcam file running on
  // the take's clock (a gap, hidden by the editor); turning it on again feeds the same file
  // (ADR 0032 § camera toggled mid-take). Where the engine cannot (the countdown, no relay),
  // off ends the file there, as before: turned on again, the take records no second webcam
  // file, the engine reports the end (`onWebcamEnded`) and main leaves the bubble in the
  // screen capture, so the face is recorded there.
  let webcamOn = Boolean(input.webcam);
  let webcamEnded = false;
  /** The camera is off mid-take and the webcam file goes on: turning it on resumes it. */
  let webcamParked = false;
  let webcamReopenFailed = false;
  /** Bumped by each camera turned on mid-take: only the newest closes the gap. */
  let webcamOnRequest = 0;
  const gaps = new WebcamGapLog();
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

  // What the engine was started with; every change is a diff against what it last got.
  let audio = input.audio;
  /** The noise suppression actually in effect: what the engine last confirmed. */
  let noiseInEffect = input.audio.noiseSuppression;
  let noiseRequest = 0;
  const applyAudio = (next: AudioSettings): void => {
    const previous = audio;
    audio = next;
    if (next.micLevel !== previous.micLevel) {
      queue = queue.then(() => handle.setMicLevel(next.micLevel));
    }
    if (next.noiseSuppression !== previous.noiseSuppression) {
      const request = ++noiseRequest;
      queue = queue.then(async () => {
        if (!active) return;
        const result = await handle.setNoiseSuppression(next.noiseSuppression);
        if (result === "ok") {
          noiseInEffect = next.noiseSuppression;
        } else if (request === noiseRequest && active && audio.noiseSuppression !== noiseInEffect) {
          // The device would not switch: show the truth, unless a newer choice is waiting.
          audio = { ...audio, noiseSuppression: noiseInEffect };
          void window.electronAPI.updateSettings({ audio });
        }
      });
    }
    if (next.systemAudioVolume !== previous.systemAudioVolume) {
      queue = queue.then(() => void handle.setSystemAudioVolume(next.systemAudioVolume));
    }
    if (next.duckSystemAudioWhileTalking !== previous.duckSystemAudioWhileTalking) {
      queue = queue.then(() => void handle.setDucking(next.duckSystemAudioWhileTalking));
    }
  };
  // Changes made before the engine existed, then the live ones.
  const missed = early.latest();
  early.stop();
  applyAudio(missed);
  const unsubscribeAudio = window.electronAPI.onSettingsChanged((appSettings) => {
    applyAudio(sanitizeAudioSettings(appSettings.audio));
  });
  const applyToggles = (
    micEnabled: boolean,
    deviceId: string | null,
    sysEnabled: boolean,
  ): void => {
    if (micEnabled !== micOn) {
      micOn = micEnabled;
      const on = micOn;
      queue = queue.then(async () => {
        const result = await handle.setMicrophoneEnabled(on, deviceId);
        if (result === "unavailable" && on) {
          micOn = false;
          writeBack({ isMicrophoneEnabled: false });
        }
      });
    }
    if (sysEnabled !== sysOn) {
      sysOn = sysEnabled;
      if (handle.setSystemAudioEnabled(sysOn) === "unavailable" && sysOn) {
        sysOn = false;
        writeBack({ isSystemAudioEnabled: false });
      }
    }
  };
  const unsubscribe = window.electronAPI.onRecordingSettingsChanged((settings) => {
    applyToggles(
      settings.isMicrophoneEnabled,
      settings.selectedMicrophone?.deviceId ?? null,
      settings.isSystemAudioEnabled,
    );
    if (webcamOn && !settings.isCameraEnabled) {
      webcamOn = false;
      // A webcam file already ended (here or by the engine) has nothing left to end or keep.
      if (webcamEnded) return;
      if (handle.turnWebcamOff()) {
        webcamParked = true;
        gaps.open(takeTimeMs());
      } else {
        webcamEnded = true;
        handle.endWebcam();
      }
    } else if (!webcamOn && webcamParked && settings.isCameraEnabled) {
      webcamOn = true;
      webcamParked = false;
      const request = ++webcamOnRequest;
      // On the queue, after any earlier on. An off is not queued: it reaches the engine at
      // once, and the engine drops a camera still opening when it is turned off again.
      queue = queue.then(async () => {
        const result = await handle.turnWebcamOn();
        if (result === "ok") {
          // Turned off again meanwhile (the engine answers "ok" for a camera it dropped), or
          // turned on again after that, by an on still to come: the gap goes on, and only the
          // newest on closes it, once its own camera's frames are back.
          if (webcamOn && request === webcamOnRequest) gaps.close(takeTimeMs());
          return;
        }
        // The file ended here (the engine reported it, main put the bubble back in the
        // capture): the gap ends with it, and the user is told once the take is saved.
        gaps.close(takeTimeMs());
        webcamParked = false;
        webcamEnded = true;
        webcamReopenFailed = true;
      });
    }
  });
  return {
    sync(next) {
      if (!active) return;
      applyToggles(next.microphoneDeviceId !== null, next.microphoneDeviceId, next.systemAudio);
    },
    webcamEnded: () => webcamEnded,
    webcamGaps: (endMs) => gaps.finish(endMs),
    webcamReopenFailed: () => webcamReopenFailed,
    stop() {
      active = false;
      unsubscribe();
      unsubscribeAudio();
    },
  };
}

export function pauseRecording(): void {
  // Only a recording pauses: while finalizing the engine is already stopping, and a pause
  // here would move the store out of "finalizing" under a take that is saving.
  if (snapshot.status !== "recording" || !engine || !clock) return;
  const pausedAt = performance.now();
  engine.pause();
  cursorTrack?.pause(pausedAt);
  if (videoClock) videoClock = pauseElapsed(videoClock, pausedAt);
  clock = pauseElapsed(clock, Date.now());
  update({ status: "paused" });
}

export function resumeRecording(): void {
  if (snapshot.status !== "paused" || !engine || !clock) return;
  const resumedAt = performance.now();
  engine.resume();
  cursorTrack?.resume(resumedAt);
  if (videoClock) videoClock = resumeElapsed(videoClock, resumedAt);
  clock = resumeElapsed(clock, Date.now());
  update({ status: "recording" });
}

async function stopRecording(): Promise<void> {
  const activeEngine = engine;
  const activeSessionId = sessionId;
  const activeCapture = capture;
  const activeBubble = webcamBubble;
  // Guard re-entry: the user clicking Stop and an engine-failure can both fire.
  if (stopping || !activeEngine || !activeSessionId) return;
  stopping = true;
  beginRecordTiming("stop requested", true);
  const activeLive = liveSettings;
  stopLiveSettings?.();
  stopLiveSettings = null;
  liveSettings = null;
  stopMicLevelListening?.();
  stopMicLevelListening = null;
  update({ status: "finalizing", countdown: null });
  const wallMs = clock ? elapsedMs(clock, Date.now()) : 0;
  const durationSeconds = Math.floor(wallMs / 1000);
  // Video length at the stop request, measured from the MP4's first media sample (t0), not
  // from when the bar started: the thumbnail capture delays the bar's clock by >= 150 ms,
  // which the cursor tracker's tail cut cannot absorb. Falls back to the wall clock when
  // t0 never resolved (cursor track off, or the first-media wait timed out).
  const durationMs = videoClock ? elapsedMs(videoClock, performance.now()) : wallMs;
  // The camera-off periods; one still open (the camera off at the stop) ends with the take.
  const webcamGaps = activeLive?.webcamGaps(durationMs) ?? [];
  if (activeLive?.webcamReopenFailed()) webcamUnavailable = true;
  // Flip the bar to "Saving…" before the timer stops, so the finalize wait reads
  // as progress instead of a frozen widget.
  window.electronAPI.recordingReportTick({
    elapsedSeconds: durationSeconds,
    levels: [0, 0, 0, 0, 0],
    status: "saving",
  });
  stopTicks();

  let recording: LocalRecording | null = null;
  /** The take recorded a webcam file: the saved recording should carry it. */
  const recordedWebcam = activeEngine.webcam !== null;
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
        const webcam = await webcamFinalizeMeta(activeEngine, activeBubble, webcamGaps);
        const finalized = await window.electronAPI.recordingFinalize(activeSessionId, {
          title,
          durationSeconds,
          durationMs,
          thumbnail,
          capture: activeCapture,
          webcam,
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
  if (recording && webcamUnavailable)
    showToast({ message: runtimeT()("record.webcamUnavailable") });
  // The webcam file failed (its encoder, its finalize at stop, or main could not place it):
  // the bubble was out of the capture while it recorded, so the face may be in no file.
  // Nothing signals this during the take; the screen recording is kept, and the user told.
  else if (recording && recordedWebcam && !recording.webcam)
    showToast({ message: runtimeT()("record.webcamNotSaved") });
  webcamUnavailable = false;
  engine = null;
  cursorTrack = null;
  sessionId = null;
  capture = null;
  webcamBubble = null;
  clock = null;
  videoClock = null;
  stopping = false;
  update({ status: "idle", countdown: null });
}

/**
 * The webcam entry finalize sends (ADR 0032): where the webcam file's time 0 sits against the
 * screen's, both read from the same renderer clock. Null without a usable webcam file, which
 * makes main discard its part. Both timestamps resolve within ~1 frame of the start (3 s at
 * most, then "estimated"), so this never holds the save up past that; one the live wait gave
 * up on is read again after the stop (`startTimesAfterStop`), and is exact if it filled late.
 */
async function webcamFinalizeMeta(
  handle: EngineHandle,
  bubble: WebcamRecordedLayout | null,
  gaps: WebcamGap[] = [],
): Promise<WebcamTrackMeta | null> {
  const webcam = handle.webcam;
  if (!webcam || !webcam.isUsable()) return null;
  const starts = await webcam.startTimesAfterStop();
  return {
    ...webcamStartOffset(starts.screen, starts.webcam),
    width: webcam.size.width,
    height: webcam.size.height,
    fps: WEBCAM_FPS,
    ...(bubble ? { recordedLayout: bubble } : {}),
    ...(gaps.length > 0 ? { gaps } : {}),
  };
}

// The countdown length (Settings → Recording). Registered at import like the command listener
// below, so every window that records follows the same persisted value. A broadcast that lands
// before the first read finishes wins: it is newer than the file the read saw.
let countdownBroadcastSeen = false;
window.electronAPI.onSettingsChanged?.((settings) => {
  countdownBroadcastSeen = true;
  countdownSeconds = sanitizeCountdownSeconds(settings.recordingCountdownSeconds);
});
void window.electronAPI
  .getSettings?.()
  .then((settings) => {
    if (!countdownBroadcastSeen) {
      countdownSeconds = sanitizeCountdownSeconds(settings.recordingCountdownSeconds);
    }
  })
  .catch(() => {
    // Unreadable settings leave the default: a take never depends on this read.
  });

// The bar's buttons and the global stop shortcut arrive as relayed commands.
// Registered ONCE here at module scope — not inside a React effect tied to a
// page's mount — so it is never dropped by navigation, unmounting, or a page
// remount, and correctly cancels a pending countdown instead of only ever
// acting on a live engine.
window.electronAPI.onRecordingCommand((command) => {
  markRecordTiming(`command from main: ${command}`);
  if (command === "pause") pauseRecording();
  else if (command === "resume") resumeRecording();
  else if (command === "stop") stopOrCancelRecording();
});
