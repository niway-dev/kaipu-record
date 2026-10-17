import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import type { OverlayPort } from "./overlay-port";
import {
  MacProvider,
  UnsupportedProvider,
  WindowsProvider,
  createScreenshotProvider,
} from "./screenshot-capture";

const MODES: CaptureMode[] = ["area", "screen", "frame"];
const overlay: OverlayPort = { pick: vi.fn(async () => ({ kind: "cancelled" as const })) };

describe("MacProvider", () => {
  // Typed with the Deps signatures so the injected object is assignable (vi.fn's
  // loose Mock type otherwise fails the typecheck even though it runs fine).
  let runCli: (cmd: string, args: string[]) => Promise<void>;
  let readPng: (path: string) => Promise<Buffer>;
  let fileExists: (path: string) => Promise<boolean>;

  beforeEach(() => {
    runCli = vi.fn(async () => {});
    readPng = vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    fileExists = vi.fn(async () => true);
  });
  afterEach(() => vi.restoreAllMocks());

  const provider = (): MacProvider =>
    new MacProvider({ runCli, readPng, fileExists, tempPath: () => "/tmp/x.png" });

  it("area: returns the captured PNG, silently (-x)", async () => {
    const out = await provider().capture({ mode: "area", overlay });
    expect(runCli).toHaveBeenCalledWith("screencapture", ["-i", "-o", "-x", "/tmp/x.png"]);
    expect(out).toEqual({
      kind: "captured",
      png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mode: "area",
    });
  });

  it("area: answers cancelled when the user cancels (no file written)", async () => {
    fileExists = vi.fn(async () => false);
    expect(await provider().capture({ mode: "area", overlay })).toEqual({ kind: "cancelled" });
    expect(readPng).not.toHaveBeenCalled();
  });

  it.each(["screen", "frame"] as const)(
    "%s: unsupported until the overlay exists",
    async (mode) => {
      expect(await provider().capture({ mode, overlay })).toEqual({ kind: "unsupported", mode });
      expect(runCli).not.toHaveBeenCalled();
    },
  );
});

describe.each([
  ["WindowsProvider", () => new WindowsProvider()],
  ["UnsupportedProvider", () => new UnsupportedProvider()],
])("%s", (_name, make) => {
  it.each(MODES)("%s echoes the mode as unsupported", async (mode) => {
    expect(await make().capture({ mode, overlay })).toEqual({ kind: "unsupported", mode });
  });
});

describe("createScreenshotProvider", () => {
  it("picks the provider by platform", () => {
    expect(createScreenshotProvider("darwin")).toBeInstanceOf(MacProvider);
    expect(createScreenshotProvider("win32")).toBeInstanceOf(WindowsProvider);
    expect(createScreenshotProvider("linux")).toBeInstanceOf(UnsupportedProvider);
  });
});
