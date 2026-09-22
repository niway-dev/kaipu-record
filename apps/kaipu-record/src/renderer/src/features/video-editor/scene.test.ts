import { describe, expect, it } from "vitest";
import { initialScene, newId } from "./scene";

describe("initialScene", () => {
  it("creates a single clip covering the whole recording", () => {
    const scene = initialScene(92.5);
    expect(scene.overlays).toEqual([]);
    expect(scene.items).toHaveLength(1);
    const clip = scene.items[0];
    expect(clip.kind).toBe("clip");
    expect(clip).toMatchObject({ sourceStart: 0, sourceEnd: 92.5 });
  });

  it("generates unique ids", () => {
    expect(newId()).not.toBe(newId());
  });
});

describe("initialScene — v2 fields", () => {
  it("starts with no zooms, no redactions and the default sensitivity", () => {
    const scene = initialScene(10);
    expect(scene.zoomSegments).toEqual([]);
    expect(scene.redactions).toEqual([]);
    expect(scene.zoomSensitivity).toBe(55);
  });
});
