import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrepareRequests, type PrepareWindow } from "./prepare-windows";

class FakeWindow extends EventEmitter {
  destroyed = false;
  crashed = false;
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  readonly webContents = Object.assign(new EventEmitter(), {
    isCrashed: () => this.crashed,
    send: (channel: string, payload: unknown) => this.sent.push({ channel, payload }),
  });
  isDestroyed(): boolean {
    return this.destroyed;
  }
}

const asWindows = (...windows: FakeWindow[]): PrepareWindow[] => windows as never;
const requestIdOf = (window: FakeWindow): number => {
  const request = window.sent[0];
  if (!request) throw new Error("no prepare request was sent");
  return (request.payload as { requestId: number }).requestId;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PrepareRequests.prepare", () => {
  it("is true once every window answered yes, and false when one answers no", async () => {
    const requests = new PrepareRequests("prepare", 1000);
    const a = new FakeWindow();
    const b = new FakeWindow();
    const all = requests.prepare(asWindows(a, b));
    requests.answer(requestIdOf(a), true);
    requests.answer(requestIdOf(b), false);
    expect(await all).toBe(false);
  });

  it("does not wait for a window that closes before it answers", async () => {
    const requests = new PrepareRequests("prepare", 120_000);
    const open = new FakeWindow();
    const closing = new FakeWindow();
    const all = requests.prepare(asWindows(open, closing));
    requests.answer(requestIdOf(open), true);

    closing.emit("closed");

    // No timer advance: the closed window must end its own wait.
    expect(await all).toBe(true);
  });

  it("does not wait for a renderer that crashed or was destroyed", async () => {
    const requests = new PrepareRequests("prepare", 120_000);
    const crashed = new FakeWindow();
    const gone = new FakeWindow();
    const all = requests.prepare(asWindows(crashed, gone));

    crashed.webContents.emit("render-process-gone");
    gone.webContents.emit("destroyed");

    expect(await all).toBe(true);
  });

  it("a window destroyed before the request goes out is left out", async () => {
    const requests = new PrepareRequests("prepare", 120_000);
    const dead = new FakeWindow();
    dead.destroyed = true;
    expect(await requests.prepare(asWindows(dead))).toBe(true);
    expect(dead.sent).toEqual([]);
  });

  it("still gives up on a window that stays open and silent", async () => {
    const requests = new PrepareRequests("prepare", 1000);
    const silent = new FakeWindow();
    const all = requests.prepare(asWindows(silent));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await all).toBe(false);
  });
});
