import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Display } from "electron";
import type { CaptureMode, OverlayAnswer } from "@shared/types/screenshot-capture";
import type { OverlayPort } from "./overlay-port";
import {
  MacProvider,
  UnsupportedProvider,
  WindowsProvider,
  createScreenshotProvider,
} from "./screenshot-capture";

const MODES: CaptureMode[] = ["area", "screen", "frame"];
const overlay: OverlayPort = {
  pick: vi.fn(async () => ({ kind: "cancelled" as const })),
  hideAll: vi.fn(async () => {}),
  destroyAll: vi.fn(),
};

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
    new MacProvider({
      runCli,
      readPng,
      fileExists,
      tempPath: () => "/tmp/x.png",
      getDisplays: async () => [],
    });

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

  describe("screen and frame through the overlay", () => {
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const display = (id: number, x: number, y: number, width: number, height: number): Display =>
      ({ id, bounds: { x, y, width, height } }) as Display;
    const main = display(1, 0, 0, 1440, 900);
    const left = display(2, -1920, 0, 1920, 1080);

    let log: string[];
    let answer: OverlayAnswer;
    let displays: Display[];
    let fake: OverlayPort;

    beforeEach(() => {
      log = [];
      answer = { kind: "cancelled" };
      displays = [main];
      fake = {
        pick: vi.fn(async (ui) => {
          log.push(`pick:${ui}`);
          return answer;
        }),
        hideAll: vi.fn(async () => {
          log.push("hideAll");
        }),
        destroyAll: vi.fn(() => {
          log.push("destroyAll");
        }),
      };
      runCli = vi.fn(async (_cmd, args) => {
        log.push(`runCli:${args.join(" ")}`);
      });
    });

    const macProvider = (): MacProvider =>
      new MacProvider({
        runCli,
        readPng: async () => PNG,
        fileExists,
        tempPath: () => "/tmp/x.png",
        getDisplays: async () => displays,
      });

    it("screen with one display skips the overlay and captures its bounds", async () => {
      const out = await macProvider().capture({ mode: "screen", overlay: fake });
      expect(fake.pick).not.toHaveBeenCalled();
      expect(log).toEqual(["hideAll", "runCli:-R 0,0,1440,900 -x /tmp/x.png", "destroyAll"]);
      expect(out).toEqual({ kind: "captured", png: PNG, mode: "screen" });
    });

    it("screen with two displays picks, hides, captures the chosen display, then destroys", async () => {
      displays = [main, left];
      answer = { kind: "display", displayId: 2 };
      const out = await macProvider().capture({ mode: "screen", overlay: fake });
      expect(log).toEqual([
        "pick:screen",
        "hideAll",
        "runCli:-R -1920,0,1920,1080 -x /tmp/x.png",
        "destroyAll",
      ]);
      expect(out.kind).toBe("captured");
    });

    it("frame converts the display-relative rect to global DIP", async () => {
      displays = [main, left];
      answer = { kind: "rect", displayId: 2, rect: { x: 100, y: 50, width: 640, height: 360 } };
      const out = await macProvider().capture({ mode: "frame", overlay: fake });
      expect(log).toEqual([
        "pick:frame",
        "hideAll",
        "runCli:-R -1820,50,640,360 -x /tmp/x.png",
        "destroyAll",
      ]);
      expect(out).toEqual({ kind: "captured", png: PNG, mode: "frame" });
    });

    it("frame with one display still goes through the overlay", async () => {
      answer = { kind: "rect", displayId: 1, rect: { x: 10, y: 20, width: 30, height: 40 } };
      await macProvider().capture({ mode: "frame", overlay: fake });
      expect(fake.pick).toHaveBeenCalledWith("frame", [main]);
    });

    it("cancel at pick answers cancelled, captures nothing, and still destroys", async () => {
      displays = [main, left];
      expect(await macProvider().capture({ mode: "screen", overlay: fake })).toEqual({
        kind: "cancelled",
      });
      expect(log).toEqual(["pick:screen", "destroyAll"]);
    });

    it("a missing file after screencapture answers cancelled", async () => {
      fileExists = vi.fn(async () => false);
      expect(await macProvider().capture({ mode: "screen", overlay: fake })).toEqual({
        kind: "cancelled",
      });
      expect(log.at(-1)).toBe("destroyAll");
    });

    it("destroys the overlay and rethrows when runCli throws", async () => {
      runCli = vi.fn(async () => {
        log.push("runCli");
        throw new Error("boom");
      });
      await expect(macProvider().capture({ mode: "screen", overlay: fake })).rejects.toThrow(
        "boom",
      );
      expect(log).toEqual(["hideAll", "runCli", "destroyAll"]);
    });

    it("destroys the overlay when pick itself throws", async () => {
      displays = [main, left];
      fake.pick = vi.fn(async () => {
        throw new Error("renderer crashed");
      });
      await expect(macProvider().capture({ mode: "frame", overlay: fake })).rejects.toThrow();
      expect(fake.destroyAll).toHaveBeenCalledTimes(1);
    });

    it("area never touches the overlay", async () => {
      await macProvider().capture({ mode: "area", overlay: fake });
      expect(log).toEqual(["runCli:-i -o -x /tmp/x.png"]);
    });
  });
});

describe.each([
  ["WindowsProvider", () => new WindowsProvider()],
  ["UnsupportedProvider", () => new UnsupportedProvider()],
])("%s", (_name, make) => {
  it.each(MODES)("%s echoes the mode as unsupported", async (mode) => {
    expect(await make().capture({ mode, overlay })).toEqual({ kind: "unsupported", mode });
  });
});

describe("supports", () => {
  it("Mac serves every mode; Windows and others serve nothing", () => {
    const mac = new MacProvider();
    expect(MODES.map((m) => mac.supports(m))).toEqual([true, true, true]);
    expect(new WindowsProvider().supports()).toBe(false);
    expect(new UnsupportedProvider().supports()).toBe(false);
  });
});

describe("createScreenshotProvider", () => {
  it("picks the provider by platform", () => {
    expect(createScreenshotProvider("darwin")).toBeInstanceOf(MacProvider);
    expect(createScreenshotProvider("win32")).toBeInstanceOf(WindowsProvider);
    expect(createScreenshotProvider("linux")).toBeInstanceOf(UnsupportedProvider);
  });
});
