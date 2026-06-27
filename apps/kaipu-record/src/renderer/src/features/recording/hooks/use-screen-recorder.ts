import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRecording } from "@shared/types";
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

export type RecorderStatus = "idle" | "starting" | "recording" | "paused" | "finalizing" | "error";

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

export interface ScreenRecorderOptions {
  /** Called once the recording is finalized into the vault (used to navigate). */
  onComplete?: (recording: LocalRecording) => void;
}

export interface ScreenRecorderControls {
  status: RecorderStatus;
  start(input: StartInput): Promise<void>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
}

let sessionCounter = 0;

/** Minimum time the bar shows "Saving…" so it never just flashes on short clips. */
const MIN_SAVING_MS = 600;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Orchestrates a recording: opens a disk-writer session, starts the mediabunny
 * engine, drives the elapsed clock, streams a ~10/s tick (elapsed + mic levels +
 * status) to the main process for the floating bar, and reacts to the bar's
 * pause/resume/stop commands. The heavy lifting lives in the engine + the pure
 * clock; this hook is just wiring + React state.
 */
export function useScreenRecorder(options: ScreenRecorderOptions = {}): ScreenRecorderControls {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const engineRef = useRef<EngineHandle | null>(null);
  const sessionRef = useRef<string | null>(null);
  const clockRef = useRef<ElapsedState | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  const lastInputRef = useRef<StartInput | null>(null);
  const onCompleteRef = useRef(options.onComplete);
  onCompleteRef.current = options.onComplete;

  const stopTicks = useCallback(() => {
    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = null;
  }, []);

  const start = useCallback(async (input: StartInput): Promise<void> => {
    // `sessionRef` is set synchronously below, so this also blocks re-entry during
    // the async "starting" window (streams acquiring) — no double session.
    if (engineRef.current || sessionRef.current) return;
    lastInputRef.current = input;
    setStatus("starting");
    const sessionId = `session-${++sessionCounter}`;
    sessionRef.current = sessionId;
    try {
      await window.electronAPI.recordingCreate(sessionId);
      const engine = await startEngine({
        sourceId: input.sourceId,
        microphoneDeviceId: input.microphoneDeviceId,
        systemAudio: input.systemAudio,
        width: input.width,
        height: input.height,
        frameRate: input.frameRate,
        videoBitrate: input.videoBitrate,
        watermark: input.watermark,
        onChunk: (data, position) => window.electronAPI.recordingWrite(sessionId, data, position),
        // A failure mid-recording (encoder error or the screen capture ending)
        // runs the same robust stop — finalize-or-abort + always restore the
        // window/Dock/bar — so the app never gets stuck.
        onError: (error) => {
          reportError(
            "La grabación se detuvo por un error. Guardamos lo que se pudo.",
            error,
            {
              context: { sourceId: input.sourceId, phase: "mid-recording" },
              retry: () => {
                const i = lastInputRef.current;
                if (i) void startRef.current(i);
              },
            },
          );
          void stopRef.current();
        },
      });
      engineRef.current = engine;
      clockRef.current = startElapsed(Date.now());
      setStatus("recording");
      window.electronAPI.recordingStart({
        sourceId: input.sourceId,
        sourceName: input.sourceName,
      });

      tickTimer.current = setInterval(() => {
        const clock = clockRef.current;
        if (!clock) return;
        const paused = clock.pausedAt !== null;
        window.electronAPI.recordingReportTick({
          elapsedSeconds: Math.floor(elapsedMs(clock, Date.now()) / 1000),
          levels: paused ? [0, 0, 0, 0, 0] : engine.readLevels(),
          status: paused ? "paused" : "recording",
        });
      }, 100);
    } catch (error) {
      reportError("No pudimos iniciar la grabación. Vuelve a intentarlo.", error, {
        context: { sourceId: input.sourceId, phase: "start" },
        retry: () => {
          const i = lastInputRef.current;
          if (i) void startRef.current(i);
        },
      });
      if (sessionRef.current) await window.electronAPI.recordingAbort(sessionRef.current);
      engineRef.current = null;
      sessionRef.current = null;
      setStatus("error");
    }
  }, []);

  const pause = useCallback(() => {
    if (!engineRef.current || !clockRef.current) return;
    engineRef.current.pause();
    clockRef.current = pauseElapsed(clockRef.current, Date.now());
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (!engineRef.current || !clockRef.current) return;
    engineRef.current.resume();
    clockRef.current = resumeElapsed(clockRef.current, Date.now());
    setStatus("recording");
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    const engine = engineRef.current;
    const sessionId = sessionRef.current;
    // Guard re-entry: the user clicking Stop and an engine-failure can both fire.
    if (stoppingRef.current || !engine || !sessionId) return;
    stoppingRef.current = true;
    setStatus("finalizing");
    const durationSeconds = clockRef.current
      ? Math.floor(elapsedMs(clockRef.current, Date.now()) / 1000)
      : 0;
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
          await engine.stop();
          return window.electronAPI.recordingFinalize(sessionId, {
            title,
            durationSeconds,
            thumbnail: engine.thumbnail,
          });
        })(),
        delay(MIN_SAVING_MS),
      ]);
    } catch (error) {
      reportError("No pudimos guardar la grabación.", error, {
        context: { sessionId, phase: "finalize" },
        retry: () => {
          const i = lastInputRef.current;
          if (i) void startRef.current(i);
        },
      });
      await window.electronAPI.recordingAbort(sessionId);
    }

    // Navigate to the new recording BEFORE the main window reappears, so it lands
    // on the detail page rather than flashing the Record page first.
    if (recording) onCompleteRef.current?.(recording);
    window.electronAPI.recordingStop();
    engineRef.current = null;
    sessionRef.current = null;
    clockRef.current = null;
    stoppingRef.current = false;
    setStatus("idle");
  }, [stopTicks]);

  // The bar's buttons arrive as relayed commands. Subscribe once; read the
  // latest handlers through refs so the listener never goes stale.
  const pauseRef = useRef(pause);
  const resumeRef = useRef(resume);
  const stopRef = useRef(stop);
  const startRef = useRef(start);
  pauseRef.current = pause;
  resumeRef.current = resume;
  stopRef.current = stop;
  startRef.current = start;
  useEffect(() => {
    return window.electronAPI.onRecordingCommand((command) => {
      if (command === "pause") pauseRef.current();
      else if (command === "resume") resumeRef.current();
      else if (command === "stop") void stopRef.current();
    });
  }, []);

  return { status, start, stop, pause, resume };
}
