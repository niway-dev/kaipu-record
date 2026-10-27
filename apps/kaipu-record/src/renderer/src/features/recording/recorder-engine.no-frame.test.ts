import { afterEach, describe, expect, it, vi } from "vitest";

// The real compositor (not mocked, unlike recorder-engine.test.tsx): its own `play()` is
// what hung a MacBook take, where it always runs to downscale the Retina frame.
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
  MediaStreamVideoTrackSource: vi.fn(),
  MediaStreamAudioTrackSource: vi.fn(),
}));

import { startEngine } from "./recorder-engine";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("startEngine — a capture that never delivers a frame", () => {
  it("fails the start and releases the screen instead of hanging", async () => {
    vi.useFakeTimers();
    // A Retina display: 3024×1964 is downscaled to 1080p, so the compositor runs.
    const track = {
      stop: vi.fn(),
      addEventListener: vi.fn(),
      getSettings: () => ({ width: 3024, height: 1964 }),
    };
    const stream = {
      getVideoTracks: () => [track],
      getAudioTracks: () => [],
      getTracks: () => [track],
    };
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
    vi.stubGlobal(
      "MediaStream",
      class {
        constructor(public tracks: unknown[]) {}
      },
    );
    // jsdom's play() never settles — exactly a track with no first frame.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

    let outcome: "pending" | "resolved" | "rejected" = "pending";
    void startEngine({
      sourceId: "screen:1:0",
      microphoneDeviceId: null,
      systemAudio: false,
      height: 1080,
      onChunk: vi.fn(),
    }).then(
      () => (outcome = "resolved"),
      () => (outcome = "rejected"),
    );
    await vi.advanceTimersByTimeAsync(10_000);

    expect(outcome).toBe("rejected");
    expect(track.stop).toHaveBeenCalled();
  });
});
