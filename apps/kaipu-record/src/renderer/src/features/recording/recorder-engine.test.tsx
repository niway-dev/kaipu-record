import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Output,
  StreamTarget,
} from "mediabunny";
import { Mp4OutputFormat } from "mediabunny";
import { DEFAULT_AUDIO_SETTINGS } from "@shared/audio-settings";
import { startEngine, type EngineOptions } from "./recorder-engine";
import { startRecordingCompositor } from "./recording-compositor";

// The compositor touches a real <canvas>/captureStream (no-op in jsdom), so mock
// it; we assert the engine hands it the right re-frame target instead.
vi.mock("./recording-compositor", () => ({
  startRecordingCompositor: vi.fn(async () => ({ track: { stop: vi.fn() }, stop: vi.fn() })),
}));

// mediabunny is mocked so the engine's wiring is observable without a real encoder.
// The constructors use `function` (not arrows) so the engine's `new` calls work,
// and return the instance object so `.mock.results` exposes the spies.
vi.mock("mediabunny", () => ({
  Output: vi.fn(function () {
    return {
      addVideoTrack: vi.fn(),
      addAudioTrack: vi.fn(),
      start: vi.fn(async () => {}),
      finalize: vi.fn(async () => {}),
    };
  }),
  StreamTarget: vi.fn(),
  Mp4OutputFormat: vi.fn(),
  // `errorPromise` stays pending so the engine's failure listener never fires.
  MediaStreamVideoTrackSource: vi.fn(function () {
    return { pause: vi.fn(), resume: vi.fn(), errorPromise: new Promise(() => {}) };
  }),
  MediaStreamAudioTrackSource: vi.fn(function () {
    return { pause: vi.fn(), resume: vi.fn(), errorPromise: new Promise(() => {}) };
  }),
}));

/** A media track that records when it is stopped, so we can assert hardware release. */
function fakeTrack(settings: { width: number; height: number } = { width: 1920, height: 1080 }): {
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  getSettings: ReturnType<typeof vi.fn>;
  applyConstraints: ReturnType<typeof vi.fn>;
} {
  return {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    getSettings: vi.fn(() => settings),
    applyConstraints: vi.fn(async () => {}),
  };
}

function fakeStream(video: unknown[], audio: unknown[]): MediaStream {
  return {
    getVideoTracks: () => video,
    getAudioTracks: () => audio,
    getTracks: () => [...video, ...audio],
  } as unknown as MediaStream;
}

let screenVideoTrack: ReturnType<typeof fakeTrack>;
let screenSystemAudioTrack: ReturnType<typeof fakeTrack>;
let micTrack: ReturnType<typeof fakeTrack>;
let destinationTrack: ReturnType<typeof fakeTrack>;
let getUserMedia: ReturnType<typeof vi.fn>;
let audioContextClose: ReturnType<typeof vi.fn>;

/** A GainNode stand-in that records its starting value and every ramp target. */
interface FakeGain {
  gain: {
    value: number;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}
let gains: FakeGain[];
/** A MediaStreamAudioSourceNode stand-in, in creation order, with the stream it wraps. */
interface FakeSource {
  stream: unknown;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}
let sources: FakeSource[];
/** An AnalyserNode stand-in whose time-domain bytes are all `level` (128 = silence). */
interface FakeAnalyser {
  level: number;
  connect: ReturnType<typeof vi.fn>;
}
/** In creation order: the engine makes the mic-only analyser first, the mix one second. */
let analysers: FakeAnalyser[];
/** Time-domain byte for a steady square wave of the given dBFS (alternates 128 ± amplitude). */
const bytesForDbfs = (dbfs: number): number => 128 + Math.round(128 * 10 ** (dbfs / 20));
/** Ramp targets of a gain, in order. */
const rampTargets = (gain: FakeGain): number[] =>
  gain.gain.linearRampToValueAtTime.mock.calls.map((c) => c[0] as number);

beforeEach(() => {
  vi.clearAllMocks(); // module-level mocks (compositor, mediabunny) accumulate across tests
  screenVideoTrack = fakeTrack();
  screenSystemAudioTrack = fakeTrack();
  micTrack = fakeTrack();
  destinationTrack = fakeTrack();
  audioContextClose = vi.fn(async () => {});
  gains = [];
  analysers = [];
  sources = [];

  getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
    // The screen request carries video constraints; everything else is the mic.
    if (constraints.video) {
      const systemAudio = Boolean(constraints.audio);
      return fakeStream([screenVideoTrack], systemAudio ? [screenSystemAudioTrack] : []);
    }
    return fakeStream([], [micTrack]);
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });

