import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelRelaunchRequest,
  exitRelaunchingIfRequested,
  relaunchIfRequested,
  requestRelaunchOnQuit,
} from "./relaunch";

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

  it("a quit that hit the deadline still restarts, before the process exits", () => {
    const calls: string[] = [];
    requestRelaunchOnQuit();
    exitRelaunchingIfRequested(
      () => calls.push("relaunch"),
      () => calls.push("exit"),
    );
    expect(calls).toEqual(["relaunch", "exit"]);
  });

  it("a deadline exit without a request only exits", () => {
    const calls: string[] = [];
    exitRelaunchingIfRequested(
      () => calls.push("relaunch"),
      () => calls.push("exit"),
    );
    expect(calls).toEqual(["exit"]);
  });
});

describe("relaunch wiring in the main process", () => {
  const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

  it("relaunches on will-quit, never in before-quit, where a close guard can still cancel", () => {
    const index = source("index.ts");
    expect(index).toMatch(/app\.on\("will-quit", \(\) => \{\s*relaunchIfRequested\(/);
    expect(index.match(/relaunchIfRequested\(/g)).toHaveLength(1);
  });

  it("every close guard that keeps the app running also drops a pending restart", () => {
    const index = source("index.ts");
    const resets = index.match(/^\s+isQuitting = false;/gm) ?? [];
    const dropped = index.match(/isQuitting = false;\s*cancelRelaunchRequest\(\);/g) ?? [];
    expect(resets.length).toBeGreaterThan(0);
    expect(dropped).toHaveLength(resets.length);
  });

  it("the deadline exit goes through exitRelaunchingIfRequested", () => {
    expect(source("app-shutdown.ts")).toMatch(/exit: \(\) =>\s*exitRelaunchingIfRequested\(/);
  });
});
