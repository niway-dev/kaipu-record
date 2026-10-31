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
import type { RecordingArea } from "@shared/types/ipc";
import { areaEncodePlan } from "./area-crop";
import { measureFrameSize, playWithin } from "./frame-size";
import { startRecordingCompositor, type RecordingCompositor } from "./recording-compositor";
import { clampMicLevel, clampSystemAudioVolume, type AudioSettings } from "@shared/audio-settings";
import { levelsFromTimeDomain } from "./audio-levels";
import {
  DUCK_RELEASE_MS,
  INITIAL_DUCK_STATE,
  dbfsFromTimeDomain,
  decideDuck,
  type DuckState,
} from "./ducking";
import { waitForFirstMediaTimestamp, type FirstMediaTimestamp } from "./first-media-timestamp";
import { markRecordTiming } from "./record-timing";
import { WEBCAM_BITRATE_BPS, WEBCAM_FPS } from "@shared/webcam-track";

/**
 * The take's live audio controls. A prepared take (`PreparedEngine`, during the countdown)
 * has them too, so a setting changed while the numbers run is in effect when the take
 * begins; a running take (`EngineHandle`) keeps them.
 */
export interface LiveAudioControls {
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
  /**
   * Mic level in percent (0..200, 100 = unchanged), on its own gain so muting never
   * overwrites it. Remembered for a mic acquired later.
   */
  setMicLevel(percent: number): void;
  /**
   * Turn the mic's noise suppression on or off. Chromium cannot reconfigure the processing
   * of a live track, so this reopens the same device with the new setting, wires the new
   * source into the same level node and only then releases the old one (calls are
   * serialized). "ok" with no mic open (the value applies to one acquired later);
   * "unavailable" when the device cannot be reopened, in which case the old source keeps
   * recording and the caller must show the value actually in effect.
   */
  setNoiseSuppression(on: boolean): Promise<LiveToggleResult>;
  /** System-audio volume in percent (0..100), on its own gain. "unavailable" without loopback. */
  setSystemAudioVolume(percent: number): LiveToggleResult;
  /**
   * Lower the system audio while the mic hears a voice. "unavailable" without loopback;
   * turning it off restores the full volume. On a prepared take it is remembered, and the
   * ducking loop starts with the take.
   */
  setDucking(on: boolean): LiveToggleResult;
}

/** The take's webcam file, encoded beside the screen on the same clock (ADR 0037). */
export interface WebcamHandle {
  /** Renderer-clock time of the webcam file's time 0, like the screen's. */
  firstMediaTimestamp: Promise<FirstMediaTimestamp>;
  /**
   * The size the file is encoded at (raw: no crop, no mirror): the first encoded frame's coded
   * size, or what the track reported when no frame has reached the encoder. Read it after stop.
   */
  readonly size: { width: number; height: number };
  /**
   * After `stop`: whether the webcam file finalized cleanly. A webcam unplugged or turned off
   * mid-take is still usable (its file ends there); one whose encoder failed is not.
   */
  isUsable(): boolean;
}

export interface EngineHandle extends LiveAudioControls {
  /** Pauses (and `resume` resumes) every source in the same call: screen, audio, webcam. */
  pause(): void;
  resume(): void;
  /** Stop capture, finalize the MP4, resolve when flushed. */
  stop(): Promise<void>;
  /** Current 5-bar level (0..1) of the mix: mic and system audio, as they are recorded. */
  readLevels(): number[];
  /**
   * Current 5-bar level (0..1) of the microphone alone, before its mute gain; zeros while
   * no mic is open. The settings meter shows the mic, not the mix.
   */
  readMicLevels(): number[];
  /**
   * A still JPEG frame of the screen captured at start. Taken in the background (it is only
   * needed at finalize), so the take never waits for it; null when it could not be taken.
   */
  thumbnail: Promise<ArrayBuffer | null>;
  /**
   * The size the video is encoded at: the compositor's target (area crop or `fitToCap`
   * downscale), which equals the native track size when frames are encoded raw.
   */
  outputSize: { width: number; height: number };
  /**
   * Renderer-clock time of video time 0 (the MP4's first media sample). Resolves
   * within ~1 frame of start; "estimated" if mediabunny's private field is missing.
   */
  firstMediaTimestamp: Promise<FirstMediaTimestamp>;
  /** The webcam file being recorded; null when the take has none (off, or it failed to open). */
  webcam: WebcamHandle | null;
  /**
   * End the webcam file here and release the camera (the user turned the camera off); the
   * take goes on without it. No-op without a webcam.
   */
  endWebcam(): void;
}

