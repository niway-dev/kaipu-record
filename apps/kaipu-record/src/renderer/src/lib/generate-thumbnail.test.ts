import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSink, Input } from "mediabunny";
import { generateThumbnail } from "./generate-thumbnail";

// mediabunny decodes via WebCodecs, which jsdom lacks — mock it at the boundary so
// the test exercises OUR orchestration (open input → primary track → sink → first
// canvas → JPEG bytes) and its null/error branches, not the decoder itself.
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: vi.fn(),
  CanvasSink: vi.fn(),
  Input: vi.fn(),
}));

const InputMock = vi.mocked(Input);
const CanvasSinkMock = vi.mocked(CanvasSink);

function asyncIterableOf<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

/** A canvas whose toBlob yields the given JPEG bytes (or null to simulate encode failure). */
function fakeCanvas(bytes: Uint8Array | null) {
  return {
    toBlob: (cb: (blob: Blob | null) => void) =>
      cb(bytes ? new Blob([bytes as BlobPart], { type: "image/jpeg" }) : null),
  };
}

// mediabunny's Input/CanvasSink are constructed with `new`, so the mock
// implementation must be a regular (constructable) function, not an arrow.
function stubInput(track: unknown) {
  InputMock.mockImplementation(function () {
    return { getPrimaryVideoTrack: async () => track };
  } as never);
}

function stubSink(canvases: unknown[]) {
  CanvasSinkMock.mockImplementation(function () {
    return {
      canvasesAtTimestamps: () =>
        asyncIterableOf(canvases.map((canvas) => ({ canvas, timestamp: 0 }))),
    };
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateThumbnail", () => {
  it("returns JPEG bytes decoded from the first frame", async () => {
    stubInput({}); // a truthy video track
    stubSink([fakeCanvas(new Uint8Array([1, 2, 3]))]);

    const result = await generateThumbnail(new Blob(["mp4"]), 0);

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns null when the file has no video track", async () => {
    stubInput(null);

    const result = await generateThumbnail(new Blob(["mp4"]), 0);

    expect(result).toBeNull();
    expect(CanvasSinkMock).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when decoding fails", async () => {
    InputMock.mockImplementation(function () {
      throw new Error("undecodable");
    } as never);

    await expect(generateThumbnail(new Blob(["mp4"]), 0)).resolves.toBeNull();
  });
});
