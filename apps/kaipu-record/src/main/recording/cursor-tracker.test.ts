import { describe, expect, it } from "vitest";
import {
  type CapturedDisplay,
  CursorTrackRegistry,
  type CursorTrackerDeps,
} from "./cursor-tracker";

const DISPLAY: CapturedDisplay = {
  id: "7",
  bounds: { x: 1000, y: 0, width: 1000, height: 500 },
  scaleFactor: 2,
};

/** Manual clock + manual timer: `tick(ms)` advances time and fires the interval. */
function fakeDeps() {
  let clock = 0;
  let point = { x: 1500, y: 250 };
  let fn: (() => void) | null = null;
  let interval = 0;
  let last = 0;
  const deps: CursorTrackerDeps = {
    now: () => clock,
    cursorPoint: () => point,
    every: (ms, f) => {
      fn = f;
      interval = ms;
      last = clock;
      return () => {
        fn = null;
      };
    },
  };
  return {
    deps,
    move: (x: number, y: number) => {
      point = { x, y };
    },
    tick: (ms: number) => {
      const end = clock + ms;
      while (fn && last + interval <= end) {
        last += interval;
        clock = last;
        fn();
      }
      clock = end;
    },
    running: () => fn !== null,
  };
}

describe("CursorTrackRegistry", () => {
  it("samples, normalizes to the display and rebases at finish", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("session-1", DISPLAY);
    f.tick(80);
    tracker.setAnchor(40, "exact");
    f.move(1750, 125);
    f.tick(80);
    const track = reg.finish("session-1", false)!;
    expect(f.running()).toBe(false);
    expect(track.display).toEqual({ id: "7", width: 1000, height: 500, scaleFactor: 2 });
    expect(track.anchor).toBe("exact");
    expect(track.clicksAvailable).toBe(false);
    // Idle 0..80 → only [0, 80] kept; t=0 is before the anchor and is dropped.
    expect(track.t[0]).toBe(40); // main 80 − t0 40
    expect(track.x[0]).toBe(0.5);
    expect(track.t.at(-1)).toBe(120); // main 160 − 40 (trailing duplicate flushed)
    expect(track.x.at(-1)).toBe(0.75);
    expect(track.y.at(-1)).toBe(0.25);
  });

  it("removes paused time and drops paused samples", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("s", DISPLAY);
    tracker.setAnchor(0, "exact");
    f.tick(100);
    tracker.pause(100);
    f.move(1100, 100);
    f.tick(1000);
    tracker.resume(1100);
    f.move(1200, 100);
    f.tick(100);
    const track = reg.finish("s", true)!;
    expect(track.t.at(-1)).toBe(200); // 1200 − 1000 paused
    expect(track.x).not.toContain(0.1); // the position only seen while paused
  });

  it("closes an open pause at finish", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("s", DISPLAY);
    tracker.setAnchor(0, "estimated");
    f.tick(50);
    tracker.pause(50);
    f.tick(500);
    const track = reg.finish("s", true)!;
    expect(Math.max(...track.t)).toBeLessThanOrEqual(50);
  });

  it("cuts the tail sampled between the last frame and finalize", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("s", DISPLAY);
    tracker.setAnchor(0, "exact");
    f.tick(1000);
    f.move(1900, 400);
    f.tick(1000); // the "Saving…" dwell: still sampled, but no frame exists for it
    const track = reg.finish("s", true, 1000)!;
    expect(Math.max(...track.t)).toBeLessThanOrEqual(1000);
    expect(track.x).not.toContain(0.9);
  });

  it("records clicks at the poller position", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    const tracker = reg.start("s", DISPLAY);
    tracker.setAnchor(0, "exact");
    f.tick(16);
    f.move(1250, 375);
    tracker.addClick(0);
    const track = reg.finish("s", true)!;
    expect(track.clicks).toEqual([{ t: 16, x: 0.25, y: 0.75, button: 0 }]);
  });

  it("returns null without an anchor and for unknown sessions", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    reg.start("s", DISPLAY);
    f.tick(40);
    expect(reg.finish("s", true)).toBeNull();
    expect(reg.finish("nope", true)).toBeNull();
  });

  it("discardAll stops every tracker", () => {
    const f = fakeDeps();
    const reg = new CursorTrackRegistry(f.deps);
    reg.start("a", DISPLAY);
    expect(reg.active).toBe(true);
    reg.discardAll();
    expect(reg.active).toBe(false);
    expect(f.running()).toBe(false);
  });
});
