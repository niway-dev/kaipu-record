import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Output } from "mediabunny";
import { DEFAULT_AUDIO_SETTINGS } from "@shared/audio-settings";
import type { LocalRecording } from "@shared/types";

// The REAL engine and the REAL store, with a scripted native helper (frames ending with
// `end`) and mocked media plumbing: a window closing must reach an automatic, finalized save.

vi.mock("./recording-compositor", () => ({
  startRecordingCompositor: vi.fn(async () => ({ track: { stop: vi.fn() }, stop: vi.fn() })),
}));
vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn() }));
vi.mock("mediabunny", () => ({
  EncodedPacket: vi.fn(function (...args) {
    return { args };
  }),
  EncodedVideoPacketSource: vi.fn(function () {
    return { add: vi.fn(async () => {}), close: vi.fn() };
  }),
  Output: vi.fn(function () {
    return {
      addVideoTrack: vi.fn(),
      addAudioTrack: vi.fn(),
      start: vi.fn(async () => {}),
      finalize: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      _firstMediaStreamTimestamp: null,
    };
  }),
  StreamTarget: vi.fn(),
  Mp4OutputFormat: vi.fn(),
  MediaStreamVideoTrackSource: vi.fn(function () {
    return {
      pause: vi.fn(),
      resume: vi.fn(),
      close: vi.fn(),
      errorPromise: new Promise(() => {}),
    };
  }),
  MediaStreamAudioTrackSource: vi.fn(function () {
    return { pause: vi.fn(), resume: vi.fn(), errorPromise: new Promise(() => {}) };
  }),
}));

let reportError: typeof import("@renderer/features/analytics").reportError;

const RECORDING: LocalRecording = {
  id: "recording-x",
  assetId: "00000000-0000-0000-0000-000000000001",
  title: "T",
  filePath: "/vault/recording-x.mp4",
  createdAt: 1,
  sizeBytes: 10,
  durationSeconds: 5,
  thumbnailUrl: null,
  kind: "recording",
  derivedFromAssetId: null,
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
  contentSha256: null,
};

// The store registers listeners at import time: the bridge must be in place first.
window.electronAPI.onRecordingCommand = vi.fn(() => () => {});
window.electronAPI.onSettingsChanged = vi.fn(() => () => {});
let store: typeof import("./recorder-store");

const track = () => ({
  stop: vi.fn(),
  addEventListener: vi.fn(),
  getSettings: vi.fn(() => ({ width: 1280, height: 720 })),
  applyConstraints: vi.fn(async () => {}),
});
const stream = (video: unknown[], audio: unknown[]) =>
  ({
    getVideoTracks: () => video,
    getAudioTracks: () => audio,
    getTracks: () => [...video, ...audio],
  }) as unknown as MediaStream;

/** The native helper, scripted: config, one packet, then it waits until the window "closes". */
function scriptedHelper() {
  let closeWindow!: () => void;
  const closed = new Promise<void>((resolve) => {
    closeWindow = resolve;
  });
  let mainEnded = false;
  let releaseStop!: () => void;
  const stopGate = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  let gateStop = false;
  let step = 0;
  const bridge = {
    capability: vi.fn(async () => ({
      transportAvailable: true,
      recordingReady: false as const,
      reason: "experimental",
    })),
    open: vi.fn(async () => {}),
    begin: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    // Like main: a stop that arrives after the end was handed out (no reader) is a no-op.
    stop: vi.fn(async () => {
      if (gateStop) await stopGate;
      if (mainEnded) return;
      closeWindow();
    }),
    next: vi.fn(async () => {
      step++;
      if (step === 1)
        return {
          header: {
            kind: "config" as const,
            version: 1 as const,
            codec: "avc1.64001f",
            width: 1280,
            height: 720,
            epochUs: 1000,
            epochMainMs: performance.now(),
            cursorPixels: "excluded" as const,
          },
          payload: new Uint8Array([1, 100, 0, 31, 255, 225, 0, 1, 103, 1, 0, 1, 104]),
        };
      if (step === 2)
        return {
          header: { kind: "packet" as const, ptsUs: 0, durationUs: 1000000, keyframe: true },
          payload: new Uint8Array([0, 0, 0, 1, 5]),
        };
      if (step === 3) {
        await closed;
        mainEnded = true;
        return { header: { kind: "end" as const, endUs: 1000000 }, payload: new Uint8Array() };
      }
      return null;
    }),
  };
  return {
    bridge,
    /** The helper ends the take: the window closed. */
    close: () => closeWindow(),
    /** Hold the renderer's stop request in flight until `releaseStop` (the IPC is slow). */
    holdStop: () => {
      gateStop = true;
    },
    releaseStop: () => releaseStop(),
  };
}

const input = {
  sourceId: "window:55:0",
  sourceName: "Window",
  microphoneDeviceId: null,
  systemAudio: false,
  audio: DEFAULT_AUDIO_SETTINGS,
  width: 1280,
  height: 720,
};

