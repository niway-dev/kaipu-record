import { describe, it, expect, vi } from "vitest";
import { AppShutdown, SHUTDOWN_DEADLINE_MARKER, type ShutdownDeps } from "./shutdown";

function harness(overrides: Partial<ShutdownDeps> = {}) {
  const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
  const logs: string[] = [];
  const exit = vi.fn();
  const deps: ShutdownDeps = {
    deadlineMs: 5000,
    log: (message) => {
      logs.push(message);
    },
    openWindows: () => [
      "#1 main https://app/ loading=false",
      "#7 overlay about:blank loading=true",
    ],
    exit,
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    ...overrides,
  };
  return { shutdown: new AppShutdown(deps), timers, logs, exit };
}

describe("AppShutdown", () => {
  it("is not quitting until begin()", () => {
    const { shutdown } = harness();
    expect(shutdown.isQuitting()).toBe(false);
    shutdown.begin();
    expect(shutdown.isQuitting()).toBe(true);
  });

  it("disposes participants newest first", () => {
    const { shutdown } = harness();
    const order: string[] = [];
    shutdown.register({ name: "hub", dispose: () => order.push("hub") });
    shutdown.register({ name: "panel", dispose: () => order.push("panel") });
    shutdown.register({ name: "timer", dispose: () => order.push("timer") });
    shutdown.begin();
    expect(order).toEqual(["timer", "panel", "hub"]);
  });

  it("a participant that throws is logged by name and the others still dispose", () => {
    const { shutdown, logs } = harness();
    const after = vi.fn();
    shutdown.register({ name: "first", dispose: after });
    shutdown.register({
      name: "overlay",
      dispose: () => {
        throw new Error("already destroyed");
      },
    });
    shutdown.begin();
    expect(after).toHaveBeenCalledTimes(1);
    expect(logs).toEqual(["[shutdown] overlay failed to dispose: already destroyed"]);
  });

  it("begin() is idempotent: one disposal, one deadline", () => {
    const { shutdown, timers } = harness();
    const dispose = vi.fn();
    shutdown.register({ name: "hub", dispose });
    shutdown.begin();
    shutdown.begin();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(5000);
  });

  it("a participant registered after the quit began is disposed at once", () => {
    const { shutdown } = harness();
    shutdown.begin();
    const dispose = vi.fn();
    shutdown.register({ name: "late window", dispose });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("an unregistered participant is left alone", () => {
    const { shutdown } = harness();
    const dispose = vi.fn();
    const unregister = shutdown.register({ name: "bubble", dispose });
    unregister();
    shutdown.begin();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("past the deadline it logs what is still open, with the marker, and exits", () => {
    const { shutdown, timers, logs, exit } = harness();
    shutdown.begin();
    expect(exit).not.toHaveBeenCalled();
    timers[0]!.callback();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(SHUTDOWN_DEADLINE_MARKER);
    expect(logs[0]).toContain("5000 ms");
    expect(logs[0]).toContain("2 window(s) still open");
    expect(logs[0]).toContain("#7 overlay about:blank loading=true");
  });

  it("finish() before the deadline disarms it, so a clean quit never exits by force", () => {
    const { shutdown, timers, exit } = harness();
    shutdown.begin();
    shutdown.finish();
    expect(timers[0]!.cleared).toBe(true);
    expect(exit).not.toHaveBeenCalled();
  });

  it("finish() without a begin() is a no-op", () => {
    const { shutdown, timers } = harness();
    shutdown.finish();
    expect(timers).toHaveLength(0);
  });
});
