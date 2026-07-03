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

export interface EngineHandle {
  pause(): void;
  resume(): void;
  /** Stop capture, finalize the MP4, resolve when flushed. */
  stop(): Promise<void>;
  /** Current 5-bar mic level (0..1). */
  readLevels(): number[];
  /** A still JPEG frame of the screen captured at start. */
  thumbnail: ArrayBuffer | null;
}

export interface EngineOptions {
  sourceId: string;
  microphoneDeviceId: string | null;
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
  // same getUserMedia call (a Chromium quirk), and only on platforms that support
  // it — Windows does, macOS does NOT via this legacy constraint, where the whole
  // call rejects. So when system audio is requested, try the bundled audio+video
  // call first and FALL BACK to video-only if it rejects: the recording always
  // starts (just without system audio on macOS) instead of failing outright. This
  // is why system audio is genuinely best-effort, matching the mic below.
  let screenStream: MediaStream | null = null;
  if (options.systemAudio) {
    try {
      screenStream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "desktop" } } as MediaTrackConstraints,
        video: videoConstraints,
      });
    } catch (error) {
      console.warn("system audio capture unavailable — recording without it", error);
    }
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

  // 2. Mic (best-effort) + system-audio (best-effort) → mixed single track.
  // Every acquired stream is tracked so stop() releases the OS devices (closing
  // the AudioContext alone does NOT stop the underlying tracks — the mic light
  // would stay on).
  const inputStreams: MediaStream[] = [screenStream];
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  if (options.microphoneDeviceId) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { ideal: options.microphoneDeviceId } },
      });
      inputStreams.push(mic);
      audioContext.createMediaStreamSource(mic).connect(destination);
    } catch {
      /* mic unavailable — continue without it */
    }
  }
  const systemAudioTrack = screenStream.getAudioTracks()[0];
  if (systemAudioTrack) {
    const sysStream = new MediaStream([systemAudioTrack]);
    audioContext.createMediaStreamSource(sysStream).connect(destination);
  }
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

  // Surface mid-recording failures so the caller tears down cleanly (otherwise the
  // app gets stuck: window hidden, bar showing, no real recording). Fires at most
  // once, and not for our own teardown (stop() sets the flag first).
  let teardownStarted = false;
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
    async stop() {
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