  class FakeAudioContext {
    createMediaStreamDestination = vi.fn(() => ({
      stream: fakeStream([], [destinationTrack]),
    }));
    createMediaStreamSource = vi.fn((stream: unknown) => {
      const node: FakeSource = { stream, connect: vi.fn(), disconnect: vi.fn() };
      sources.push(node);
      return node;
    });
    currentTime = 10;
    createGain = vi.fn(() => {
      const node: FakeGain = {
        gain: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      gains.push(node);
      return node;
    });
    createAnalyser = vi.fn(() => {
      const node = {
        fftSize: 0,
        smoothingTimeConstant: 0,
        level: 128,
        connect: vi.fn(),
        getByteTimeDomainData: vi.fn((out: Uint8Array) => out.fill(node.level)),
      };
      analysers.push(node);
      return node;
    });
    close = audioContextClose;
  }
  // captureThumbnail plays a hidden <video>; jsdom's media element never resolves
  // play(), so stub it (the thumbnail itself is out of scope here).
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  // jsdom's toBlob never invokes its callback, which would hang the thumbnail await.
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
  // jsdom has no 2D context; return null (the engine already guards with `?.`).
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  vi.stubGlobal("AudioContext", FakeAudioContext);
  // The engine wraps the system-audio track in `new MediaStream([...])`.
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(public tracks: unknown[]) {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const baseOptions = (over: Partial<EngineOptions> = {}): EngineOptions => ({
  sourceId: "screen:1",
  microphoneDeviceId: null,
  systemAudio: false,
  audio: DEFAULT_AUDIO_SETTINGS,
  onChunk: vi.fn(),
  ...over,
});

/** The Output instance the engine created this run. */
function lastOutput(): {
  addVideoTrack: ReturnType<typeof vi.fn>;
  addAudioTrack: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
} {
  return vi.mocked(Output).mock.results.at(-1)!.value;
}

describe("startEngine", () => {
  it("captures the chosen screen source and starts an MP4 video track", async () => {
    await startEngine(baseOptions({ sourceId: "screen:7" }));

    const screenConstraints = getUserMedia.mock.calls[0][0] as {
      video: { mandatory: { chromeMediaSourceId: string } };
    };
    expect(screenConstraints.video.mandatory.chromeMediaSourceId).toBe("screen:7");
    expect(MediaStreamVideoTrackSource).toHaveBeenCalled();
    expect(lastOutput().addVideoTrack).toHaveBeenCalled();
    expect(lastOutput().start).toHaveBeenCalled();
  });

  it("derives output dimensions from the real screen aspect ratio (no 16:9 squeeze)", async () => {
    // 14" MacBook Pro panel — 3024×1964, AR 1.54, NOT 16:9.
    screenVideoTrack.getSettings = vi.fn(() => ({ width: 3024, height: 1964 }));

    await startEngine(baseOptions());

    // Captured at the native ceiling, never the 1920×1080 box that squeezed it.
    const mandatory = (
      getUserMedia.mock.calls[0][0] as {
        video: { mandatory: { maxWidth: number; maxHeight: number } };
      }
    ).video.mandatory;
    expect(mandatory.maxWidth).toBeGreaterThanOrEqual(3024);
    expect(mandatory.maxHeight).toBeGreaterThanOrEqual(1964);

    // Re-framed to the real AR at the 1080 height cap → 1662×1080, not 1920×1080.
    expect(startRecordingCompositor).toHaveBeenCalledWith(
      expect.anything(),
      { width: 1662, height: 1080 },
      null,
      expect.any(Number),
    );
  });

  it("crops a recording area on the compositor even when no resize or watermark is needed", async () => {
    // 1920×1080 display captured at 1920×1080: only the area makes the compositor run.
    await startEngine(
      baseOptions({
        area: {
          displayId: 1,
          rect: { x: 320, y: 180, width: 1280, height: 720 },
          displaySize: { width: 1920, height: 1080 },
        },
      }),
    );
    expect(startRecordingCompositor).toHaveBeenCalledWith(
      expect.anything(),
      { width: 1280, height: 720 },
      null,
      expect.any(Number),
      { x: 320, y: 180, width: 1280, height: 720 },
    );
  });

  it("sizes and crops from the delivered frames when the track reports the capture ceiling", async () => {
    // Chromium reported the 7680×4320 maxWidth/maxHeight ceiling while the frames were the
    // MacBook's 3024×1964: the take came out 2560×1440 with the area at 5× its real offset.
    screenVideoTrack.getSettings = vi.fn(() => ({ width: 7680, height: 4320 }));
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(3024);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(1964);

    await startEngine(
      baseOptions({
        area: {
          displayId: 1,
          rect: { x: 100, y: 50, width: 1000, height: 600 },
          displaySize: { width: 1512, height: 982 },
        },
      }),
    );
    expect(startRecordingCompositor).toHaveBeenCalledWith(
      expect.anything(),
      { width: 1800, height: 1080 },
      null,
      expect.any(Number),
      { x: 200, y: 100, width: 2000, height: 1200 },
    );
  });

  it("frames a full display from the delivered frames, not the reported ceiling", async () => {
    screenVideoTrack.getSettings = vi.fn(() => ({ width: 7680, height: 4320 }));
    vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(3024);
    vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(1964);

    await startEngine(baseOptions());
    expect(startRecordingCompositor).toHaveBeenCalledWith(
      expect.anything(),
      { width: 1662, height: 1080 },
      null,
      expect.any(Number),
    );
  });

  it("encodes the raw track on a real 16:9 screen (no compositor)", async () => {
    // Default fake screen is 1920×1080 → target equals source → no re-frame.
    await startEngine(baseOptions());
    expect(startRecordingCompositor).not.toHaveBeenCalled();
  });

  it("mixes microphone and system audio into a single AAC track", async () => {
    await startEngine(baseOptions({ microphoneDeviceId: "mic-1", systemAudio: true }));

    // Two getUserMedia calls: screen (with system audio) + microphone.
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    const micConstraints = getUserMedia.mock.calls[1][0] as {
      audio: { deviceId: { ideal: string } };
    };
    expect(micConstraints.audio.deviceId.ideal).toBe("mic-1");
    expect(MediaStreamAudioTrackSource).toHaveBeenCalled();
    expect(lastOutput().addAudioTrack).toHaveBeenCalled();
  });

  it("opens the microphone alongside the screen, not after it", async () => {
    let releaseScreen: () => void = () => {};
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      if (!constraints.video) return fakeStream([], [micTrack]);
      await new Promise<void>((resolve) => (releaseScreen = resolve));
      return fakeStream([screenVideoTrack], [screenSystemAudioTrack]);
    });

    const starting = startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
    // The screen request is still open, and the mic was already asked for.
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect((getUserMedia.mock.calls[0][0] as MediaStreamConstraints).video).toBeTruthy();
    releaseScreen();
    await starting;
    expect(gains[0]?.gain.value).toBe(1);
  });

  it("releases the microphone when the screen cannot be captured", async () => {
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      if (constraints.video) throw new Error("NotAllowedError");
      return fakeStream([], [micTrack]);
    });

    await expect(startEngine(baseOptions({ microphoneDeviceId: "mic-1" }))).rejects.toThrow(
      "NotAllowedError",
    );
    await vi.waitFor(() => expect(micTrack.stop).toHaveBeenCalled());
  });

