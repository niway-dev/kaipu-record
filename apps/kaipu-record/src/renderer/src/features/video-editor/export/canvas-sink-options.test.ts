import { describe, expect, it } from "vitest";
import { EXPORT_CANVAS_POOL_SIZE, exportCanvasSinkOptions } from "./canvas-sink-options";

describe("exportCanvasSinkOptions", () => {
  it("pools the canvases", () => {
    const { poolSize } = exportCanvasSinkOptions(1920, 1080);
    expect(Number.isInteger(poolSize)).toBe(true);
    expect(poolSize).toBeGreaterThanOrEqual(1);
  });

  it("keeps the requested size and the letterbox fit", () => {
    expect(exportCanvasSinkOptions(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
      fit: "contain",
      poolSize: EXPORT_CANVAS_POOL_SIZE,
    });
  });
});
