import { afterEach, describe, expect, it } from "vitest";
import {
  __resetReadyCopiesForTests,
  announceReadyCopies,
  getReadyCopies,
  libraryBadgeCount,
  markCopySeen,
  noteFinishedCopy,
  unseenCopyIds,
} from "./ready-copies";

afterEach(() => __resetReadyCopiesForTests());

describe("ready copies (NIW2-586)", () => {
  it("counts finished copies on the rail, except the one whose ready card is on screen", () => {
    noteFinishedCopy("a");
    noteFinishedCopy("b");
    expect(libraryBadgeCount(getReadyCopies(), null)).toBe(2);
    expect(libraryBadgeCount(getReadyCopies(), "b")).toBe(1);
  });

  it("opening the Library clears the badge but keeps the copies pointed at until opened", () => {
    noteFinishedCopy("a");
    announceReadyCopies();
    expect(libraryBadgeCount(getReadyCopies(), null)).toBe(0);
    expect([...unseenCopyIds(getReadyCopies())]).toEqual(["a"]);
    // A copy that finishes afterwards counts again.
    noteFinishedCopy("b");
    expect(libraryBadgeCount(getReadyCopies(), null)).toBe(1);
  });

  it("opening a copy forgets it; an unknown id changes nothing", () => {
    noteFinishedCopy("a");
    noteFinishedCopy("b");
    const before = getReadyCopies();
    markCopySeen("zzz");
    expect(getReadyCopies()).toBe(before);
    markCopySeen("a");
    expect([...unseenCopyIds(getReadyCopies())]).toEqual(["b"]);
  });

  it("announcing twice does not notify again", () => {
    noteFinishedCopy("a");
    announceReadyCopies();
    const after = getReadyCopies();
    announceReadyCopies();
    expect(getReadyCopies()).toBe(after);
  });

  it("the same copy noted twice counts once", () => {
    noteFinishedCopy("a");
    announceReadyCopies();
    noteFinishedCopy("a");
    expect(getReadyCopies().copies).toEqual([{ assetId: "a", announced: false }]);
  });
});
