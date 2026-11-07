import { describe, expect, it } from "vitest";
import { PADDING_RANGE, RADIUS_RANGE, SHADOW_RANGE } from "../screenshots/beautify/backgrounds";
import { updateBackground } from "./background-edits";
import { initialScene } from "./scene";

describe("updateBackground", () => {
  const scene = initialScene(10);

  it("applies a preset and leaves the numbers alone", () => {
    const next = updateBackground(scene, { bg: "magenta" });
    expect(next.background).toEqual({ bg: "magenta", padding: 0, radius: 0, shadow: 0 });
  });

  it("applies a number and leaves the rest alone", () => {
    const withBg = updateBackground(scene, { bg: "ocean" });
    expect(updateBackground(withBg, { padding: 48 }).background).toEqual({
      bg: "ocean",
      padding: 48,
      radius: 0,
      shadow: 0,
    });
  });

  it("clamps to the screenshot editor's ranges", () => {
    expect(updateBackground(scene, { padding: 999 }).background!.padding).toBe(PADDING_RANGE.max);
    expect(updateBackground(scene, { radius: 999 }).background!.radius).toBe(RADIUS_RANGE.max);
    expect(updateBackground(scene, { shadow: -1 }).background!.shadow).toBe(SHADOW_RANGE.min);
  });

  it("returns the same scene when nothing changes, so there is no undo step", () => {
    expect(updateBackground(scene, { bg: "none" })).toBe(scene);
    expect(updateBackground(scene, {})).toBe(scene);
    const set = updateBackground(scene, { bg: "magenta", padding: 48 });
    expect(updateBackground(set, { bg: "magenta" })).toBe(set);
    expect(updateBackground(set, { padding: 48 })).toBe(set);
  });

  it("treats a scene saved before backgrounds as the default", () => {
    const { background: _background, ...legacy } = scene;
    expect(updateBackground(legacy, { bg: "none" })).toBe(legacy);
    expect(updateBackground(legacy, { bg: "dark" }).background!.bg).toBe("dark");
  });

  it("keeps the numbers when the preset goes back to none, and brings them back with a preset", () => {
    const set = updateBackground(scene, { bg: "magenta", padding: 48, radius: 16, shadow: 24 });
    const none = updateBackground(set, { bg: "none" });
    expect(none.background).toEqual({ bg: "none", padding: 48, radius: 16, shadow: 24 });
    expect(updateBackground(none, { bg: "ocean" }).background).toEqual({
      bg: "ocean",
      padding: 48,
      radius: 16,
      shadow: 24,
    });
  });

  it("does not touch the rest of the scene", () => {
    const next = updateBackground(scene, { bg: "magenta" });
    expect({ ...next, background: undefined }).toEqual({ ...scene, background: undefined });
  });
});
