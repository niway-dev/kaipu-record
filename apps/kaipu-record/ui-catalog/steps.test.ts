import { describe, expect, it } from "vitest";
import { describeStep, WINDOW_SIZES, WINDOW_SIZE_OF_PRESET, wheelTurns } from "./types";
import { WINDOW_PRESETS } from "../src/shared/window-size";

describe("the wheel step", () => {
  it("turns once by default and as many times as asked", () => {
    expect(wheelTurns({ deltaY: 120 })).toEqual([[0, 120]]);
    expect(wheelTurns({ deltaX: 600, deltaY: 300, times: 3 })).toEqual([
      [600, 300],
      [600, 300],
      [600, 300],
    ]);
  });

  it("rejects a step that would not move anything", () => {
    expect(() => wheelTurns({})).toThrow(/deltaX or a deltaY/);
    expect(() => wheelTurns({ deltaX: 0, deltaY: 0 })).toThrow(/deltaX or a deltaY/);
  });

  it("rejects a turn count that is not a whole number of at least 1", () => {
    expect(() => wheelTurns({ deltaY: 10, times: 0 })).toThrow(/at least 1/);
    expect(() => wheelTurns({ deltaY: 10, times: 1.5 })).toThrow(/at least 1/);
  });

  it("reads as a sentence in the README", () => {
    expect(
      describeStep({ wheel: { area: "editorImage.canvas" }, deltaX: 600, deltaY: 600, times: 6 }),
    ).toBe("Turn the wheel over `editorImage.canvas` by (600, 600) px, 6 times");
    expect(describeStep({ wheel: { area: "editorImage.canvas" }, deltaY: 100 })).toBe(
      "Turn the wheel over `editorImage.canvas` by (0, 100) px",
    );
  });
});

describe("window sizes", () => {
  it("derives the image editor's minimum from its preset, not a literal", () => {
    expect(WINDOW_SIZES["editor-image-min"]).toEqual({
      width: WINDOW_PRESETS.editorImage.minWidth,
      height: WINDOW_PRESETS.editorImage.minHeight,
    });
    expect(WINDOW_SIZES["editor-image-min"]).toEqual({ width: 720, height: 560 });
  });

  it("opens an image at the editor's size", () => {
    expect(WINDOW_SIZES[WINDOW_SIZE_OF_PRESET.editorImage]).toEqual(WINDOW_SIZES.editor);
  });
});

describe("the at point of a hover and a click", () => {
  it("names the point as percentages of the target's box", () => {
    expect(describeStep({ hover: { area: "editorImage.canvas" }, at: { x: 0.97, y: 0.95 } })).toBe(
      "Hover `editorImage.canvas` at (97%, 95%)",
    );
    expect(describeStep({ click: { area: "editorImage.canvas" }, at: { x: 0.25, y: 0.5 } })).toBe(
      "Click `editorImage.canvas` at (25%, 50%)",
    );
  });

  it("says a double-click is one", () => {
    expect(
      describeStep({ click: { area: "editorImage.canvas" }, at: { x: 0.5, y: 0.5 }, double: true }),
    ).toBe("Double-click `editorImage.canvas` at (50%, 50%)");
  });

  it("says nothing extra without a point", () => {
    expect(describeStep({ hover: { area: "editorImage.canvas" } })).toBe(
      "Hover `editorImage.canvas`",
    );
  });
});
