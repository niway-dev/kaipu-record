import {
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from "mediabunny";
import {
  AUDIO_BITRATE_BPS,
  DEFAULT_QUALITY,
  fitToCap,
  qualityToEngine,
} from "@shared/recording-quality";
import type { WatermarkConfig } from "@renderer/features/watermark/watermark";
import { startRecordingCompositor, type RecordingCompositor } from "./recording-compositor";
import { levelsFromTimeDomain } from "./audio-levels";
import { waitForFirstMediaTimestamp, type FirstMediaTimestamp } from "./first-media-timestamp";

export interface EngineHandle {
  pause(): void;
  resume(): void;
  /** Stop capture, finalize the MP4, resolve when flushed. */
  stop(): Promise<void>;
  /** Current 5-bar mic level (0..1). */
  readLevels(): number[];
  /** A still JPEG frame of the screen captured at start. */
  thumbnail: ArrayBuffer | null;
  /**
   * Renderer-clock time of video time 0 (the MP4's first media sample). Resolves
   * within ~1 frame of start; "estimated" if mediabunny's private field is missing.
   */
  firstMediaTimestamp: Promise<FirstMediaTimestamp>;
  /** True when a loopback (system audio) track was acquired with the screen. */
  hasSystemAudio: boolean;
  /**
   * Mute or unmute the microphone mid-take. Muting ramps its gain to 0 and keeps
   * the device open (unmute stays instant). When the mic was off at start,
   * turning it on acquires `deviceId` late; a failed acquisition answers
   * "unavailable" and the take keeps running.
   */
  setMicrophoneEnabled(on: boolean, deviceId: string | null): Promise<LiveToggleResult>;
  /** Ramp the system-audio gain. "unavailable" when no loopback track exists. */
  setSystemAudioEnabled(on: boolean): LiveToggleResult;
}

export type LiveToggleResult = "ok" | "unavailable";

/** Mute/unmute ramp length — long enough to avoid a click, short enough to feel instant. */
export const GAIN_RAMP_SECONDS = 0.02;

export interface EngineOptions {
  sourceId: string;
  /** Mic to open at start, or `null` when the mic is off (it can be acquired later). */
  microphoneDeviceId: string | null;
  /**
   * Whether system audio starts audible. Loopback is acquired whenever the
   * platform allows it regardless of this flag: "off" is gain 0, so it can be
   * turned on mid-take (loopback can only be acquired with the screen, at start).
   */
  systemAudio: boolean;
  /**
   * Encoder targets resolved from the user's quality preset. All optional — the
   * defaults below preserve the original 1080p · 30fps · 8 Mbps behaviour, so
   * callers/tests that omit them are unaffected. The max* constraints are a
   * ceiling: capture never upscales past the display's native resolution.
   */
  width?: number;
  height?: number;
  frameRate?: number;
  videoBitrate?: number;
  /**
   * When set, the screen is composited with this watermark before encoding.
   * `null`/omitted → the raw screen track is encoded directly (zero added cost).
   */
  watermark?: WatermarkConfig | null;
  /** Receives each StreamTarget chunk to forward to the main-process writer. */
  onChunk(data: ArrayBuffer, position: number): void;
  /**
   * Fires if the engine fails *during* a recording — the encoder errors or the
   * screen capture ends (the user stops sharing / closes the source). The caller
   * should tear the recording down cleanly so the app never gets stuck.
   */
  onError?(error: unknown): void;
}

// Fallback encoder targets when a caller omits them — derived from the model's
// default preset (Equilibrado → 1080p · 30fps · 8 Mbps). No encoder number is
// restated here; the single source of truth is `shared/recording-quality.ts`.
const ENGINE_DEFAULTS = qualityToEngine(DEFAULT_QUALITY);

// Capture ceiling — sits above any real display (8K). Passing a box LARGER than
// the screen makes Chromium return native frames untouched; passing a smaller,
// non-matching box (the old 1920×1080) is what squeezed non-16:9 panels into
// 16:9. The real output size is derived from the measured native dimensions
// (`fitToCap`) and applied, undistorted, by the compositor.
const CAPTURE_CEILING = { width: 7680, height: 4320 } as const;

/**
 * Acquire screen + mic, mix audio, and start encoding to MP4 (H.264/AAC) via
 * mediabunny, streaming chunks out through `onChunk`. Returns a handle for
 * pause/resume/stop and live levels.
 */
export async function startEngine(options: EngineOptions): Promise<EngineHandle> {
  // The resolution preset is a HEIGHT CAP, not a fixed 16:9 box. Width is only a
  // fallback for the source aspect ratio when the track can't report its size.
  const capHeight = options.height ?? ENGINE_DEFAULTS.height;
  const fallbackWidth = options.width ?? ENGINE_DEFAULTS.width;
  const frameRate = options.frameRate ?? ENGINE_DEFAULTS.frameRate;
  const videoBitrate = options.videoBitrate ?? ENGINE_DEFAULTS.videoBitrate;

  // 1. Screen (deterministic Electron desktop capture by source id). Capture at
  // the display's NATIVE resolution (ceiling above any real screen) so frames are
  // never squeezed into a non-matching box.
  // Electron desktop-capture constraints are non-standard (the legacy `mandatory`
  // shape), hence the cast.
  const videoConstraints = {
    mandatory: {
      chromeMediaSource: "desktop",
      chromeMediaSourceId: options.sourceId,
      maxWidth: CAPTURE_CEILING.width,
      maxHeight: CAPTURE_CEILING.height,
      maxFrameRate: frameRate,
    },
  } as unknown as MediaTrackConstraints;

  // System (loopback) audio can only be captured *alongside* desktop video in the
  // same getUserMedia call (a Chromium quirk). It records on Windows and in the
  // PACKAGED macOS app (owner-verified 2026-10-06); a macOS dev build rejects the
  // bundled call. So always try the audio+video call first — whatever the toggle
  // says, because "off" is a gain of 0 and the user may turn it on mid-take — and
  // FALL BACK to video-only if it rejects: the recording always starts (just
  // without system audio) instead of failing outright.
  let screenStream: MediaStream | null = null;
  try {
    screenStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "desktop" } } as MediaTrackConstraints,
      video: videoConstraints,
    });
  } catch (error) {
    console.warn("system audio capture unavailable — recording without it", error);
  }
  if (!screenStream) {
    screenStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    });
  }
  const screenTrack = screenStream.getVideoTracks()[0];

  // 1b. Derive the real output size from the MEASURED native dimensions, keeping
  // the screen's true aspect ratio (so a 3024×1964 MacBook records as 1662×1080,
  // not a stretched 1920×1080).
  const captured = screenTrack.getSettings();
  const sourceW = captured.width ?? fallbackWidth;
  const sourceH = captured.height ?? capHeight;
  const target = fitToCap(sourceW, sourceH, capHeight);

  // 1c. Composite through a canvas only when we must downscale to the target OR
  // burn a watermark; a native frame already at the target with no watermark is
  // encoded raw (zero added cost). The downscale is uniform — `target` keeps the
  // source AR — so nothing is stretched. Failure detection still watches the
  // original `screenTrack` (the canvas track never "ends" when sharing stops).
  const needsResize = target.width !== sourceW || target.height !== sourceH;
  let compositor: RecordingCompositor | null = null;
  let encodeTrack = screenTrack;
  if (options.watermark || needsResize) {
    compositor = await startRecordingCompositor(
      screenStream,
      target,
      options.watermark ?? null,
      frameRate,
    );
    encodeTrack = compositor.track;
  }

  // 2. Mic (best-effort) + system-audio (best-effort) → each through its own
  // GainNode → one mixed track. Mute = gain 0, so the file keeps one continuous
  // audio track with no gaps. Every acquired stream is tracked so stop() releases
  // the OS devices (closing the AudioContext alone does NOT stop the underlying
  // tracks — the mic light would stay on).
  const inputStreams: MediaStream[] = [screenStream];
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  /** Connect a stream through a fresh GainNode starting at `audible ? 1 : 0`. */
  const connectThroughGain = (stream: MediaStream, audible: boolean): GainNode => {
    const gain = audioContext.createGain();
    gain.gain.value = audible ? 1 : 0;
    audioContext.createMediaStreamSource(stream).connect(gain);
    gain.connect(destination);
    return gain;
  };
  const rampTo = (gain: GainNode, on: boolean): void => {
    const now = audioContext.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(on ? 1 : 0, now + GAIN_RAMP_SECONDS);
  };
  const acquireMicrophone = async (deviceId: string): Promise<MediaStream | null> => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { ideal: deviceId } },
      });
      inputStreams.push(mic);
      return mic;
    } catch {
      return null; // mic unavailable — continue without it
    }
  };

  let micGain: GainNode | null = null;
  if (options.microphoneDeviceId) {
    const mic = await acquireMicrophone(options.microphoneDeviceId);
    if (mic) micGain = connectThroughGain(mic, true);
  }
  const systemAudioTrack = screenStream.getAudioTracks()[0];
  let sysGain: GainNode | null = null;
  if (systemAudioTrack) {
    sysGain = connectThroughGain(new MediaStream([systemAudioTrack]), options.systemAudio);
  }
  // Always present, even with no input connected: the destination then produces
  // silence. mediabunny cannot add a track after start(), and a mid-take unmute
  // needs somewhere to go.
  const mixedAudioTrack = destination.stream.getAudioTracks()[0];

  // 3. Mic-level analyser tapped off the mix.
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.3;
  audioContext.createMediaStreamSource(destination.stream).connect(analyser);
  const levelBuffer = new Uint8Array(analyser.fftSize);

  // 4. mediabunny output → StreamTarget → onChunk.
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      const copy = chunk.data.slice().buffer; // copy out of pooled buffer
      options.onChunk(copy, chunk.position);
    },
  });
  // `fastStart: false` (moov box at the END of the file, written on finalize)
  // keeps mediabunny writing chunks progressively to disk as they encode — the
  // RecordingWriter below is a positional writer built exactly for this. The
  // "in-memory" mode this replaces buffers the ENTIRE recording in renderer RAM
  // until stop() (nothing hits disk meanwhile), so a long recording would OOM
  // the renderer and a crash before stop would lose the whole session.
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable),
  });
  const videoSource = new MediaStreamVideoTrackSource(encodeTrack, {
    codec: "avc",
    bitrate: videoBitrate,
    // Nudge Chromium toward the platform encoder (VideoToolbox on macOS) instead
    // of its bundled software H.264 (OpenH264). It's a hint — if hardware H.264
    // encode isn't available via WebCodecs, it falls back to software (the prior
    // behaviour). `realtime` suits live capture: drop frames under load rather
    // than build a backlog.
    hardwareAcceleration: "prefer-hardware",
    latencyMode: "realtime",
    onEncoderConfig: (config) => {
      // Verify what Chromium actually configured. If hardware engaged, the
      // "[OpenH264]" warnings in the console disappear.
      console.info("[recorder] video encoder config:", {
        codec: config.codec,
        hardwareAcceleration: config.hardwareAcceleration,
        latencyMode: config.latencyMode,
        width: config.width,
        height: config.height,
        bitrate: config.bitrate,
      });
    },
  });
  output.addVideoTrack(videoSource, { frameRate });
  let audioSource: MediaStreamAudioTrackSource | null = null;
  if (mixedAudioTrack) {
    audioSource = new MediaStreamAudioTrackSource(mixedAudioTrack, {
      codec: "aac",
      bitrate: AUDIO_BITRATE_BPS,
    });
    output.addAudioTrack(audioSource);
  }
  await output.start();
  // Fallback anchor if mediabunny's private first-media timestamp is unavailable:
  // the first frame is accepted within one frame period of start() resolving.
  const startedAt = performance.now();
  const firstMediaTimestamp = waitForFirstMediaTimestamp(output, startedAt);

  // Surface mid-recording failures so the caller tears down cleanly (otherwise the
  // app gets stuck: window hidden, bar showing, no real recording). Fires at most
  // once, and not for our own teardown (stop() sets the flag first).
  let teardownStarted = false;
  /** Set by stop(); a live toggle arriving after it is answered "unavailable". */
  let stopped = false;
  /** Guards against a second late mic acquisition while one is in flight. */
  let acquiringMic = false;
  const notifyError = (error: unknown): void => {
    if (teardownStarted) return;
    teardownStarted = true;
    options.onError?.(error);
  };
  videoSource.errorPromise.catch(notifyError);
  audioSource?.errorPromise.catch(notifyError);
  screenTrack.addEventListener("ended", () => notifyError(new Error("screen capture ended")));

  // 5. Poster thumbnail from the first screen frame, at the real output size.
  const thumbnail = await captureThumbnail(screenStream, target);

  return {
    pause: () => {
      videoSource.pause();
      audioSource?.pause();
    },
    resume: () => {
      videoSource.resume();
      audioSource?.resume();
    },
    readLevels: () => {
      analyser.getByteTimeDomainData(levelBuffer);
      return levelsFromTimeDomain(levelBuffer, 5);
    },
    thumbnail,
    firstMediaTimestamp,
    hasSystemAudio: sysGain !== null,
    async setMicrophoneEnabled(on, deviceId) {
      if (stopped) return "unavailable";
      if (micGain) {
        rampTo(micGain, on);
        return "ok";
      }
      if (!on) return "ok"; // never acquired, nothing to mute
      if (!deviceId || acquiringMic) return "unavailable";
      acquiringMic = true;
      try {
        const mic = await acquireMicrophone(deviceId);
        if (!mic) return "unavailable";
        if (stopped) {
          // The take ended while the device was opening — release it at once.
          mic.getTracks().forEach((t) => t.stop());
          return "unavailable";
        }
        micGain = connectThroughGain(mic, true);
        return "ok";
      } finally {
        acquiringMic = false;
      }
    },
    setSystemAudioEnabled(on) {
      if (!sysGain || stopped) return "unavailable";
      rampTo(sysGain, on);
      return "ok";
    },
    async stop() {
      stopped = true;
      teardownStarted = true; // stopping the tracks below would otherwise fire onError
      await output.finalize();
      compositor?.stop(); // cancel the draw loop + release the canvas track
      for (const stream of inputStreams) stream.getTracks().forEach((t) => t.stop());
      destination.stream.getTracks().forEach((t) => t.stop());
      await audioContext.close();
    },
  };
}

async function captureThumbnail(
  stream: MediaStream,
  target: { width: number; height: number },
): Promise<ArrayBuffer | null> {
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 150));
    const canvas = document.createElement("canvas");
    // Draw at the real output size — uniform scale (target keeps the source AR).
    canvas.width = target.width || video.videoWidth || 1280;
    canvas.height = target.height || video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.7));
    return blob ? await blob.arrayBuffer() : null;
  } catch {
    return null;
  }
}