  it("starts without waiting for the poster frame, and stop collects it", async () => {
    let played: () => void = () => {};
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(
      () => new Promise<void>((resolve) => (played = resolve)),
    );

    const handle = await startEngine(baseOptions());
    expect(lastOutput().start).toHaveBeenCalled();
    let settled = false;
    void handle.thumbnail.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    played();
    await handle.stop();
    expect(settled).toBe(true);
    expect(screenVideoTrack.stop).toHaveBeenCalled();
  });

  it("keeps recording when the microphone cannot be opened", async () => {
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      if (constraints.video) return fakeStream([screenVideoTrack], []);
      throw new Error("NotAllowedError"); // mic denied
    });

    // Should resolve (not throw) and still produce a video track.
    const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
    expect(handle).toBeTruthy();
    expect(lastOutput().addVideoTrack).toHaveBeenCalled();
  });

  it("falls back to a video-only recording when system-audio capture is rejected (macOS)", async () => {
    // macOS rejects `getUserMedia({audio:{mandatory:{chromeMediaSource:'desktop'}}})`,
    // which previously failed the WHOLE recording. Now the bundled audio+video call
    // is attempted first, then retried video-only.
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      if (constraints.video && constraints.audio) throw new Error("NotSupportedError");
      if (constraints.video) return fakeStream([screenVideoTrack], []);
      return fakeStream([], [micTrack]);
    });

    const handle = await startEngine(baseOptions({ systemAudio: true }));

    expect(handle).toBeTruthy(); // recording still starts
    expect(handle.hasSystemAudio).toBe(false);
    const calls = getUserMedia.mock.calls.map((c) => c[0] as MediaStreamConstraints);
    // It attempted the bundled desktop audio+video call...
    expect(calls.some((c) => Boolean(c.video) && Boolean(c.audio))).toBe(true);
    // ...then fell back to video-only after it rejected.
    expect(calls.some((c) => Boolean(c.video) && !c.audio)).toBe(true);
    expect(lastOutput().addVideoTrack).toHaveBeenCalled();
  });

  it("forwards each encoded chunk to onChunk with its byte position", async () => {
    const onChunk = vi.fn();
    await startEngine(baseOptions({ onChunk }));

    // The engine handed mediabunny a WritableStream via StreamTarget; drive it.
    // Module-level mocks accumulate calls across tests, so take this run's (last).
    const writable = vi.mocked(StreamTarget).mock.calls.at(-1)![0] as WritableStream;
    const writer = writable.getWriter();
    await writer.write({ data: new Uint8Array([1, 2, 3]), position: 42 } as never);

    expect(onChunk).toHaveBeenCalledTimes(1);
    const [data, position] = onChunk.mock.calls[0];
    expect(new Uint8Array(data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(position).toBe(42);
  });

  it("stops encoding as soon as stop is requested, not after the poster frame wait", async () => {
    // A poster frame that never comes must not keep the encoder running past the stop.
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(
      () => new Promise<void>(() => {}),
    );
    const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
    const videoSource = vi.mocked(MediaStreamVideoTrackSource).mock.results.at(-1)!.value;
    const audioSource = vi.mocked(MediaStreamAudioTrackSource).mock.results.at(-1)!.value;

    const stopping = handle.stop();
    expect(videoSource.pause).toHaveBeenCalled();
    expect(audioSource.pause).toHaveBeenCalled();
    expect(lastOutput().finalize).not.toHaveBeenCalled(); // still waiting for the poster (1 s)
    await stopping;
    expect(lastOutput().finalize).toHaveBeenCalled();
  });

  it("releases every device and closes the audio context on stop", async () => {
    const handle = await startEngine(
      baseOptions({ microphoneDeviceId: "mic-1", systemAudio: true }),
    );

    await handle.stop();

    expect(lastOutput().finalize).toHaveBeenCalled();
    expect(screenVideoTrack.stop).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(destinationTrack.stop).toHaveBeenCalled();
    expect(audioContextClose).toHaveBeenCalled();
  });

  it("pauses and resumes both the video and audio sources", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));

    const videoSource = vi.mocked(MediaStreamVideoTrackSource).mock.results.at(-1)!.value;
    const audioSource = vi.mocked(MediaStreamAudioTrackSource).mock.results.at(-1)!.value;

    handle.pause();
    expect(videoSource.pause).toHaveBeenCalled();
    expect(audioSource.pause).toHaveBeenCalled();

    handle.resume();
    expect(videoSource.resume).toHaveBeenCalled();
    expect(audioSource.resume).toHaveBeenCalled();
  });

  it("reports five microphone level bars", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
    expect(handle.readLevels()).toHaveLength(5);
  });

  it("never buffers the recording in memory (fastStart: 'in-memory' would OOM long recordings)", async () => {
    await startEngine(baseOptions());
    expect(vi.mocked(Mp4OutputFormat).mock.calls.at(-1)![0]).toEqual({ fastStart: false });
  });
});

