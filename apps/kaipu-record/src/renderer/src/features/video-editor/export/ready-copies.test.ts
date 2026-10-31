import { afterEach, describe, expect, it } from "vitest";
import {
  __resetReadyCopiesForTests,
  announceReadyCopies,
  dismissReadyCard,
  getReadyCopies,
  libraryBadgeCount,
  markCopySeen,
  noteFinishedCopy,
  readyCards,
  retireReadyCards,
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
    expect(getReadyCopies().copies).toEqual([{ assetId: "a", announced: false, card: true }]);
  });
});

describe("Ready to upload cards", () => {
  it("leads with each finished copy, newest first, with what the runner knew", () => {
    noteFinishedCopy("a", { destination: "youtube", width: 2560, height: 1440 });
    noteFinishedCopy("b");
    expect(readyCards(getReadyCopies()).map((c) => c.assetId)).toEqual(["b", "a"]);
    expect(readyCards(getReadyCopies())[1]).toMatchObject({ destination: "youtube", width: 2560 });
  });

  it("closing a card keeps the copy unseen; leaving the Library retires every card", () => {
    noteFinishedCopy("a");
    noteFinishedCopy("b");
    dismissReadyCard("a");
    expect(readyCards(getReadyCopies()).map((c) => c.assetId)).toEqual(["b"]);
    expect([...unseenCopyIds(getReadyCopies())]).toEqual(["a", "b"]);
    retireReadyCards();
    expect(readyCards(getReadyCopies())).toEqual([]);
    const after = getReadyCopies();
    retireReadyCards();
    dismissReadyCard("a");
    expect(getReadyCopies()).toBe(after);
  });

  it("opening the copy removes its card", () => {
    noteFinishedCopy("a");
    markCopySeen("a");
    expect(readyCards(getReadyCopies())).toEqual([]);
  });
});
