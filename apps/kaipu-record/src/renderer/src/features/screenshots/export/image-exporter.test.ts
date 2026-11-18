import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scene } from "../annotations/scene";

const compositeSceneAt = vi.fn();
vi.mock("../annotations/compositor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../annotations/compositor")>()),
  compositeSceneAt: (...args: unknown[]) => compositeSceneAt(...args),
  compositeScene: async (...args: unknown[]) => (await compositeSceneAt(...args)).png,
}));
const encodeImage = vi.fn();
vi.mock("./image-encoder", () => ({ encodeImage: (...a: unknown[]) => encodeImage(...a) }));

const { clearExportCache } = await import("./index");
const { exportImage } = await import("./image-exporter");
const { DEFAULT_EXPORT_SETTINGS, settingsForPreset } = await import("./image-export-settings");

const scene: Scene = {
  beautify: { bg: "none", padding: 0, radius: 0, shadow: 0 },
  annotations: [],
};
const bytes = new Uint8Array([1, 2, 3]).buffer;
const input = { scene, bytes, displayedW: 100, canvas: true as const, assets: {} };

afterEach(() => {
  compositeSceneAt.mockReset();
  encodeImage.mockReset();
  clearExportCache();
});

describe("exportImage", () => {
  it("uses the one compositor, in canvas mode, so redactions are baked like Save's", async () => {
    compositeSceneAt.mockResolvedValue({ png: bytes, width: 100, height: 50, scale: 1 });
    encodeImage.mockResolvedValue({ bytes, width: 100, height: 50 });
    await exportImage(settingsForPreset("web"), { w: 100, h: 50 }, input);
    expect(compositeSceneAt).toHaveBeenCalledTimes(1);
    expect(compositeSceneAt).toHaveBeenCalledWith(scene, bytes, 100, { canvas: true, assets: {} });
  });

  it("asks for a 2× raster only when the scale is 2×", async () => {
    compositeSceneAt.mockResolvedValue({ png: bytes, width: 100, height: 50, scale: 2 });
    encodeImage.mockResolvedValue({ bytes, width: 200, height: 100 });
    const out = await exportImage(
      { ...DEFAULT_EXPORT_SETTINGS, scale: 2 },
      { w: 100, h: 50 },
      input,
    );
    expect(compositeSceneAt).toHaveBeenCalledWith(scene, bytes, 100, {
      canvas: true,
      assets: {},
      rasterScale: 2,
    });
    expect(out.plan).toMatchObject({ width: 200, height: 100, rasterScale: 2 });
  });

  it("encodes with the plan and returns it", async () => {
    compositeSceneAt.mockResolvedValue({ png: bytes, width: 100, height: 50, scale: 1 });
    encodeImage.mockResolvedValue({ bytes, width: 100, height: 50 });
    const out = await exportImage(settingsForPreset("small"), { w: 100, h: 50 }, input);
    expect(encodeImage).toHaveBeenCalledWith(
      bytes,
      expect.objectContaining({ mimeType: "image/jpeg", flatten: true }),
    );
    expect(out.plan.extension).toBe("jpg");
  });

  it("shares the 1× composite across estimates and the export (the memo)", async () => {
    compositeSceneAt.mockResolvedValue({ png: bytes, width: 100, height: 50, scale: 1 });
    encodeImage.mockResolvedValue({ bytes, width: 100, height: 50 });
    await exportImage(settingsForPreset("web"), { w: 100, h: 50 }, input);
    await exportImage(settingsForPreset("small"), { w: 100, h: 50 }, input);
    await exportImage({ ...DEFAULT_EXPORT_SETTINGS, scale: 0.5 }, { w: 100, h: 50 }, input);
    expect(compositeSceneAt).toHaveBeenCalledTimes(1);
  });
});
