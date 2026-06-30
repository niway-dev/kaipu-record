import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We inject the deps so the provider is testable without spawning `screencapture`.
import { MacNativeProvider } from "./screenshot-capture";

describe("MacNativeProvider", () => {
  let runCli: ReturnType<typeof vi.fn>;
  let readPng: ReturnType<typeof vi.fn>;
  let fileExists: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runCli = vi.fn(async () => {});
    readPng = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    fileExists = vi.fn(async () => true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns the captured PNG buffer", async () => {
    const provider = new MacNativeProvider({ runCli, readPng, fileExists, tempPath: () => "/tmp/x.png" });
    const out = await provider.captureInteractive();
    expect(runCli).toHaveBeenCalledWith("screencapture", ["-i", "-o", "/tmp/x.png"]);
    expect(out).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("returns null when the user cancels (no file written)", async () => {
    fileExists = vi.fn(async () => false);
    const provider = new MacNativeProvider({ runCli, readPng, fileExists, tempPath: () => "/tmp/x.png" });
    expect(await provider.captureInteractive()).toBeNull();
    expect(readPng).not.toHaveBeenCalled();
  });
});
