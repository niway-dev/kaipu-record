import { describe, expect, it, vi } from "vitest";
import { exportClipFrames, type ClipFrame } from "./export-clip-frames";
import type { RenderClipSegment } from "./export-plan";
import { createFrameRateCap } from "./frame-rate-cap";
import {
  clipFramesOf,
  clipSource,
  clipWebcamCursorOf,
  offsetWebcamCursor,
  shiftFrames,
  type JoinedClipRef,
} from "./joined-media";
import type { WebcamCursor } from "./webcam-lockstep";

async function* gen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}
const collect = async <T>(it: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of it) out.push(item);
  return out;
};

const clip = (
  sourceId: string | null,
  start: number,
  end: number,
  at: number,
): RenderClipSegment => ({
  kind: "clip",
  timelineStart: at,
  duration: end - start,
  sourceStart: start,
  sourceEnd: end,
  sourceId,
});

const JOINED: JoinedClipRef[] = [{ sourceId: "b", offset: 3600 }];

describe("shiftFrames", () => {
  it("adds the offset to every timestamp and keeps the canvas and the duration", async () => {
    const canvas = { tag: "c" } as unknown as CanvasImageSource;
    const shifted = await collect(
      shiftFrames(gen([{ canvas, timestamp: 1.5, duration: 0.25 }]), 3600),
    );
    expect(shifted).toEqual([{ canvas, timestamp: 3601.5, duration: 0.25 }]);
    expect(shifted[0]!.canvas).toBe(canvas);
  });
});

describe("offsetWebcamCursor", () => {
  it("asks the inner cursor in local seconds when the caller asks in axis seconds", async () => {
    const frameAt = vi.fn(async (t: number) => `face@${t}`);
    const close = vi.fn(async () => {});
    const cursor = offsetWebcamCursor<string>({ frameAt, close }, 3600);
    expect(await cursor.frameAt(3602.5)).toBe("face@2.5");
    expect(frameAt).toHaveBeenCalledWith(2.5);
    await cursor.close();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("clipSource", () => {
  it("reads an opened clip at its own seconds without a shift", () => {
    expect(clipSource(clip(null, 50, 60, 10), JOINED)).toEqual({
      key: null,
      localStart: 50,
      localEnd: 60,
      offset: 0,
    });
  });

  it("reads a joined clip in its own file's seconds and remembers the offset", () => {
    expect(clipSource(clip("b", 3600, 3610, 10), JOINED)).toEqual({
      key: "b",
      localStart: 0,
      localEnd: 10,
      offset: 3600,
    });
  });

  it("throws for a joined clip whose recording was not sent", () => {
    expect(() => clipSource(clip("zz", 3600, 3610, 10), JOINED)).toThrow(/zz/);
  });
});

describe("two recordings through the clip loop", () => {
  const plan = [clip(null, 0, 10, 0), clip("b", 3600, 3610, 10), clip(null, 50, 60, 20)];

  const sinks = () => {
    const calls: Array<{ key: string | null; start: number; end: number }> = [];
    const reader = (key: string | null) => ({
      canvases: (start: number, end: number) => {
        calls.push({ key, start, end });
        // One frame at the start of the requested (local) range.
        return gen<ClipFrame>([
          {
            canvas: { tag: `${key}@${start}` } as unknown as CanvasImageSource,
            timestamp: start,
            duration: 1,
          },
        ]);
      },
    });
    return {
      calls,
      readers: new Map([
        [null, reader(null)],
        ["b", reader("b")],
      ]),
    };
  };

  it("decodes each recording's own file at its own local range, in plan order", async () => {
    const { calls, readers } = sinks();
    for (const segment of plan) {
      const src = clipSource(segment, JOINED);
      await collect(clipFramesOf(src, readers));
    }
    expect(calls).toEqual([
      { key: null, start: 0, end: 10 },
      { key: "b", start: 0, end: 10 },
      { key: null, start: 50, end: 60 },
    ]);
  });

  it("composes a joined clip's frames at axis seconds and the output at its timeline slot", async () => {
    const { readers } = sinks();
    const segment = plan[1]!;
    const composed = vi.fn();
    await exportClipFrames({
      segment,
      frames: clipFramesOf(clipSource(segment, JOINED), readers),
      webcamCursor: null,
      layer: null,
      webcamImageOf: () => null,
      fillFps: 30,
      cap: createFrameRateCap(null),
      minFrameGap: 0,
      prevOutTs: null,
      compose: { clip: composed },
      emit: async () => {},
    });
    expect(composed).toHaveBeenCalledOnce();
    const [, sourceTs, , outTs] = composed.mock.calls[0]!;
    expect(sourceTs).toBe(3600);
    expect(outTs).toBe(10);
  });

  it("asks a joined recording's webcam in local seconds and an opened one's untouched", async () => {
    const asked: Array<{ key: string | null; start: number; end: number; t?: number }> = [];
    const source = (key: string | null) => ({
      cursorFor(start: number, end: number): WebcamCursor<string> {
        return {
          frameAt: async (t) => {
            asked.push({ key, start, end, t });
            return "face";
          },
          close: async () => {},
        };
      },
    });
    const webcams = new Map([
      [null, source(null)],
      ["b", source("b")],
    ]);
    const segment = plan[1]!;
    const cursor = clipWebcamCursorOf(clipSource(segment, JOINED), webcams)!;
    await cursor.frameAt(3603);
    const opened = clipWebcamCursorOf(clipSource(plan[2]!, JOINED), webcams)!;
    await opened.frameAt(52);
    expect(asked).toEqual([
      { key: "b", start: 0, end: 10, t: 3 },
      { key: null, start: 50, end: 60, t: 52 },
    ]);
  });

  it("makes the same decode call as before for a scene without joins", async () => {
    const { calls, readers } = sinks();
    const only = [clip(null, 0, 10, 0), clip(null, 50, 60, 10)];
    for (const segment of only) {
      const frames = await collect(clipFramesOf(clipSource(segment, []), readers));
      // No shift: the decoder's own timestamps reach the loop.
      expect(frames.map((f) => f.timestamp)).toEqual([segment.sourceStart]);
    }
    expect(calls).toEqual([
      { key: null, start: 0, end: 10 },
      { key: null, start: 50, end: 60 },
    ]);
  });

  it("gives a joined clip no webcam when its recording has none", () => {
    const webcams = new Map([
      [null, { cursorFor: () => ({ frameAt: async () => "f", close: async () => {} }) }],
    ]);
    expect(clipWebcamCursorOf(clipSource(plan[1]!, JOINED), webcams)).toBeNull();
  });
});
