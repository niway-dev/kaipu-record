import { describe, expect, it } from "vitest";
import { joinedSource } from "../media-switch.fixture";
import type { RenderClipSegment, RenderSegment } from "./export-plan";
import { localRange, recordingOfClip, recordingsUsed } from "./export-recordings";

const B = joinedSource("b", 3600, 40);
const C = joinedSource("c", 7200, 20);
const sources = [B, C];

const seg = (
  sourceId: string | null,
  sourceStart: number,
  sourceEnd: number,
): RenderClipSegment => ({
  kind: "clip",
  timelineStart: 0,
  duration: sourceEnd - sourceStart,
  sourceStart,
  sourceEnd,
  sourceId,
});

describe("recordingOfClip", () => {
  it("gives the opened recording (null) to a range outside every joined one", () => {
    expect(recordingOfClip(sources, 0, 10)).toBeNull();
    expect(recordingOfClip(sources, 50, 60)).toBeNull();
  });

  it("gives a joined recording's id to a range inside it", () => {
    expect(recordingOfClip(sources, 3600, 3610)).toBe("b");
    expect(recordingOfClip(sources, 7205, 7210)).toBe("c");
  });

  it("keeps a clip that ends exactly at the end of a joined range in it", () => {
    expect(recordingOfClip(sources, 3630, 3640)).toBe("b");
  });

  it("gives the opened recording to everything when there are no joined ones", () => {
    expect(recordingOfClip(undefined, 3600, 3610)).toBeNull();
    expect(recordingOfClip([], 0, 10)).toBeNull();
  });

  it("throws, naming the clip, when it starts in a joined range and ends outside it", () => {
    expect(() => recordingOfClip(sources, 3630, 3650, "clip-x")).toThrow(/clip-x/);
  });

  it("throws when it starts outside a joined range and ends inside it", () => {
    expect(() => recordingOfClip(sources, 3590, 3610, "clip-y")).toThrow(/clip-y/);
  });
});

describe("recordingsUsed", () => {
  it("lists distinct recordings in first-use order", () => {
    const plan = { segments: [seg(null, 0, 10), seg("b", 3600, 3610), seg(null, 50, 60)] };
    expect(recordingsUsed(plan)).toEqual([null, "b"]);
  });

  it("lists a joined recording that comes first before the opened one", () => {
    const plan = { segments: [seg("b", 3600, 3610), seg(null, 0, 10), seg("b", 3620, 3630)] };
    expect(recordingsUsed(plan)).toEqual(["b", null]);
  });

  it("does not list a joined source whose clips were all deleted, and skips slides", () => {
    const plan = {
      segments: [
        { kind: "slide", timelineStart: 0, duration: 2, assetId: "s" } as RenderSegment,
        seg(null, 0, 10),
      ],
    };
    expect(recordingsUsed(plan)).toEqual([null]);
  });
});

describe("localRange", () => {
  it("subtracts the joined recording's offset", () => {
    expect(localRange(seg("b", 3600, 3610), sources)).toEqual({ start: 0, end: 10 });
    expect(localRange(seg("c", 7205, 7210), sources)).toEqual({ start: 5, end: 10 });
  });

  it("leaves the opened recording's range unchanged", () => {
    expect(localRange(seg(null, 50, 60), sources)).toEqual({ start: 50, end: 60 });
  });

  it("throws for an id that is not among the sources", () => {
    expect(() => localRange(seg("gone", 3600, 3610), sources)).toThrow(/gone/);
  });
});
