import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proceedWhenRecordingStops } from "./stop-guard";

/** `ipcMain`'s once/removeListener over a map, like Node's EventEmitter. */
function fakeIpc() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    once(channel: string, listener: () => void) {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    },
    removeListener(channel: string, listener: () => void) {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    emit(channel: string) {
      const current = listeners.get(channel) ?? [];
      listeners.set(channel, []); // `once`: each listener runs a single time
      for (const listener of current) listener();
    },
    listeners: (channel: string) => listeners.get(channel) ?? [],
  };
}

describe("proceedWhenRecordingStops", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("proceeds once when the stop arrives, without the timeout", () => {
    const ipc = fakeIpc();
    const proceed = vi.fn();
    const onTimeout = vi.fn();
    proceedWhenRecordingStops({
      ipc,
      channel: "recording:stop",
      timeoutMs: 5000,
      proceed,
      onTimeout,
    });

    ipc.emit("recording:stop");
    vi.advanceTimersByTime(6000);

    expect(proceed).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("on timeout runs onTimeout then proceed, and a later stop does not proceed again", () => {
    const ipc = fakeIpc();
    const order: string[] = [];
    proceedWhenRecordingStops({
      ipc,
      channel: "recording:stop",
      timeoutMs: 5000,
      proceed: () => order.push("proceed"),
      onTimeout: () => order.push("timeout"),
    });

    vi.advanceTimersByTime(5000);
    // The next take's stop: it must not close the window the user got back.
    ipc.emit("recording:stop");

    expect(order).toEqual(["timeout", "proceed"]);
    expect(ipc.listeners("recording:stop")).toHaveLength(0);
  });
});
