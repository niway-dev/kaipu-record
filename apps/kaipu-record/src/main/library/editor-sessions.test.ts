import { EventEmitter } from "node:events";
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

  describe("watch: a window's lifecycle releases its holds", () => {
    /** The slice of WebContents the registry listens to, as a plain emitter. */
    const fakeWindow = (id: number) => Object.assign(new EventEmitter(), { id });

    it.each([
      ["crashes (render-process-gone)", (w: EventEmitter) => w.emit("render-process-gone", {}, {})],
      ["is destroyed", (w: EventEmitter) => w.emit("destroyed")],
      [
        "reloads (main-frame navigation)",
        (w: EventEmitter) =>
          w.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false }),
      ],
    ])("releases everything and invalidates queued requests when the window %s", (_l, go) => {
      const sessions = new EditorSessions();
      const window = fakeWindow(3);
      sessions.watch(window);
      sessions.open(3, "clip", "asset-1");
      const queued = sessions.generation(3);
      go(window);
      expect(sessions.isOpen("clip", "asset-1")).toBe(false);
      expect(sessions.openIfCurrent(3, queued, "clip", "asset-1")).toBe(false);
    });

    it("keeps holds across in-page (same-document) navigation", () => {
      const sessions = new EditorSessions();
      const window = fakeWindow(4);
      sessions.watch(window);
      sessions.open(4, "clip", "asset-1");
      window.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
      expect(sessions.isOpen("clip", "asset-1")).toBe(true);
    });

    it("subscribes once per window", () => {
      const sessions = new EditorSessions();
      const window = fakeWindow(5);
      sessions.watch(window);
      sessions.watch(window);
      expect(window.listenerCount("render-process-gone")).toBe(1);
      expect(window.listenerCount("did-start-navigation")).toBe(1);
    });
  });
});