let OutputRef: typeof Output;
let outputs: Array<{ start: ReturnType<typeof vi.fn>; finalize: ReturnType<typeof vi.fn> }>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Each case gets its own store (and module instances): one failure cannot cascade.
  vi.resetModules();
  store = await import("./recorder-store");
  reportError = (await import("@renderer/features/analytics")).reportError;
  const { Output: OutputMock } = await import("mediabunny");
  OutputRef = OutputMock;
  const screenTrack = track();
  vi.stubGlobal("AudioContext", function () {
    return {
      createMediaStreamDestination: () => ({ stream: stream([], [track()]) }),
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createGain: () => ({
        gain: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }),
      createAnalyser: () => ({ connect: vi.fn(), getByteTimeDomainData: vi.fn() }),
      currentTime: 10,
      close: vi.fn(async () => {}),
    };
  });
  vi.stubGlobal(
    "MediaStream",
    class {
      constructor(public tracks: unknown[]) {}
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn(async (c: MediaStreamConstraints) =>
        c.video && !("mandatory" in (c.video as object))
          ? stream([track()], [])
          : c.video
            ? stream([screenTrack], [])
            : stream([], [track()]),
      ),
    },
    configurable: true,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  window.electronAPI.recordingCreate = vi.fn(async () => ({ tempPath: "/tmp/s" }));
  window.electronAPI.recordingStart = vi.fn();
  window.electronAPI.recordingStop = vi.fn();
  window.electronAPI.recordingWrite = vi.fn();
  window.electronAPI.recordingFinalize = vi.fn(async () => RECORDING);
  window.electronAPI.recordingAbort = vi.fn(async () => {});
  window.electronAPI.recordingReportTick = vi.fn();
  window.electronAPI.waitForCountdownVisible = vi.fn(async () => {});
  window.electronAPI.recordingHideMainWindow = vi.fn(async () => false);
  window.electronAPI.reportRecordTiming = vi.fn();
  window.electronAPI.cursorTrackStart = vi.fn(async () => ({ enabled: true }));
  outputs = [];
  const make = vi.mocked(OutputRef).getMockImplementation()!;
  vi.mocked(OutputRef).mockImplementation(function (...args) {
    const out = Reflect.construct(make, args);
    outputs.push(out);
    return out;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startTake(helper: ReturnType<typeof scriptedHelper>, withWebcam = false) {
  window.electronAPI.nativeCapture = helper.bridge;
  store.requestStartRecording(() => ({
    ...input,
    ...(withWebcam
      ? {
          webcam: {
            deviceId: "cam",
            lines: 720,
            bubble: { x: 0, y: 0, size: 0.2 } as never,
          },
        }
      : {}),
  }));
  await vi.advanceTimersByTimeAsync(3000);
}

const settle = () => vi.advanceTimersByTimeAsync(1000);
const idle = { status: "idle", countdown: null };

describe("a native window take whose window closes", () => {
  it("(a) mid-take: the take is finalized and saved without any user action", async () => {
    const helper = scriptedHelper();
    await startTake(helper);
    expect(store.getRecorderSnapshot().status).toBe("recording");

    helper.close();
    await settle();

    expect(store.getRecorderSnapshot()).toEqual(idle);
    expect(outputs[0]!.finalize).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
    expect(helper.bridge.stop).not.toHaveBeenCalled();
  });

  it("(b) while the webcam's startup is pending: it is saved once the take has begun", async () => {
    const helper = scriptedHelper();
    let startWebcam!: () => void;
    const make = vi.mocked(OutputRef).getMockImplementation()!;
    let created = 0;
    vi.mocked(OutputRef).mockImplementation(function (...args) {
      const out = Reflect.construct(make, args);
      if (++created === 2)
        out.start = vi.fn(() => new Promise<void>((resolve) => (startWebcam = resolve)));
      outputs.push(out);
      return out;
    });
    await startTake(helper, true);
    expect(store.getRecorderSnapshot().status).not.toBe("recording"); // still starting

    helper.close();
    await settle();
    expect(store.getRecorderSnapshot().status).not.toBe("recording");
    startWebcam();
    // The webcam file never gets a first frame here: its start time is given up on.
    await vi.advanceTimersByTimeAsync(15_000);

    expect(store.getRecorderSnapshot()).toEqual(idle);
    expect(outputs[0]!.finalize).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("(c) while paused: it is finalized and saved", async () => {
    const helper = scriptedHelper();
    await startTake(helper);
    store.pauseRecording();
    await settle();
    expect(store.getRecorderSnapshot().status).toBe("paused");

    helper.close();
    await settle();

    expect(store.getRecorderSnapshot()).toEqual(idle);
    expect(outputs[0]!.finalize).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("(d) a user Stop racing the close: main no-ops the late stop, the take is still saved", async () => {
    const helper = scriptedHelper();
    await startTake(helper);

    // The user's Stop leaves the renderer first, but its IPC is slow: the helper's end is
    // processed by main (no reader left) before the stop reaches it, so main no-ops the stop.
    helper.holdStop();
    store.stopOrCancelRecording();
    await vi.advanceTimersByTimeAsync(500);
    helper.close();
    await vi.advanceTimersByTimeAsync(500);
    helper.releaseStop();
    await settle();

    expect(store.getRecorderSnapshot()).toEqual(idle);
    expect(outputs[0]!.finalize).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingFinalize).toHaveBeenCalledOnce();
    expect(helper.bridge.stop).toHaveBeenCalledOnce();
    expect(window.electronAPI.recordingAbort).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });
});
