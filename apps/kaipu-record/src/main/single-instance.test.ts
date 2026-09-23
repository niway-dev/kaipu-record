import { describe, expect, it, vi } from "vitest";
import { claimSingleInstance, type SingleInstanceApp } from "./single-instance";

function fakeApp(gotLock: boolean) {
  return {
    requestSingleInstanceLock: vi.fn<() => boolean>(() => gotLock),
    quit: vi.fn<() => void>(),
    on: vi.fn<(event: "second-instance", listener: () => void) => unknown>(),
  } satisfies SingleInstanceApp;
}

describe("claimSingleInstance", () => {
  it("keeps the lock and routes a second launch to onSecondInstance", () => {
    const app = fakeApp(true);
    const onSecondInstance = vi.fn();

    expect(claimSingleInstance(app, onSecondInstance)).toBe(true);

    expect(app.quit).not.toHaveBeenCalled();
    expect(app.on).toHaveBeenCalledWith("second-instance", expect.any(Function));
    app.on.mock.calls[0]![1]();
    expect(onSecondInstance).toHaveBeenCalledTimes(1);
  });

  // Two processes on the same userData share one Chromium profile. The second one loses the
  // LevelDB lock under Local Storage and silently runs on an in-memory copy: localStorage reads
  // come back empty (onboarding shows again) and writes never reach disk. Quitting instead of
  // starting a second instance is the only outcome that never corrupts or hides state.
  it("quits without registering anything when another instance already holds the lock", () => {
    const app = fakeApp(false);

    expect(claimSingleInstance(app, vi.fn())).toBe(false);

    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.on).not.toHaveBeenCalled();
  });
});
