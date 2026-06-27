import { afterEach, describe, expect, it, vi } from "vitest";
import { installCrashForwarder } from "./crash-forwarder";

const reportException = vi.fn();

afterEach(() => {
  vi.clearAllMocks();
});

describe("installCrashForwarder", () => {
  it("forwards window errors as serialized exceptions tagged with origin", () => {
    (globalThis as unknown as { electronAPI: { reportException: typeof reportException } }).electronAPI =
      { reportException };
    installCrashForwarder("control-bar");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("kaboom") }));
    expect(reportException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "kaboom" }),
      "control-bar",
      undefined,
    );
  });
});
