import { describe, expect, it } from "vitest";
import { EditorSessions } from "./editor-sessions";

describe("EditorSessions", () => {
  it("knows an item is open in the editor by its id or its assetId until released", () => {
    const sessions = new EditorSessions();
    sessions.open(1, "clip", "asset-1");
    expect(sessions.isOpen("clip", "other")).toBe(true);
    expect(sessions.isOpen("renamed", "asset-1")).toBe(true);
    expect(sessions.isOpen("else", "asset-2")).toBe(false);
    sessions.close(1, "clip");
    expect(sessions.isOpen("clip", "asset-1")).toBe(false);
  });

  it("counts two windows on the same item separately", () => {
    const sessions = new EditorSessions();
    sessions.open(1, "clip", "asset-1");
    sessions.open(2, "clip", "asset-1");
    sessions.close(1, "clip");
    expect(sessions.isOpen("clip", "asset-1")).toBe(true);
    sessions.close(2, "clip");
    expect(sessions.isOpen("clip", "asset-1")).toBe(false);
  });

  it("releases everything a window held when it goes away (crash, close)", () => {
    const sessions = new EditorSessions();
    sessions.open(1, "a", "asset-a");
    sessions.open(1, "b", "asset-b");
    sessions.open(2, "c", "asset-c");
    sessions.releaseOwner(1);
    expect(sessions.isOpen("a", "asset-a")).toBe(false);
    expect(sessions.isOpen("b", "asset-b")).toBe(false);
    expect(sessions.isOpen("c", "asset-c")).toBe(true);
  });

  it("ignores a close it never saw", () => {
    const sessions = new EditorSessions();
    sessions.close(1, "ghost");
    sessions.releaseOwner(9);
    expect(sessions.isOpen("ghost", "x")).toBe(false);
  });

  it("refuses a hold whose owner went away (closed, reloaded) after the request arrived", () => {
    const sessions = new EditorSessions();
    const generation = sessions.generation(1);
    sessions.releaseOwner(1); // the window navigated or was destroyed while the request waited
    expect(sessions.openIfCurrent(1, generation, "clip", "asset-1")).toBe(false);
    expect(sessions.isOpen("clip", "asset-1")).toBe(false);
    // A request issued after the release is current again.
    expect(sessions.openIfCurrent(1, sessions.generation(1), "clip", "asset-1")).toBe(true);
    expect(sessions.isOpen("clip", "asset-1")).toBe(true);
  });
});
