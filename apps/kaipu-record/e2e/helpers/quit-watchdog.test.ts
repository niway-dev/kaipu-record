import { describe, it, expect, vi } from "vitest";
import {
  closeOrReport,
  QUIT_DEADLINE_MS,
  SAMPLE_TIMEOUT_MS,
  type QuitWatchdogDeps,
} from "./quit-watchdog";
import { TEST_TIMEOUT_MS } from "./test-budget";

function deps(overrides: Partial<QuitWatchdogDeps> = {}): QuitWatchdogDeps & {
  attachments: Array<{ name: string; body: string }>;
} {
  const attachments: Array<{ name: string; body: string }> = [];
  return {
    attachments,
    close: () => Promise.resolve(),
    deadlineMs: 50,
    sample: () => Promise.resolve("Call graph:\n  main thread stack"),
    kill: vi.fn(),
    stderr: () => "[electron] something it printed",
    attach: async (name, body) => {
      attachments.push({ name, body });
    },
    ...overrides,
  };
}

describe("closeOrReport", () => {
  it("returns once the app closes within the deadline and touches nothing else", async () => {
    const d = deps();
    await expect(closeOrReport(d)).resolves.toBeUndefined();
    expect(d.kill).not.toHaveBeenCalled();
    expect(d.attachments).toEqual([]);
  });

  it("on a hang: attaches the stack and stderr, kills the process, and fails with a message that names the hang", async () => {
    const d = deps({ close: () => new Promise(() => {}) });
    await expect(closeOrReport(d)).rejects.toThrow(/app\.quit\(\) did not finish within 50 ms/);
    expect(d.kill).toHaveBeenCalledTimes(1);
    expect(d.attachments.map((a) => a.name)).toEqual(["quit-hang-stack", "quit-hang-stderr"]);
    expect(d.attachments[0]!.body).toContain("main thread stack");
    expect(d.attachments[1]!.body).toContain("something it printed");
  });

  it("still kills and fails when the stack sample itself fails", async () => {
    const d = deps({
      close: () => new Promise(() => {}),
      sample: () => Promise.reject(new Error("sample: not permitted")),
    });
    await expect(closeOrReport(d)).rejects.toThrow(/did not finish/);
    expect(d.kill).toHaveBeenCalledTimes(1);
    expect(d.attachments.map((a) => a.name)).toEqual(["quit-hang-stack", "quit-hang-stderr"]);
    expect(d.attachments[0]!.body).toContain("sample: not permitted");
  });

  it("kills before failing even when attaching the evidence throws", async () => {
    const d = deps({
      close: () => new Promise(() => {}),
      attach: () => Promise.reject(new Error("no test running")),
    });
    await expect(closeOrReport(d)).rejects.toThrow(/did not finish/);
    expect(d.kill).toHaveBeenCalledTimes(1);
  });

  it("a close that rejects fails with that error, not the hang message", async () => {
    const d = deps({ close: () => Promise.reject(new Error("Target closed")) });
    await expect(closeOrReport(d)).rejects.toThrow("Target closed");
    expect(d.kill).not.toHaveBeenCalled();
  });

  it("a hung quit plus its stack sample leaves most of the test's budget to the test itself", () => {
    // The watchdog runs in teardown, after the test body has spent its own time (launch,
    // actions, assertions: 3–15 s in this suite, up to ~30 s with the slowest polls). Even a
    // sample that takes its whole timeout must not push a hung test past Playwright's
    // timeout, or the report degrades back to the bare "Test timeout exceeded" with no stack.
    expect(QUIT_DEADLINE_MS + SAMPLE_TIMEOUT_MS).toBeLessThanOrEqual(TEST_TIMEOUT_MS / 2);
  });
});
