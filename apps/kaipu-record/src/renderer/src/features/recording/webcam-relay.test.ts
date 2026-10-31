import { describe, expect, it, vi } from "vitest";
import { createWebcamRelay, type WebcamRelayGlobals } from "./webcam-relay";

/** A camera whose frames the test pushes, read through a fake track processor. */
interface FakeCamera {
  track: MediaStreamTrack;
  push(frame: FakeFrame): void;
  end(): void;
  /** The camera's stream errors: its next read fails. */
  fail(): void;
}
interface FakeFrame {
  id: string;
  close: ReturnType<typeof vi.fn>;
}
const frame = (id: string): FakeFrame => ({ id, close: vi.fn() });

function fakes({ failWriteAfter = Infinity }: { failWriteAfter?: number } = {}) {
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
        writable: new WritableStream<FakeFrame>({
          write: (f) => {
            if (written.length >= failWriteAfter) throw new Error("generator closed");
            written.push(f.id);
          },
        }),
      };
    }) as never,
  };
  const camera = (): FakeCamera => {
    const track = {} as MediaStreamTrack;
    return {
      track,
      push: (f) => cameras.get(track)!.enqueue(f),
      end: () => cameras.get(track)!.close(),
      fail: () => cameras.get(track)!.error(new Error("could not read")),
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

  it("reports a camera lost after its first frame: a read that fails", async () => {
    const { env, camera } = fakes();
    const relay = createWebcamRelay(env)!;
    const cam = camera();
    const onLost = vi.fn();
    const fed = relay.feed(cam.track, onLost);
    cam.push(frame("a1"));
    await expect(fed).resolves.toBe(true);
    cam.fail();
    await flush();
    expect(onLost).toHaveBeenCalledOnce();
  });

  it("reports a camera lost after its first frame: a write that fails", async () => {
    const { env, camera } = fakes({ failWriteAfter: 1 });
    const relay = createWebcamRelay(env)!;
    const cam = camera();
    const onLost = vi.fn();
    void relay.feed(cam.track, onLost);
    cam.push(frame("a1"));
    await flush();
    const unwritten = frame("a2");
    cam.push(unwritten);
    await flush();
    expect(onLost).toHaveBeenCalledOnce();
    expect(unwritten.close).toHaveBeenCalled();
  });

  it("reports a camera that ends after its first frame", async () => {
    const { env, camera } = fakes();
    const relay = createWebcamRelay(env)!;
    const cam = camera();
    const onLost = vi.fn();
    void relay.feed(cam.track, onLost);
    cam.push(frame("a1"));
    await flush();
    cam.end();
    await flush();
    expect(onLost).toHaveBeenCalledOnce();
  });

  it("never reports a camera it was told to leave: cut, a later feed, stop", async () => {
    const { env, camera } = fakes();
    const relay = createWebcamRelay(env)!;
    const onLost = vi.fn();
    for (const leave of [
      () => relay.cut(),
      () => void relay.feed(camera().track),
      () => relay.stop(),
    ]) {
      const cam = camera();
      void relay.feed(cam.track, onLost);
      cam.push(frame("x"));
      await flush();
      leave();
      await flush();
    }
    expect(onLost).not.toHaveBeenCalled();
  });

  it("does not report a camera lost before its first frame: feed resolves false instead", async () => {
    const { env, camera } = fakes();
    const relay = createWebcamRelay(env)!;
    const cam = camera();
    const onLost = vi.fn();
    const fed = relay.feed(cam.track, onLost);
    cam.fail();
    await expect(fed).resolves.toBe(false);
    expect(onLost).not.toHaveBeenCalled();
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
