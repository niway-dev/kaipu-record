import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Input } from "mediabunny";
import { generateThumbnail } from "@renderer/lib/generate-thumbnail";
import { healOrphanMetadata } from "./heal-orphan-metadata";

// mediabunny + the shared thumbnail primitive both need WebCodecs (absent in
// jsdom) — mock at the boundary so the test drives OUR probe logic: read duration,
// refuse to persist an unreadable 0, and pair it with a decoded poster.
vi.mock("mediabunny", () => ({
  ALL_FORMATS: [],
  BlobSource: vi.fn(),
  Input: vi.fn(),
}));
vi.mock("@renderer/lib/generate-thumbnail", () => ({
  generateThumbnail: vi.fn(async () => new Uint8Array([7, 7]).buffer),
}));

const InputMock = vi.mocked(Input);
const generateThumbnailMock = vi.mocked(generateThumbnail);

function stubDuration(seconds: number) {
  InputMock.mockImplementation(function () {
    return { computeDuration: async () => seconds };
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  generateThumbnailMock.mockResolvedValue(new Uint8Array([7, 7]).buffer);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["mp4"]) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("healOrphanMetadata", () => {
  it("returns floored duration + a decoded poster", async () => {
    stubDuration(54.7);

    const result = await healOrphanMetadata("orphan-1");

    expect(result).toEqual({ durationSeconds: 54, thumbnail: new Uint8Array([7, 7]).buffer });
    expect(global.fetch).toHaveBeenCalledWith("kaipu-media://recording/orphan-1");
  });

  it("returns null without persisting a bad 0 when the duration is unreadable", async () => {
    stubDuration(0);

    const result = await healOrphanMetadata("orphan-2");

    expect(result).toBeNull();
    // No point decoding a poster for a file whose duration we couldn't read.
    expect(generateThumbnailMock).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the file can't be opened", async () => {
    InputMock.mockImplementation(function () {
      throw new Error("undecodable");
    } as never);

    await expect(healOrphanMetadata("orphan-3")).resolves.toBeNull();
  });
});