/**
 * A take whose devices are open (screen, mic, audio graph, compositor) and whose encoder is
 * built, but which encodes nothing yet. The recorder acquires one during the countdown, so the
 * take can start the instant the countdown ends.
 */
export interface PreparedEngine extends LiveAudioControls {
  /**
   * Start encoding. The take's time 0 (`firstMediaTimestamp`) is the first frame after this
   * call: nothing captured before it reaches the file. Called once.
   */
  begin(): Promise<EngineHandle>;
  /**
   * Release a take that will not record: every device, the compositor, the audio graph and
   * the ducking loop. After `begin` it stops the take instead, once `begin` settles, so a
   * cancel landing at any moment leaves no device open.
   */
  release(): void;
  /** Drop the webcam from the take before it begins, releasing the camera. */
  endWebcam(): void;
}

export type LiveToggleResult = "ok" | "unavailable";

/** Mute/unmute ramp length — long enough to avoid a click, short enough to feel instant. */
export const GAIN_RAMP_SECONDS = 0.02;

/** How often the ducking loop samples the mic. */
const DUCK_POLL_MS = 50;

export interface EngineOptions {
  sourceId: string;
  /**
   * Record only this part of the source's display (ADR 0030). The source is still the whole
   * display; the compositor draws just the area, so it always runs when this is set.
   */
  area?: RecordingArea | null;
  /** Mic to open at start, or `null` when the mic is off (it can be acquired later). */
  microphoneDeviceId: string | null;
  /**
   * Whether system audio starts audible. Loopback is acquired whenever the
   * platform allows it regardless of this flag: "off" is gain 0, so it can be
   * turned on mid-take (loopback can only be acquired with the screen, at start).
   */
  systemAudio: boolean;
  /**
   * Mic level, noise suppression, system-audio volume and ducking at start. The defaults
   * (`DEFAULT_AUDIO_SETTINGS`) leave the take exactly as it was before these existed.
   */
  audio: AudioSettings;
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
  /**
   * Record the webcam into its own file beside the screen (ADR 0037): the camera to open
   * (`null` = the user-facing default) and the lines to ask for, 16:9. A camera that cannot be
   * opened never fails the take; it records without a webcam.
   */
  webcam?: { deviceId: string | null; lines: number } | null;
  /** Receives each StreamTarget chunk to forward to the main-process writer. */
  onChunk(data: ArrayBuffer, position: number): void;
  /** Same, for the webcam file's chunks (its own writer session). */
  onWebcamChunk?(data: ArrayBuffer, position: number): void;
  /**
   * Fires if the engine fails once acquired — the encoder errors or the screen
   * capture ends (the user stops sharing / closes the source), during the recording
   * or while a prepared take waits for its countdown. The caller should tear the
   * recording down cleanly so the app never gets stuck.
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
 * How long the take waits for the camera to open before it records without a webcam. A macOS
 * permission prompt left open or a hung device never settles, and the store fails the whole
 * start after 10 s (`START_TIMEOUT_MS`): 3 s leaves that budget to the screen, its frame-size
 * probe (1.5 s) and the encoder, and is far longer than a camera that works takes to open.
 */
export const WEBCAM_OPEN_TIMEOUT_MS = 3000;

/** How long stop waits for a poster frame still being taken before it saves without one. */
const THUMBNAIL_STOP_WAIT_MS = 1000;

/**
 * Acquire screen + mic, mix audio, and start encoding to MP4 (H.264/AAC) via
 * mediabunny, streaming chunks out through `onChunk`. Returns a handle for
 * pause/resume/stop and live levels.
 */
export async function startEngine(options: EngineOptions): Promise<EngineHandle> {
  return (await prepareEngine(options)).begin();
}

/**
 * Acquire screen + mic, build the audio graph and the MP4 encoder, without starting it:
 * `begin` starts it. The output is not started, rather than started paused, because
 * mediabunny's sources cannot be paused before their first frame: a paused first frame leaves
 * the frame-rate sampler without its time base, and the take fails when it resumes.
 */
export async function prepareEngine(options: EngineOptions): Promise<PreparedEngine> {
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
  const acquireScreen = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "desktop" } } as MediaTrackConstraints,
        video: videoConstraints,
      });
    } catch (error) {
      console.warn("system audio capture unavailable — recording without it", error);
    }
    return navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  };
  const screenRequest = acquireScreen();
  // The mic opens alongside the screen instead of after it and the compositor: both are OS
  // device opens, and the take waited for one, then the other.
  const micRequest = options.microphoneDeviceId
    ? openMicrophone(options.microphoneDeviceId, options.audio.noiseSuppression)
    : Promise.resolve(null);
  // The webcam opens alongside them too, in its own request: it is not part of the screen.
  const webcamRequest = options.webcam
    ? openWebcamWithin(options.webcam, WEBCAM_OPEN_TIMEOUT_MS)
    : Promise.resolve(null);
  // A start that fails before the mic and the webcam are wired in must still release them
  // (the mic light, the camera light).
  const releaseMicOnFailure = (error: unknown): never => {
    void micRequest.then((mic) => mic?.getTracks().forEach((track) => track.stop()));
    void webcamRequest.then((cam) => cam?.getTracks().forEach((track) => track.stop()));
    throw error;
  };
  const screenStream = await screenRequest.catch(releaseMicOnFailure);
  const screenTrack = screenStream.getVideoTracks()[0];
  markRecordTiming("screen getUserMedia resolved");

  // 1b. Derive the real output size from the MEASURED native dimensions, keeping
  // the screen's true aspect ratio (so a 3024×1964 MacBook records as 1662×1080,
  // not a stretched 1920×1080). Measured from the frames, not `getSettings()`,
  // which can report the ceiling above (see `measureFrameSize`).
  const { width: sourceW, height: sourceH } = await measureFrameSize(screenTrack, {
    width: fallbackWidth,
    height: capHeight,
  }).catch(releaseMicOnFailure);
  markRecordTiming(`measureFrameSize resolved (${sourceW}x${sourceH})`);
  const areaPlan = options.area
    ? areaEncodePlan({ width: sourceW, height: sourceH }, options.area, capHeight)
    : null;
  const target = areaPlan ? areaPlan.target : fitToCap(sourceW, sourceH, capHeight);

  // 1c. Composite through a canvas only when we must downscale to the target OR
  // burn a watermark; a native frame already at the target with no watermark is
  // encoded raw (zero added cost). The downscale is uniform — `target` keeps the
  // source AR — so nothing is stretched. Failure detection still watches the
  // original `screenTrack` (the canvas track never "ends" when sharing stops).
  const needsResize = target.width !== sourceW || target.height !== sourceH;
  let compositor: RecordingCompositor | null = null;
  let encodeTrack = screenTrack;
  if (areaPlan || options.watermark || needsResize) {
    try {
      compositor = await startRecordingCompositor(
        screenStream,
        target,
        options.watermark ?? null,
        frameRate,
        // Passed only for an area, so a full-display call stays exactly what it was.
        ...(areaPlan ? [areaPlan.source] : []),
      );
    } catch (error) {
      // No take will own the capture: release it, or the screen stays "being recorded".
      screenStream.getTracks().forEach((t) => t.stop());
      return releaseMicOnFailure(error);
    }
    encodeTrack = compositor.track;
  }

  // 2. Mic (best-effort) + system-audio (best-effort) → one mixed track. Each input runs
  // through separate gain nodes so a mute, a level and a duck never overwrite each other:
  //   mic:    source → [mic analyser]            (the raw device signal, after the OS/browser
  //           source → level → mute → destination  noise processing and before the level)
  //   system: source → volume → duck → mute → destination
  // Mute = gain 0, so the file keeps one continuous audio track with no gaps. Every
  // acquired stream is tracked so stop() releases the OS devices (closing the AudioContext
  // alone does NOT stop the underlying tracks — the mic light would stay on).
  const inputStreams: MediaStream[] = [screenStream];
  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  let duckTimer: ReturnType<typeof setInterval> | null = null;
  const stopDucking = (): void => {
    if (duckTimer) clearInterval(duckTimer);
    duckTimer = null;
  };
  /**
   * Frees everything acquired, for a start that failed or a prepared take released; each step
   * is independent and best-effort.
   */
  const releaseAll = (): void => {
    stopDucking();
    try {
      compositor?.stop();
    } catch {
      // already stopped
    }
    for (const stream of inputStreams) stream.getTracks().forEach((t) => t.stop());
    destination.stream.getTracks().forEach((t) => t.stop());
    void audioContext.close().catch(() => undefined);
  };
  try {
    const rampGain = (gain: GainNode, value: number, seconds: number = GAIN_RAMP_SECONDS): void => {
      const now = audioContext.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(value, now + seconds);
    };
    const createGain = (value: number): GainNode => {
      const gain = audioContext.createGain();
      gain.gain.value = value;
      return gain;
    };

    // Live audio settings: the current values, so an input acquired later starts from them.
    let micLevel = clampMicLevel(options.audio.micLevel);
    let noiseSuppression = options.audio.noiseSuppression;
    let micTrack: MediaStreamTrack | null = null;
    let micStream: MediaStream | null = null;
    let micSource: MediaStreamAudioSourceNode | null = null;
    /** The noise-suppression value the open mic was requested with (what is in effect). */
    let micNoise = noiseSuppression;
    let micLevelGain: GainNode | null = null;
    let micMuteGain: GainNode | null = null;
    /** The mic as the user set it (on = audible); a muted mic never ducks the system audio. */
    let micAudible = true;
    // One analyser for the mic alone, tapped straight off the source: before the level gain
    // and the mute gain. It drives both the settings meter and the ducking, so neither moves
    // with the level slider, the meter means the same before and during a take, and it still
    // hears the voice when the mic is muted.
    const micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 1024;
    micAnalyser.smoothingTimeConstant = 0.3;
    const micBuffer = new Uint8Array(micAnalyser.fftSize);

    /** Wires a mic stream's source into the analyser and the level gain (which must exist). */
    const attachMicSource = (stream: MediaStream, level: GainNode): MediaStreamAudioSourceNode => {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(micAnalyser);
      source.connect(level);
      return source;
    };
    const connectMic = (stream: MediaStream): void => {
      micTrack = stream.getAudioTracks()[0] ?? null;
      micStream = stream;
      micLevelGain = createGain(micLevel / 100);
      micMuteGain = createGain(1);
      micAudible = true;
      micSource = attachMicSource(stream, micLevelGain);
      micLevelGain.connect(micMuteGain);
      micMuteGain.connect(destination);
    };
    const acquireMicrophone = async (deviceId: string): Promise<MediaStream | null> => {
      micNoise = noiseSuppression;
      const mic = await openMicrophone(deviceId, noiseSuppression);
      if (mic) inputStreams.push(mic);
      return mic;
    };
    /** Live noise-suppression changes run one at a time, in the order they were asked. */
    let noiseQueue: Promise<unknown> = Promise.resolve();
    const reopenMic = async (): Promise<LiveToggleResult> => {
      if (stopped) return "unavailable";
      const level = micLevelGain;
      const previousStream = micStream;
      const previousSource = micSource;
      if (!micTrack || !level || !previousStream || !previousSource) return "ok"; // none open yet
      const wanted = noiseSuppression;
      if (wanted === micNoise) return "ok";
      const deviceId = micTrack.getSettings().deviceId;
      if (!deviceId) return "unavailable";
      let next: MediaStream | null = null;
      try {
        next = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId }, noiseSuppression: wanted },
        });
      } catch {
        return "unavailable"; // the old source keeps recording
      }
      if (stopped) {
        next.getTracks().forEach((t) => t.stop());
        return "unavailable";
      }
      // Connect the new source before letting the old one go, so the take hears no gap.
      micSource = attachMicSource(next, level);
      micStream = next;
      micTrack = next.getAudioTracks()[0] ?? null;
      micNoise = wanted;
      inputStreams.push(next);
      previousSource.disconnect();
      previousStream.getTracks().forEach((t) => t.stop());
      const index = inputStreams.indexOf(previousStream);
      if (index >= 0) inputStreams.splice(index, 1);
      return "ok";
    };

    const startMic = await micRequest;
    markRecordTiming(`microphone ${startMic ? "opened" : "off or unavailable"}`);
    if (startMic) {
      inputStreams.push(startMic);
      connectMic(startMic);
    }
    const webcamStream = await webcamRequest;
    if (options.webcam)
      markRecordTiming(`webcam ${webcamStream ? "opened" : "off or unavailable"}`);
    // In the inputs, so stop() and releaseAll() release the camera like every other device.
    if (webcamStream) inputStreams.push(webcamStream);
    const systemAudioTrack = screenStream.getAudioTracks()[0];
    let sysVolumeGain: GainNode | null = null;
    let sysDuckGain: GainNode | null = null;
    let sysMuteGain: GainNode | null = null;
    if (systemAudioTrack) {
      sysVolumeGain = createGain(clampSystemAudioVolume(options.audio.systemAudioVolume) / 100);
      sysDuckGain = createGain(1);
      sysMuteGain = createGain(options.systemAudio ? 1 : 0);
      audioContext
        .createMediaStreamSource(new MediaStream([systemAudioTrack]))
        .connect(sysVolumeGain);
      sysVolumeGain.connect(sysDuckGain);
      sysDuckGain.connect(sysMuteGain);
      sysMuteGain.connect(destination);
    }
    // Always present, even with no input connected: the destination then produces
    // silence. mediabunny cannot add a track after start(), and a mid-take unmute
    // needs somewhere to go.
    const mixedAudioTrack = destination.stream.getAudioTracks()[0];

    // Ducking loop: measure the mic, let the pure rules decide, apply the ramp they ask for.
    let duckState: DuckState = INITIAL_DUCK_STATE;
    const duckTick = (): void => {
      if (!sysDuckGain) return;
      micAnalyser.getByteTimeDomainData(micBuffer);
      const decision = decideDuck(
        { dbfs: dbfsFromTimeDomain(micBuffer), now: performance.now(), muted: !micAudible },
        duckState,
      );
      duckState = decision.state;
      if (decision.ramp) rampGain(sysDuckGain, decision.ramp.target, decision.ramp.ms / 1000);
    };
    const startDucking = (): void => {
      if (duckTimer || !sysDuckGain) return;
      duckState = INITIAL_DUCK_STATE;
      duckTimer = setInterval(duckTick, DUCK_POLL_MS);
    };

    // 3. Level analyser tapped off the mix.
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
    // 4b. The webcam: a second Output on the same renderer clock, so the two files differ only
    // by their first accepted sample (the store stores that offset). The raw camera track: the
    // file has no mirror and no framing crop, the editor applies them. No audio track.
    const webcamTrack = webcamStream?.getVideoTracks()[0] ?? null;
    let webcam: {
      output: Output;
      source: MediaStreamVideoTrackSource;
      track: MediaStreamTrack;
      /** What the track reported at prepare time: only a fallback for `encodedSize`. */
      reportedSize: { width: number; height: number };
    } | null = null;
    /**
     * The first frame's coded size, as mediabunny configures the encoder with it. The camera
     * is shared with the bubble's preview, so `getSettings()` can disagree with the frames.
     */
    let webcamEncodedSize: { width: number; height: number } | null = null;
    /** Output started; the camera ended or was turned off; its encoder failed. */
    let webcamStarted = false;
    let webcamClosed = false;
    let webcamFailed = false;
    if (webcamTrack && options.webcam) {
      const webcamWritable = new WritableStream<StreamTargetChunk>({
        write(chunk) {
          options.onWebcamChunk?.(chunk.data.slice().buffer, chunk.position);
        },
      });
      const webcamOutput = new Output({
        format: new Mp4OutputFormat({ fastStart: false }),
        target: new StreamTarget(webcamWritable),
      });
      const webcamSource = new MediaStreamVideoTrackSource(webcamTrack, {
        codec: "avc",
        bitrate: WEBCAM_BITRATE_BPS,
        hardwareAcceleration: "prefer-hardware",
        latencyMode: "realtime",
        onEncoderConfig: (config) => {
          webcamEncodedSize ??= { width: config.width, height: config.height };
        },
      });
      webcamOutput.addVideoTrack(webcamSource, { frameRate: WEBCAM_FPS });
      const { width, height } = webcamTrack.getSettings();
      const lines = options.webcam.lines;
      webcam = {
        output: webcamOutput,
        source: webcamSource,
        track: webcamTrack,
        reportedSize: {
          width: width ?? Math.round((lines * 16) / 9),
          height: height ?? lines,
        },
      };
      // Never an engine error: the take goes on, and finalize drops the unusable file.
      webcamSource.errorPromise.catch((error: unknown) => {
        webcamFailed = true;
        console.warn("webcam encoder failed — the take goes on without it", error);
      });
    }
    /** The webcam source still takes frames. */
    const webcamLive = (): boolean => webcamStarted && !webcamClosed && !webcamFailed;
    /** Ends the webcam file where it is and releases the camera; the take goes on. */
    const endWebcam = (): void => {
      if (!webcam || webcamClosed) return;
      webcamClosed = true;
      if (webcamStarted) {
        try {
          webcam.source.close();
        } catch {
          // already closed or failed
        }
      }
      webcam.track.stop();
    };
    // Unplugged mid-take: the file ends there, the take does not.
    webcamTrack?.addEventListener("ended", endWebcam);

    // Surface failures so the caller tears down cleanly (otherwise the app gets stuck: window
    // hidden, bar showing, no real recording). Wired before the take begins: a screen capture
    // that ends during the countdown fails the start. Fires at most once, and not for our own
    // teardown (stop() and release() set the flag first).
    let teardownStarted = false;
    /** Set by stop() and release(); a live toggle arriving after it is answered "unavailable". */
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

    /** Whether the take has begun: the ducking loop only runs then. */
    let begun = false;
    /** Ducking as last asked for; a prepared take starts the loop when it begins. */
    let duckingOn = options.audio.duckSystemAudioWhileTalking;

    const controls: LiveAudioControls = {
      hasSystemAudio: sysMuteGain !== null,
      async setMicrophoneEnabled(on, deviceId) {
        if (stopped) return "unavailable";
        if (micMuteGain) {
          micAudible = on;
          rampGain(micMuteGain, on ? 1 : 0);
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
          connectMic(mic);
          // The setting changed while the device was opening: bring it in line.
          if (micNoise !== noiseSuppression)
            void (noiseQueue = noiseQueue.then(reopenMic, reopenMic));
          return "ok";
        } finally {
          acquiringMic = false;
        }
      },
      setSystemAudioEnabled(on) {
        if (!sysMuteGain || stopped) return "unavailable";
        rampGain(sysMuteGain, on ? 1 : 0);
        return "ok";
      },
      setMicLevel(percent) {
        micLevel = clampMicLevel(percent);
        if (micLevelGain && !stopped) rampGain(micLevelGain, micLevel / 100);
      },
      setNoiseSuppression(on) {
        noiseSuppression = on;
        const result = noiseQueue.then(reopenMic, reopenMic);
        noiseQueue = result;
        return result;
      },
      setSystemAudioVolume(percent) {
        if (!sysVolumeGain || stopped) return "unavailable";
        rampGain(sysVolumeGain, clampSystemAudioVolume(percent) / 100);
        return "ok";
      },
      setDucking(on) {
        if (!sysDuckGain || stopped) return "unavailable";
        duckingOn = on;
        if (on) {
          if (begun) startDucking();
        } else {
          stopDucking();
          duckState = INITIAL_DUCK_STATE;
          rampGain(sysDuckGain, 1, DUCK_RELEASE_MS / 1000);
        }
        return "ok";
      },
    };

    /** The running take's handle, built by `begin` once the output has started. */
    const handle = (
      thumbnail: Promise<ArrayBuffer | null>,
      firstMediaTimestamp: Promise<FirstMediaTimestamp>,
      webcamHandle: WebcamHandle | null,
    ): EngineHandle => ({
      ...controls,
      // Screen first, then the webcam, in the same call: both drop the same paused time.
      pause: () => {
        videoSource.pause();
        audioSource?.pause();
        if (webcamLive()) webcam?.source.pause();
      },
      resume: () => {
        videoSource.resume();
        audioSource?.resume();
        if (webcamLive()) webcam?.source.resume();
      },
      readLevels: () => {
        analyser.getByteTimeDomainData(levelBuffer);
        return levelsFromTimeDomain(levelBuffer, 5);
      },
      readMicLevels: () => {
        if (!micLevelGain) return [0, 0, 0, 0, 0];
        micAnalyser.getByteTimeDomainData(micBuffer);
        return levelsFromTimeDomain(micBuffer, 5);
      },
      thumbnail,
      outputSize: { width: target.width, height: target.height },
      firstMediaTimestamp,
      webcam: webcamHandle,
      endWebcam,
      async stop() {
        stopped = true;
        stopDucking();
        teardownStarted = true; // stopping the tracks below would otherwise fire onError
        // Stop encoding now: the frames and samples after the stop request do not belong to the
        // take (the store cut its duration at this moment), and the wait below must not add any.
        videoSource.pause();
        audioSource?.pause();
        if (webcamLive()) webcam?.source.pause();
        // The poster frame comes from the screen track: take it before the tracks stop, but
        // never let it hold the save up.
        await Promise.race([thumbnail, delay(THUMBNAIL_STOP_WAIT_MS)]);
        await output.finalize();
        // The webcam after the screen, before the tracks stop. Its failure never fails the
        // take: the file is reported unusable and finalize drops it.
        if (webcam && webcamStarted) {
          if (webcamFailed) await webcam.output.cancel().catch(() => undefined);
          else {
            try {
              await webcam.output.finalize();
            } catch (error) {
              webcamFailed = true;
              console.warn("webcam file could not be finalized — saved without it", error);
            }
          }
        }
        compositor?.stop(); // cancel the draw loop + release the canvas track
        for (const stream of inputStreams) stream.getTracks().forEach((t) => t.stop());
        destination.stream.getTracks().forEach((t) => t.stop());
        await audioContext.close();
      },
    });

    const begin = async (): Promise<EngineHandle> => {
      try {
        await output.start();
      } catch (error) {
        stopped = true;
        teardownStarted = true;
        releaseAll();
        throw error;
      }
      markRecordTiming("output.start resolved");
      begun = true;
      // Only now: a take that never begins must not leave the loop running.
      if (duckingOn) startDucking();
      // Fallback anchor if mediabunny's private first-media timestamp is unavailable:
      // the first frame is accepted within one frame period of start() resolving.
      const startedAt = performance.now();
      const firstMediaTimestamp = waitForFirstMediaTimestamp(output, startedAt);

      // The webcam right after the screen. One that cannot start drops the webcam, not the take.
      let webcamHandle: WebcamHandle | null = null;
      if (webcam && !webcamClosed) {
        try {
          await webcam.output.start();
          webcamStarted = true;
          markRecordTiming("webcam output.start resolved");
          const reportedSize = webcam.reportedSize;
          webcamHandle = {
            firstMediaTimestamp: waitForFirstMediaTimestamp(webcam.output, performance.now()),
            get size() {
              return webcamEncodedSize ?? reportedSize;
            },
            isUsable: () => !webcamFailed,
          };
        } catch (error) {
          console.warn("webcam output could not start — recording without it", error);
          webcamClosed = true;
          webcam.track.stop();
        }
      }

      // 5. Poster thumbnail from the first screen frame of the take, at the real output size.
      // Taken here, not while preparing: during a countdown the screen still shows the app.
      // In the background: the take starts without it, and stop waits for it before the
      // tracks end.
      const thumbnail = captureThumbnail(screenStream, target).then((image) => {
        markRecordTiming("captureThumbnail resolved");
        return image;
      });
      return handle(thumbnail, firstMediaTimestamp, webcamHandle);
    };

    let beginning: Promise<EngineHandle> | null = null;
    let released = false;
    return {
      ...controls,
      endWebcam,
      begin() {
        if (released) return Promise.reject(new Error("engine released before it began"));
        beginning ??= begin();
        return beginning;
      },
      release() {
        if (released) return;
        released = true;
        if (beginning) {
          void beginning.then((started) => started.stop()).catch(() => undefined);
          return;
        }
        stopped = true;
        teardownStarted = true; // stopping the tracks below would otherwise fire onError
        releaseAll();
      },
    };
  } catch (error) {
    // A start that fails here must not leave anything running or held: the ducking loop,
    // the audio context, the compositor and every device acquired so far (the mic light).
    releaseAll();
    throw error;
  }
}

