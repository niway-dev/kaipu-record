import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEV_UPDATE_SCENARIOS,
  readDevUpdateStatus,
  subscribeDevUpdateStatus,
  writeDevUpdateScenario,
} from "./dev-update-simulator";

describe("dev update simulator", () => {
  beforeEach(() => writeDevUpdateScenario("off"));

  it("is off by default, so the real updater status shows through", () => {
    expect(readDevUpdateStatus()).toBeNull();
  });

  it("forces the selected scenario", () => {
    writeDevUpdateScenario("downloading");
    expect(readDevUpdateStatus()).toEqual({
      state: "downloading",
      version: "0.9.0",
      percent: 43,
    });
  });

  // useSyncExternalStore spins forever on an unstable snapshot, and the
  // `checkedAt` stamp is generated at read time — so the identity must hold.
  it("returns an identical object across reads of the same scenario", () => {
    writeDevUpdateScenario("up-to-date");
    expect(readDevUpdateStatus()).toBe(readDevUpdateStatus());
  });

  it("notifies subscribers when the scenario changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDevUpdateStatus(listener);
    writeDevUpdateScenario("ready");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("offers every state the UI has to render", () => {
    expect(DEV_UPDATE_SCENARIOS.map((s) => s.status.state)).toEqual([
      "idle",
      "checking",
      "up-to-date",
      "available",
      "downloading",
      "ready",
      "error",
    ]);
  });
});
