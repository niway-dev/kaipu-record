import { describe, expect, it } from "vitest";
import type { ClipRecordings } from "./clip-recordings";
import { laneFileInputs, screenFileMap, webcamFileMap } from "./filmstrip-lanes";
import type { LayoutEntry } from "./timeline";

const clip = (itemId: string, over: Partial<LayoutEntry> = {}): LayoutEntry => ({
  itemId,
  kind: "clip",
  timelineStart: 0,
  timelineEnd: 10,
  sourceStart: 0,
  sourceEnd: 10,
  ...over,
});

const screen = (sourceId: string | null, url: string, duration = 100) => ({
  sourceId,
  url,
  duration,
  thumbnails: [{ sourceTime: 5, url: `blob:${url}` }],
});

describe("laneFileInputs", () => {
  it("without joined recordings every clip belongs to the opened recording", () => {
    const layout = [
      clip("a"),
      clip("b", { timelineStart: 10, timelineEnd: 20, sourceStart: 40, sourceEnd: 50 }),
    ];
    const files = laneFileInputs({
      layout,
      clipRecordings: null,
      screen: [screen(null, "kaipu-media://rec")],
      webcam: [],
    });
    expect(files).toHaveLength(1);
    expect(files[0].entries.map((e) => e.itemId)).toEqual(["a", "b"]);
    expect(files[0].binding).toEqual({
      fileKey: "kaipu-media://rec",
      fileOffset: 0,
      legacyOffset: 0,
    });
  });

  it("splits clips by recording for joined recordings and uses each recording's offset (ADR 0058)", () => {
    const recordings: ClipRecordings = new Map([
      ["a", { sourceId: null, title: "A", status: "ready", hasWebcam: false, offset: 0 }],
      ["b", { sourceId: "j1", title: "B", status: "ready", hasWebcam: false, offset: 200 }],
    ]);
    const files = laneFileInputs({
      layout: [clip("a"), clip("b", { sourceStart: 205, sourceEnd: 215 })],
      clipRecordings: recordings,
      screen: [screen(null, "kaipu-media://one"), screen("j1", "kaipu-media://two", 50)],
      webcam: [],
    });
    expect(files.map((f) => [f.binding.fileKey, f.binding.fileOffset, f.entries.length])).toEqual([
      ["kaipu-media://one", 0, 1],
      ["kaipu-media://two", 200, 1],
    ]);
  });

  it("a recording whose clips were all cut is not requested", () => {
    const files = laneFileInputs({
      layout: [clip("a")],
      clipRecordings: new Map([
        ["a", { sourceId: null, title: "A", status: "ready", hasWebcam: false, offset: 0 }],
      ]),
      screen: [screen(null, "kaipu-media://one"), screen("gone", "kaipu-media://two")],
      webcam: [],
    });
    expect(files.map((f) => f.binding.fileKey)).toEqual(["kaipu-media://one"]);
  });

  it("AC2: a webcam file is read at its own time: recording offset plus its start offset", () => {
    const recordings: ClipRecordings = new Map([
      ["b", { sourceId: "j1", title: "B", status: "ready", hasWebcam: true, offset: 200 }],
    ]);
    const files = laneFileInputs({
      layout: [clip("b", { sourceStart: 205, sourceEnd: 215 })],
      clipRecordings: recordings,
      screen: [],
      webcam: [
        {
          sourceId: "j1",
          url: "kaipu-media://cam",
          companionOffset: 1.5,
          strip: {
            thumbnails: [{ sourceTime: 11.5, url: "blob:cam" }],
            covered: { start: 1.5, end: 61.5 },
          },
        },
      ],
    });
    expect(files).toHaveLength(1);
    expect(files[0].binding).toEqual({
      fileKey: "kaipu-media://cam",
      fileOffset: 201.5,
      legacyOffset: 1.5,
    });
    expect(files[0].duration).toBe(60); // the webcam file's own length, from its covered range
  });

  it("a webcam whose footage is not known yet has no duration, so it is not requested yet", () => {
    const files = laneFileInputs({
      layout: [clip("a")],
      clipRecordings: null,
      screen: [],
      webcam: [{ sourceId: null, url: "kaipu-media://cam", companionOffset: 0, strip: undefined }],
    });
    expect(Number.isNaN(files[0].duration)).toBe(true);
  });

  it("builds the lanes' file maps", () => {
    expect(screenFileMap([screen(null, "u1"), screen("j", "u2")])).toEqual(
      new Map([
        [null, "u1"],
        ["j", "u2"],
      ]),
    );
    expect(
      webcamFileMap([{ sourceId: null, url: "w", companionOffset: 2, strip: undefined }]).get(null),
    ).toEqual({ fileKey: "w", companionOffset: 2 });
  });
});
