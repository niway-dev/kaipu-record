import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MediaStreamAudioTrackSource,
  MediaStreamVideoTrackSource,
  Output,
  StreamTarget,
} from "mediabunny";
import { Mp4OutputFormat } from "mediabunny";
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
} {
  return { stop: vi.fn(), addEventListener: vi.fn(), getSettings: vi.fn(() => settings) };
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
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
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
    createAnalyser = vi.fn(() => ({
      fftSize: 0,
      smoothingTimeConstant: 0,
      getByteTimeDomainData: vi.fn(),
    }));
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
    // mic first (on), then loopback (acquired, but off → gain 0).
    expect(gains).toHaveLength(2);
    expect(gains[0].gain.value).toBe(1);
    expect(gains[1].gain.value).toBe(0);
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
    const mic = gains[0];

    expect(await handle.setMicrophoneEnabled(false, "mic-1")).toBe("ok");
    expect(await handle.setMicrophoneEnabled(true, "mic-1")).toBe("ok");

    expect(rampTargets(mic)).toEqual([0, 1]);
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
    expect(gains).toHaveLength(before + 1);
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
    const sys = gains[0];
    expect(sys.gain.value).toBe(1);

    expect(handle.setSystemAudioEnabled(false)).toBe("ok");
    expect(handle.setSystemAudioEnabled(true)).toBe("ok");
    expect(rampTargets(sys)).toEqual([0, 1]);
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
