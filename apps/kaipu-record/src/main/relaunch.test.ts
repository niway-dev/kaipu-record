import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelRelaunchRequest, relaunchIfRequested, requestRelaunchOnQuit } from "./relaunch";

afterEach(() => cancelRelaunchRequest());

describe("relaunch on quit", () => {
  it("does nothing unless a relaunch was requested", () => {
    const relaunch = vi.fn();
    relaunchIfRequested(relaunch);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("relaunches once the quit has passed its guards", () => {
    const relaunch = vi.fn();
    requestRelaunchOnQuit();
    relaunchIfRequested(relaunch);
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("a quit the user cancelled leaves no relaunch behind for the next quit", () => {
    const relaunch = vi.fn();
    requestRelaunchOnQuit();
    cancelRelaunchRequest(); // the recording / export guard was answered Cancel
    relaunchIfRequested(relaunch);
    expect(relaunch).not.toHaveBeenCalled();
  });
});