describe("live controls", () => {
  it("routes each input through its own gain, starting from the settings", async () => {
    const handle = await startEngine(
      baseOptions({ microphoneDeviceId: "mic-1", systemAudio: false }),
    );
    // mic: level, mute (both unity); loopback: volume, duck (unity), mute (acquired, but off → 0).
    expect(gains.map((g) => g.gain.value)).toEqual([1, 1, 1, 1, 0]);
    expect(handle.hasSystemAudio).toBe(true);
  });

  it("acquires loopback even when system audio starts off", async () => {
    await startEngine(baseOptions({ systemAudio: false }));
    const first = getUserMedia.mock.calls[0][0] as MediaStreamConstraints;
    expect(first.video).toBeTruthy();
    expect(first.audio).toBeTruthy();
  });

  it("always adds an audio track, even with no input at all", async () => {
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      if (constraints.video && constraints.audio) throw new Error("NotSupportedError");
      return fakeStream([screenVideoTrack], []);
    });
    await startEngine(baseOptions({ microphoneDeviceId: null, systemAudio: false }));
    expect(gains).toHaveLength(0);
    expect(lastOutput().addAudioTrack).toHaveBeenCalledTimes(1);
  });

  it("mutes and unmutes the mic with a short ramp, keeping the device open", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
    const [micLevelGain, mic] = gains;

    expect(await handle.setMicrophoneEnabled(false, "mic-1")).toBe("ok");
    expect(await handle.setMicrophoneEnabled(true, "mic-1")).toBe("ok");

    expect(rampTargets(mic)).toEqual([0, 1]);
    expect(rampTargets(micLevelGain)).toEqual([]); // muting never touches the level
    // ~20 ms ramp from the context's current time (10 s in the fake).
    expect(mic.gain.linearRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(10.02);
    expect(micTrack.stop).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2); // screen + mic, no re-acquire
  });

  it("acquires the mic late when it was off at start, and releases it on stop", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: null }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const before = gains.length;

    expect(await handle.setMicrophoneEnabled(true, "mic-2")).toBe("ok");

    const micConstraints = getUserMedia.mock.calls[1][0] as {
      audio: { deviceId: { ideal: string } };
    };
    expect(micConstraints.audio.deviceId.ideal).toBe("mic-2");
    expect(gains).toHaveLength(before + 2); // level + mute
    expect(gains.at(-1)!.gain.value).toBe(1);

    await handle.stop();
    expect(micTrack.stop).toHaveBeenCalled();
  });

  it("answers unavailable when a late mic cannot be opened, and keeps the take", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: null }));
    getUserMedia.mockRejectedValueOnce(new Error("NotAllowedError"));

    expect(await handle.setMicrophoneEnabled(true, "mic-1")).toBe("unavailable");
    expect(await handle.setMicrophoneEnabled(true, null)).toBe("unavailable");
    expect(lastOutput().finalize).not.toHaveBeenCalled();
  });

  it("muting a mic that was never opened is a no-op", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: null }));
    expect(await handle.setMicrophoneEnabled(false, "mic-1")).toBe("ok");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("ramps the system-audio gain", async () => {
    const handle = await startEngine(baseOptions({ systemAudio: true }));
    const [volume, duck, sys] = gains;
    expect(sys.gain.value).toBe(1);

    expect(handle.setSystemAudioEnabled(false)).toBe("ok");
    expect(handle.setSystemAudioEnabled(true)).toBe("ok");
    expect(rampTargets(sys)).toEqual([0, 1]);
    expect(rampTargets(volume)).toEqual([]);
    expect(rampTargets(duck)).toEqual([]);
  });

  it("answers unavailable for system audio when there is no loopback track", async () => {
    getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      if (constraints.video && constraints.audio) throw new Error("NotSupportedError");
      if (constraints.video) return fakeStream([screenVideoTrack], []);
      return fakeStream([], [micTrack]);
    });
    const handle = await startEngine(baseOptions({ systemAudio: true }));
    expect(handle.setSystemAudioEnabled(true)).toBe("unavailable");
  });

  it("answers unavailable after stop", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: null, systemAudio: true }));
    await handle.stop();
    expect(handle.setSystemAudioEnabled(false)).toBe("unavailable");
    expect(await handle.setMicrophoneEnabled(true, "mic-1")).toBe("unavailable");
  });
});

