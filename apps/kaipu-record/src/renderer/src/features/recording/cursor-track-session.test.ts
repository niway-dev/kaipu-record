import { describe, expect, it } from "vitest";
import { beginCursorTrackSession, type CursorTrackApi } from "./cursor-track-session";

/**
 * Fully deterministic: the renderer clock only moves when the fake IPC moves it, and
 * every `cursorClockNow` round trip costs exactly 2 ms (1 ms each way), so the measured
 * offset is exactly `mainMinusRenderer`. No `performance.now()`, no tolerances.
 */
function fakeApi(enabled: boolean, mainMinusRenderer: number) {
  const calls: unknown[][] = [];
  let clock = 0;
  const now = (): number => clock;
  const api: CursorTrackApi = {
    cursorTrackStart: async () => ({ enabled }),
    cursorClockNow: async () => {
      clock += 1; // request in flight
      const mainNow = clock + mainMinusRenderer;
      clock += 1; // reply in flight
      return mainNow;
    },
    cursorTrackAnchor: (...args) => void calls.push(["anchor", ...args]),
    cursorTrackPause: (...args) => void calls.push(["pause", ...args]),
    cursorTrackResume: (...args) => void calls.push(["resume", ...args]),
  };
  return { api, calls, now };
}

describe("beginCursorTrackSession", () => {
  it("converts renderer times to main clock", async () => {
    const { api, calls, now } = fakeApi(true, 10_000);
    const session = await beginCursorTrackSession(api, "session-1", "screen:1:0", { now });
    session.anchor(100, "exact");
    session.pause(200);
    session.resume(300);
    expect(calls).toEqual([
      ["anchor", "session-1", 10_100, "exact"],
      ["pause", "session-1", 10_200],
      ["resume", "session-1", 10_300],
    ]);
  });

  it("is a no-op when main declines (window source, unknown display)", async () => {
    const { api, calls, now } = fakeApi(false, 0);
    const session = await beginCursorTrackSession(api, "s", "window:42:0", { now });
    session.anchor(1, "exact");
    session.pause(2);
    expect(calls).toEqual([]);
  });

  it("never throws when IPC fails", async () => {
    const { api, now } = fakeApi(true, 0);
    api.cursorTrackStart = async () => {
      throw new Error("no handler");
    };
    const session = await beginCursorTrackSession(api, "s", "screen:1:0", { now });
    expect(() => session.pause(1)).not.toThrow();
  });

  it("gives up when main never answers, instead of hanging the store", async () => {
    const { api, calls, now } = fakeApi(true, 0);
    // A handler blocked behind a permission dialog: the invoke never settles.
    api.cursorTrackStart = () => new Promise<{ enabled: boolean }>(() => {});
    const session = await beginCursorTrackSession(api, "s", "screen:1:0", {
      now,
      timeoutMs: 10,
    });
    session.anchor(1, "exact");
    session.pause(2);
    expect(calls).toEqual([]);
  });
});
