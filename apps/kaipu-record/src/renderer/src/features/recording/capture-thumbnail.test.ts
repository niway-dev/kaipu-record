import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("mediabunny", () => ({}));
vi.mock("./frame-size", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./frame-size")>()),
  playWithin: vi.fn(async () => {}),
}));

import { captureThumbnail } from "./recorder-engine";

afterEach(() => vi.restoreAllMocks());

function stubCanvas() {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) =>
    cb(new Blob([new Uint8Array([1])])),
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  return drawImage;
}

describe("captureThumbnail", () => {
  it("draws the whole frame when there is no source rect", async () => {
    const drawImage = stubCanvas();
    await captureThumbnail({} as MediaStream, { width: 640, height: 360 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 360);
  });

  it("draws only the source rect, scaled to the target, with the nine-argument form", async () => {
    const drawImage = stubCanvas();
    await captureThumbnail(
      {} as MediaStream,
      { width: 640, height: 360 },
      { x: 640, y: 360, width: 1280, height: 720 },
    );
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 640, 360, 1280, 720, 0, 0, 640, 360);
  });
});