describe("audio settings", () => {
  const audio = (
    over: Partial<typeof DEFAULT_AUDIO_SETTINGS> = {},
  ): typeof DEFAULT_AUDIO_SETTINGS => ({
    ...DEFAULT_AUDIO_SETTINGS,
    ...over,
  });

  it("asks for noise suppression in the mic constraints, at start and for a late mic", async () => {
    await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
    expect(getUserMedia.mock.calls[1][0]).toEqual({
      audio: { deviceId: { ideal: "mic-1" }, noiseSuppression: true },
    });

    const handle = await startEngine(
      baseOptions({ microphoneDeviceId: null, audio: audio({ noiseSuppression: false }) }),
    );
    getUserMedia.mockClear();
    await handle.setMicrophoneEnabled(true, "mic-2");
    expect(getUserMedia.mock.calls[0][0]).toEqual({
      audio: { deviceId: { ideal: "mic-2" }, noiseSuppression: false },
    });
  });

  it("starts the mic and system gains from the settings", async () => {
    await startEngine(
      baseOptions({
        microphoneDeviceId: "mic-1",
        systemAudio: true,
        audio: audio({ micLevel: 150, systemAudioVolume: 40 }),
      }),
    );
    // mic level, mic mute, system volume, duck, system mute.
    expect(gains.map((g) => g.gain.value)).toEqual([1.5, 1, 0.4, 1, 1]);
  });

  it("setMicLevel ramps only the level gain, and a late mic starts from it", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
    handle.setMicLevel(70);
    handle.setMicLevel(900); // clamped to 200
    expect(rampTargets(gains[0])).toEqual([0.7, 2]);
    expect(rampTargets(gains[1])).toEqual([]);

    const late = await startEngine(baseOptions({ microphoneDeviceId: null }));
    late.setMicLevel(50);
    const before = gains.length;
    await late.setMicrophoneEnabled(true, "mic-1");
    expect(gains[before].gain.value).toBe(0.5);
  });

  describe("setNoiseSuppression", () => {
    /** Audio-only getUserMedia calls hand out these tracks in order, then fail if told to. */
    function micFactory(): {
      tracks: ReturnType<typeof fakeTrack>[];
      fail: { next: boolean };
    } {
      const tracks: ReturnType<typeof fakeTrack>[] = [];
      const fail = { next: false };
      getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
        if (constraints.video) {
          return fakeStream([screenVideoTrack], constraints.audio ? [screenSystemAudioTrack] : []);
        }
        if (fail.next) {
          fail.next = false;
          throw new Error("NotReadableError");
        }
        const track = fakeTrack();
        track.getSettings = vi.fn(() => ({ deviceId: "real-mic" }) as never);
        tracks.push(track);
        return fakeStream([], [track]);
      });
      return { tracks, fail };
    }
    const micCalls = (): MediaStreamConstraints[] =>
      getUserMedia.mock.calls.map((c) => c[0] as MediaStreamConstraints).filter((c) => !c.video);

    it("reopens the same device with the new setting instead of reconfiguring the live track", async () => {
      const { tracks } = micFactory();
      const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
      expect(await handle.setNoiseSuppression(false)).toBe("ok");

      expect(micCalls().at(-1)).toEqual({
        audio: { deviceId: { exact: "real-mic" }, noiseSuppression: false },
      });
      expect(tracks[0]!.applyConstraints).not.toHaveBeenCalled();
      // The new source feeds the same level gain and the same analyser as the old one.
      const oldSource = sources[0];
      const newSource = sources.at(-1);
      expect(newSource!.connect).toHaveBeenCalledWith(gains[0]);
      expect(newSource!.connect).toHaveBeenCalledWith(analysers[0]);
      // The old one is gone only after the new one was connected.
      expect(oldSource!.disconnect).toHaveBeenCalled();
      expect(tracks[0]!.stop).toHaveBeenCalled();
      expect(tracks[1]!.stop).not.toHaveBeenCalled();
    });

    it("releases the reopened mic on stop, and not the replaced one twice", async () => {
      const { tracks } = micFactory();
      const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
      await handle.setNoiseSuppression(false);
      await handle.stop();
      expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
      expect(tracks[1]!.stop).toHaveBeenCalledTimes(1);
    });

    it("keeps the old source and answers unavailable when the device cannot be reopened", async () => {
      const { tracks, fail } = micFactory();
      const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
      fail.next = true;
      expect(await handle.setNoiseSuppression(false)).toBe("unavailable");
      expect(tracks[0]!.stop).not.toHaveBeenCalled();
      expect(sources.every((s) => s.disconnect.mock.calls.length === 0)).toBe(true);
      // The old mic is still the live one: a later reopen works from it.
      expect(await handle.setNoiseSuppression(false)).toBe("ok");
    });

    it("serializes concurrent calls: the second waits for the first, and the last request wins", async () => {
      const { tracks } = micFactory();
      const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
      const open = getUserMedia.getMockImplementation()!;
      let release: () => void = () => {};
      getUserMedia.mockImplementationOnce(async (constraints: MediaStreamConstraints) => {
        await new Promise<void>((resolve) => (release = resolve));
        return (open as (c: MediaStreamConstraints) => Promise<MediaStream>)(constraints);
      });
      const first = handle.setNoiseSuppression(false);
      await Promise.resolve();
      await Promise.resolve();
      const second = handle.setNoiseSuppression(true);
      await Promise.resolve();
      // The second has not opened anything while the first is still opening.
      expect(micCalls()).toHaveLength(2);
      release();
      expect(await Promise.all([first, second])).toEqual(["ok", "ok"]);
      expect(
        micCalls()
          .slice(1)
          .map((c) => (c.audio as { noiseSuppression: boolean }).noiseSuppression),
      ).toEqual([false, true]);
      // Two reopens: the first replacement is released, the last one stays live.
      expect(tracks).toHaveLength(3);
      expect(tracks[0]!.stop).toHaveBeenCalled();
      expect(tracks[1]!.stop).toHaveBeenCalled();
      expect(tracks[2]!.stop).not.toHaveBeenCalled();
    });

    it("does not reopen when the setting already is the one in effect", async () => {
      micFactory();
      const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
      const before = getUserMedia.mock.calls.length;
      expect(await handle.setNoiseSuppression(true)).toBe("ok");
      expect(getUserMedia.mock.calls.length).toBe(before);
    });

    it("applies to a mic acquired later when none is open now", async () => {
      micFactory();
      const handle = await startEngine(baseOptions({ microphoneDeviceId: null }));
      expect(await handle.setNoiseSuppression(false)).toBe("ok");
      await handle.setMicrophoneEnabled(true, "mic-2");
      expect(micCalls().at(-1)).toEqual({
        audio: { deviceId: { ideal: "mic-2" }, noiseSuppression: false },
      });
    });

    it("answers unavailable after stop", async () => {
      micFactory();
      const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
      await handle.stop();
      expect(await handle.setNoiseSuppression(false)).toBe("unavailable");
    });
  });

  it("setSystemAudioVolume ramps only the volume gain; unavailable without loopback", async () => {
    const handle = await startEngine(baseOptions({ systemAudio: true }));
    expect(handle.setSystemAudioVolume(25)).toBe("ok");
    const [volume, duck, mute] = gains;
    expect(rampTargets(volume)).toEqual([0.25]);
    expect(rampTargets(duck)).toEqual([]);
    expect(rampTargets(mute)).toEqual([]);

    getUserMedia.mockImplementation(async () => fakeStream([screenVideoTrack], []));
    const bare = await startEngine(baseOptions());
    expect(bare.setSystemAudioVolume(10)).toBe("unavailable");
    expect(bare.setDucking(true)).toBe("unavailable");
  });

  describe("ducking", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const ducking = async (over: Partial<EngineOptions> = {}) => {
      const handle = await startEngine(
        baseOptions({
          microphoneDeviceId: "mic-1",
          systemAudio: true,
          audio: audio({ duckSystemAudioWhileTalking: true }),
          ...over,
        }),
      );
      const duck = gains[3];
      return { handle, duck };
    };

    it("ducks the system audio to 0.3 when the mic hears a voice, then restores it", async () => {
      const { duck } = await ducking();
      analysers[0].level = bytesForDbfs(-20);
      await vi.advanceTimersByTimeAsync(50);
      expect(rampTargets(duck)).toEqual([0.3]);
      expect(duck.gain.linearRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(10.08);

      analysers[0].level = 128;
      await vi.advanceTimersByTimeAsync(500);
      expect(rampTargets(duck)).toEqual([0.3, 1]);
    });

    it("does nothing while the mic stays quiet", async () => {
      const { duck } = await ducking();
      await vi.advanceTimersByTimeAsync(1000);
      expect(rampTargets(duck)).toEqual([]);
    });

    it("never ducks for a muted mic", async () => {
      const { handle, duck } = await ducking();
      await handle.setMicrophoneEnabled(false, "mic-1");
      analysers[0].level = bytesForDbfs(-20);
      await vi.advanceTimersByTimeAsync(500);
      expect(rampTargets(duck)).toEqual([]);
    });

    it("does not run unless enabled, and setDucking(true) starts it", async () => {
      const { handle, duck } = await ducking({ audio: audio() });
      analysers[0].level = bytesForDbfs(-20);
      await vi.advanceTimersByTimeAsync(200);
      expect(rampTargets(duck)).toEqual([]);

      expect(handle.setDucking(true)).toBe("ok");
      await vi.advanceTimersByTimeAsync(50);
      expect(rampTargets(duck)).toEqual([0.3]);
    });

    it("setDucking(false) stops the loop and restores full volume", async () => {
      const { handle, duck } = await ducking();
      analysers[0].level = bytesForDbfs(-20);
      await vi.advanceTimersByTimeAsync(50);
      handle.setDucking(false);
      expect(rampTargets(duck)).toEqual([0.3, 1]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(rampTargets(duck)).toEqual([0.3, 1]); // no further changes
    });

    it("clears the loop on stop", async () => {
      const { handle } = await ducking();
      const stopping = handle.stop();
      await vi.advanceTimersByTimeAsync(1500);
      await stopping;
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("readMicLevels", () => {
    it("is five zeros while no mic is open", async () => {
      const handle = await startEngine(baseOptions({ microphoneDeviceId: null }));
      expect(handle.readMicLevels()).toEqual([0, 0, 0, 0, 0]);
    });

    it("reads five bars from the mic-only analyser, not the mix", async () => {
      const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
      const [mic, mix] = analysers;
      mic.level = bytesForDbfs(-12);
      mix.level = 128;
      const bars = handle.readMicLevels();
      expect(bars).toHaveLength(5);
      expect(bars.every((bar) => bar > 0)).toBe(true);
      expect(handle.readLevels().every((bar) => bar === 0)).toBe(true);
    });

    it("keeps reading while the mic is muted (the meter shows what the device hears)", async () => {
      const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
      await handle.setMicrophoneEnabled(false, "mic-1");
      analysers[0].level = bytesForDbfs(-12);
      expect(handle.readMicLevels().some((bar) => bar > 0)).toBe(true);
    });
  });
});

describe("mic analyser tap point", () => {
  it("taps the raw device signal before the level gain, so the level never moves the meter or the ducking", async () => {
    const handle = await startEngine(baseOptions({ microphoneDeviceId: "mic-1" }));
    const micSource = sources[0]!;
    const [levelGain, muteGain] = gains;
    expect(micSource.connect).toHaveBeenCalledWith(analysers[0]);
    expect(micSource.connect).toHaveBeenCalledWith(levelGain);
    expect(levelGain!.connect).not.toHaveBeenCalledWith(analysers[0]);
    expect(levelGain!.connect).toHaveBeenCalledWith(muteGain);
    handle.setMicLevel(200);
  });
});

describe("a start that fails after the audio is wired", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const failingStart = (): void => {
    vi.mocked(Output).mockImplementationOnce(function () {
      return {
        addVideoTrack: vi.fn(),
        addAudioTrack: vi.fn(),
        start: vi.fn(async () => {
          throw new Error("encoder refused");
        }),
        finalize: vi.fn(async () => {}),
      } as never;
    });
  };

  it("clears the ducking loop, closes the context and stops every track before rethrowing", async () => {
    failingStart();
    await expect(
      startEngine(
        baseOptions({
          microphoneDeviceId: "mic-1",
          systemAudio: true,
          audio: { ...DEFAULT_AUDIO_SETTINGS, duckSystemAudioWhileTalking: true },
        }),
      ),
    ).rejects.toThrow("encoder refused");

    expect(vi.getTimerCount()).toBe(0);
    expect(audioContextClose).toHaveBeenCalled();
    expect(micTrack.stop).toHaveBeenCalled();
    expect(screenVideoTrack.stop).toHaveBeenCalled();
    expect(screenSystemAudioTrack.stop).toHaveBeenCalled();
    expect(destinationTrack.stop).toHaveBeenCalled();
  });

  it("does not start ducking before the output has started", async () => {
    let release: () => void = () => {};
    vi.mocked(Output).mockImplementationOnce(function () {
      return {
        addVideoTrack: vi.fn(),
        addAudioTrack: vi.fn(),
        start: vi.fn(() => new Promise<void>((resolve) => (release = resolve))),
        finalize: vi.fn(async () => {}),
      } as never;
    });
    const starting = startEngine(
      baseOptions({
        microphoneDeviceId: "mic-1",
        systemAudio: true,
        audio: { ...DEFAULT_AUDIO_SETTINGS, duckSystemAudioWhileTalking: true },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await starting;
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("releases the compositor too", async () => {
    failingStart();
    const stop = vi.fn();
    vi.mocked(startRecordingCompositor).mockResolvedValueOnce({
      track: { stop: vi.fn() },
      stop,
    } as never);
    screenVideoTrack.getSettings = vi.fn(() => ({ width: 3024, height: 1964 }));
    await expect(startEngine(baseOptions())).rejects.toThrow("encoder refused");
    expect(stop).toHaveBeenCalled();
  });
});