/** Mic (best-effort): the stream, or null when it cannot be opened. */
async function openMicrophone(
  deviceId: string,
  noiseSuppression: boolean,
): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { ideal: deviceId }, noiseSuppression },
    });
  } catch {
    return null; // mic unavailable — continue without it
  }
}

/**
 * Webcam (best-effort): the chosen camera, else the user-facing default (the chosen one may
 * be unplugged; the bubble falls back the same way), or null when none can be opened.
 */
async function openWebcam(webcam: {
  deviceId: string | null;
  lines: number;
}): Promise<MediaStream | null> {
  const size = {
    width: { ideal: Math.round((webcam.lines * 16) / 9) },
    height: { ideal: webcam.lines },
  };
  const attempts: MediaTrackConstraints[] = webcam.deviceId
    ? [
        { deviceId: { exact: webcam.deviceId }, ...size },
        { facingMode: "user", ...size },
      ]
    : [{ facingMode: "user", ...size }];
  for (const video of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch {
      // try the next one
    }
  }
  return null; // webcam unavailable — the take records without it
}

/**
 * `openWebcam`, given up on after `timeoutMs`: the take then records without a webcam, and a
 * camera that answers later is released at once (its light goes off).
 */
async function openWebcamWithin(
  webcam: { deviceId: string | null; lines: number },
  timeoutMs: number,
): Promise<MediaStream | null> {
  const opening = openWebcam(webcam);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([opening, timedOut]);
  clearTimeout(timer);
  if (result !== "timeout") return result;
  console.warn(`webcam did not open within ${timeoutMs} ms — recording without it`);
  void opening.then((late) => late?.getTracks().forEach((track) => track.stop()));
  return null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function captureThumbnail(
  stream: MediaStream,
  target: { width: number; height: number },
): Promise<ArrayBuffer | null> {
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await playWithin(video); // no frame in time: the take goes on without a poster
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
