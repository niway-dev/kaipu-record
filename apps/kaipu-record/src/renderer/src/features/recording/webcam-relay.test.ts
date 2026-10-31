import { describe, expect, it, vi } from "vitest";
import { createWebcamRelay, type WebcamRelayGlobals } from "./webcam-relay";

/** A camera whose frames the test pushes, read through a fake track processor. */
interface FakeCamera {
  track: MediaStreamTrack;
  push(frame: FakeFrame): void;
  end(): void;
}
interface FakeFrame {
  id: string;
  close: ReturnType<typeof vi.fn>;
}
const frame = (id: string): FakeFrame => ({ id, close: vi.fn() });

function fakes() {
  const cameras = new Map<MediaStreamTrack, ReadableStreamDefaultController<FakeFrame>>();
  const written: string[] = [];
  const generatorStop = vi.fn();
  const env: WebcamRelayGlobals = {
    MediaStreamTrackProcessor: vi.fn(function (init: { track: MediaStreamTrack }) {
      return {
        readable: new ReadableStream<FakeFrame>({
          start: (controller) => void cameras.set(init.track, controller),
        }),
      };
    }) as never,
    MediaStreamTrackGenerator: vi.fn(function () {
      return {
        kind: "video",
        stop: generatorStop,
        writable: new WritableStream<FakeFrame>({ write: (f) => void written.push(f.id) }),
      };
    }) as never,
  };
  const camera = (): FakeCamera => {
    const track = {} as MediaStreamTrack;
    return {
      track,
      push: (f) => cameras.get(track)!.enqueue(f),
      end: () => cameras.get(track)!.close(),
    };
  };
  return { env, camera, written, generatorStop };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createWebcamRelay", () => {
  it("is null where Chromium has no track processor or generator", () => {
    expect(createWebcamRelay({})).toBeNull();
    expect(
      createWebcamRelay({ MediaStreamTrackProcessor: fakes().env.MediaStreamTrackProcessor }),
    ).toBeNull();
  });

  it("copies the camera's frames into one track, and resolves feed on the first frame", async () => {
    const { env, camera, written } = fakes();
    const relay = createWebcamRelay(env)!;
    const cam = camera();
    const fed = relay.feed(cam.track);
    cam.push(frame("a1"));
    await expect(fed).resolves.toBe(true);
    cam.push(frame("a2"));
    await flush();
    expect(written).toEqual(["a1", "a2"]);
  });

  it("switches cameras on the same relay track: a cut camera's frames never get through", async () => {
    const { env, camera, written } = fakes();
    const relay = createWebcamRelay(env)!;
    const track = relay.track;
    const first = camera();
    void relay.feed(first.track);
    first.push(frame("a1"));
    await flush();
    relay.cut(); // the camera turned off
    const late = frame("a2");
    // A frame the old camera still delivers is dropped (and closed), not relayed.
    try {
      first.push(late);
    } catch {
      // the cut already cancelled its stream
    }
    await flush();
    const second = camera();
    const fed = relay.feed(second.track);
    second.push(frame("b1"));
    await expect(fed).resolves.toBe(true);
    expect(written).toEqual(["a1", "b1"]);
    expect(relay.track).toBe(track);
  });

  it("feed resolves false when the camera ends before its first frame", async () => {
    const { env, camera } = fakes();
    const relay = createWebcamRelay(env)!;
    const cam = camera();
    const fed = relay.feed(cam.track);
    cam.end();
    await expect(fed).resolves.toBe(false);
  });

  it("stop ends the relay track, and a later feed is refused", async () => {
    const { env, camera, generatorStop } = fakes();
    const relay = createWebcamRelay(env)!;
    relay.stop();
    relay.stop();
    expect(generatorStop).toHaveBeenCalledOnce();
    await expect(relay.feed(camera().track)).resolves.toBe(false);
  });
});
