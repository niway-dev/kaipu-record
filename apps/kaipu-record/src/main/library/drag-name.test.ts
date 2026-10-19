import { describe, expect, it } from "vitest";
import { friendlyDragName } from "./drag-name";

describe("friendlyDragName", () => {
  it("replaces path separators and reserved characters and keeps the title readable", () => {
    expect(friendlyDragName("Recording — 10/12/2026, 4:05:31 PM (10 MB)", ".mp4")).toBe(
      "Recording — 10-12-2026, 4-05-31 PM (10 MB).mp4",
    );
    expect(friendlyDragName('a\\b*c?d"e<f>g|h', ".gif")).toBe("a-b-c-d-e-f-g-h.gif");
  });

  it("replaces control characters", () => {
    expect(friendlyDragName("a\u0000b\u001fc\u007fd", ".mp4")).toBe("a-b-c-d.mp4");
  });

  it("collapses whitespace and trims spaces and dots from both ends", () => {
    expect(friendlyDragName("  ..My   demo \u00a0 clip..  ", ".mp4")).toBe("My demo clip.mp4");
  });

  it("falls back when nothing usable is left", () => {
    expect(friendlyDragName("", ".mp4")).toBe("Kaipu export.mp4");
    expect(friendlyDragName(" . .. ", ".gif")).toBe("Kaipu export.gif");
  });

  it("caps the base name at 180 characters", () => {
    const result = friendlyDragName("x".repeat(500), ".mp4");
    expect(result).toBe(`${"x".repeat(180)}.mp4`);
  });

  it("never splits a surrogate pair when capping", () => {
    const result = friendlyDragName("😀".repeat(200), ".mp4");
    expect(result).toBe(`${"😀".repeat(180)}.mp4`);
  });
});
