import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We inject the deps so the provider is testable without spawning `screencapture`.
import { MacNativeProvider } from "./screenshot-capture";

describe("MacNativeProvider", () => {
  // Typed with the Deps signatures so the injected object is assignable (vi.fn's
  // loose Mock type otherwise fails `npm run typecheck` even though it runs fine).
  let runCli: (cmd: string, args: string[]) => Promise<void>;
  let readPng: (path: string) => Promise<Buffer>;
  let fileExists: (path: string) => Promise<boolean>;

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
