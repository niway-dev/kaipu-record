import {
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from "mediabunny";
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
  /** Receives each StreamTarget chunk to forward to the main-process writer. */
  onChunk(data: ArrayBuffer, position: number): void;
  /**
   * Fires if the engine fails *during* a recording — the encoder errors or the
   * screen capture ends (the user stops sharing / closes the source). The caller
   * should tear the recording down cleanly so the app never gets stuck.
   */
  onError?(error: unknown): void;
}

const VIDEO_BITRATE = 8_000_000; // ~8 Mbps, fine for 1080p screen content
const AUDIO_BITRATE = 128_000;

/**
 * Acquire screen + mic, mix audio, and start encoding to MP4 (H.264/AAC) via
 * mediabunny, streaming chunks out through `onChunk`. Returns a handle for
 * pause/resume/stop and live levels.
 */
export async function startEngine(options: EngineOptions): Promise<EngineHandle> {
  // 1. Screen (deterministic Electron desktop capture by source id).
  const screenStream = await navigator.mediaDevices.getUserMedia({
    audio: options.systemAudio
      ? ({ mandatory: { chromeMediaSource: "desktop" } } as MediaTrackConstraints)
      : false,
    video: {
      // @ts-expect-error Electron desktop-capture constraints are non-standard.
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: options.sourceId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  });
  const screenTrack = screenStream.getVideoTracks()[0];

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
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new StreamTarget(writable),
  });
  const videoSource = new MediaStreamVideoTrackSource(screenTrack, {
    codec: "avc",
    bitrate: VIDEO_BITRATE,
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
  output.addVideoTrack(videoSource, { frameRate: 30 });
  let audioSource: MediaStreamAudioTrackSource | null = null;
  if (mixedAudioTrack) {
    audioSource = new MediaStreamAudioTrackSource(mixedAudioTrack, {
      codec: "aac",
      bitrate: AUDIO_BITRATE,
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

  // 5. Poster thumbnail from the first screen frame.
  const thumbnail = await captureThumbnail(screenStream);

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
      for (const stream of inputStreams) stream.getTracks().forEach((t) => t.stop());
      destination.stream.getTracks().forEach((t) => t.stop());
      await audioContext.close();
    },
  };
}

async function captureThumbnail(stream: MediaStream): Promise<ArrayBuffer | null> {
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => setTimeout(r, 150));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.7));
    return blob ? await blob.arrayBuffer() : null;
  } catch {
    return null;
  }
}
