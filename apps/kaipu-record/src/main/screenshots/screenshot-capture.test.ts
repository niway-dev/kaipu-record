import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Display } from "electron";
import type { CaptureMode, OverlayAnswer } from "@shared/types/screenshot-capture";
import type { OverlayPort } from "./overlay-port";
import {
  MacProvider,
  UnsupportedProvider,
  WindowsProvider,
  createScreenshotProvider,
  type CapturedImage,
  type ScreenSource,
  type WindowsDeps,
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
      settle: async () => {},
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
    let settle: () => Promise<void>;

    beforeEach(() => {
      log = [];
      settle = async () => {
        log.push("settle");
      };
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
        settle,
      });

    it("screen with one display skips the overlay and captures its bounds", async () => {
      const out = await macProvider().capture({ mode: "screen", overlay: fake });
      expect(fake.pick).not.toHaveBeenCalled();
      expect(log).toEqual([
        "settle",
        "hideAll",
        "runCli:-R 0,0,1440,900 -x /tmp/x.png",
        "destroyAll",
      ]);
      expect(out).toEqual({ kind: "captured", png: PNG, mode: "screen" });
    });

    it("one display waits for the settle delay before running screencapture", async () => {
      let release = (): void => {};
      settle = () => new Promise<void>((resolve) => (release = resolve));
      const pending = macProvider().capture({ mode: "screen", overlay: fake });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runCli).not.toHaveBeenCalled();
      release();
      expect((await pending).kind).toBe("captured");
      expect(runCli).toHaveBeenCalledTimes(1);
    });

    it("screen with two displays picks, hides, captures the chosen display, then destroys", async () => {
      displays = [main, left];
      answer = { kind: "display", displayId: 2 };
      const out = await macProvider().capture({ mode: "screen", overlay: fake });
      expect(log).toEqual([
        "pick:screen",
        "hideAll",
        "settle",
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
        "settle",
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
      expect(log).toEqual(["settle", "hideAll", "runCli", "destroyAll"]);
    });

    it("destroys the overlay when pick itself throws", async () => {
      displays = [main, left];
      fake.pick = vi.fn(async () => {
        throw new Error("renderer crashed");
      });
      await expect(macProvider().capture({ mode: "frame", overlay: fake })).rejects.toThrow();
      expect(fake.destroyAll).toHaveBeenCalledTimes(1);
    });

    it("waits for the settle delay after hideAll before running screencapture", async () => {
      displays = [main, left];
      answer = { kind: "display", displayId: 2 };
      let release = (): void => {};
      settle = () => new Promise<void>((resolve) => (release = resolve));
      const pending = macProvider().capture({ mode: "screen", overlay: fake });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(fake.hideAll).toHaveBeenCalled();
      expect(runCli).not.toHaveBeenCalled();
      release();
      expect((await pending).kind).toBe("captured");
    });

    it("answers cancelled with a warning when the picked display is gone after the answer", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      displays = [main, left];
      answer = { kind: "display", displayId: 2 };
      fake.hideAll = vi.fn(async () => {
        log.push("hideAll");
        displays = [main]; // display 2 unplugged between the answer and the grab
      });
      expect(await macProvider().capture({ mode: "screen", overlay: fake })).toEqual({
        kind: "cancelled",
      });
      expect(runCli).not.toHaveBeenCalled();
      expect(log.at(-1)).toBe("destroyAll");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("display 2"));
    });

    it("area never touches the overlay", async () => {
      await macProvider().capture({ mode: "area", overlay: fake });
      expect(log).toEqual(["runCli:-i -o -x /tmp/x.png"]);
    });
  });
});

describe("UnsupportedProvider", () => {
  it.each(MODES)("%s echoes the mode as unsupported", async (mode) => {
    expect(await new UnsupportedProvider().capture({ mode, overlay })).toEqual({
      kind: "unsupported",
      mode,
    });
  });
});

describe("WindowsProvider", () => {
  const PNG = (tag: string): Buffer => Buffer.from(`png:${tag}`);
  const display = (
    id: number,
    bounds: { x: number; y: number; width: number; height: number },
    scaleFactor: number,
  ): Display => ({ id, bounds, workArea: bounds, scaleFactor }) as Display;
  const primary = display(1, { x: 0, y: 0, width: 1920, height: 1080 }, 1);
  const hiDpi = display(2, { x: 1920, y: 0, width: 1280, height: 720 }, 1.5);

  let log: string[];
  let answer: OverlayAnswer;
  let displays: Display[];
  let sources: ScreenSource[];
  let fake: OverlayPort;
  let settle: () => Promise<void>;
  let crops: Array<{ x: number; y: number; width: number; height: number }>;
  let requested: Array<{ width: number; height: number }>;

  /** A fake image of `size` whose crop records the rectangle and tags its PNG. */
  const image = (size: { width: number; height: number }, tag: string): CapturedImage => ({
    getSize: () => size,
    isEmpty: () => size.width === 0 || size.height === 0,
    crop: (rect) => {
      crops.push(rect);
      return image({ width: rect.width, height: rect.height }, `${tag}-crop`);
    },
    toPNG: () => PNG(tag),
  });

  beforeEach(() => {
    log = [];
    crops = [];
    requested = [];
    settle = async () => {
      log.push("settle");
    };
    answer = { kind: "cancelled" };
    displays = [primary];
    sources = [{ display_id: "1", thumbnail: image({ width: 1920, height: 1080 }, "one") }];
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
  });
  afterEach(() => vi.restoreAllMocks());

  const provider = (): WindowsProvider => {
    const deps: WindowsDeps = {
      getSources: async (options) => {
        log.push("getSources");
        requested.push(options.thumbnailSize);
        return sources;
      },
      getDisplays: async () => displays,
      settle: () => settle(),
    };
    return new WindowsProvider(deps);
  };

  it("serves every mode", () => {
    expect(MODES.map((m) => provider().supports(m))).toEqual([true, true, true]);
  });

  it("area: pick, hide, capture, destroy, in that order, cropped in physical pixels", async () => {
    answer = { kind: "rect", displayId: 1, rect: { x: 100, y: 50, width: 640, height: 360 } };
    const out = await provider().capture({ mode: "area", overlay: fake });
    expect(log).toEqual(["pick:area", "hideAll", "settle", "getSources", "destroyAll"]);
    expect(crops).toEqual([{ x: 100, y: 50, width: 640, height: 360 }]);
    expect(out).toEqual({ kind: "captured", png: PNG("one-crop"), mode: "area" });
  });

  it("frame on a 150% display crops 150 physical px for a 100 DIP frame", async () => {
    displays = [primary, hiDpi];
    sources = [{ display_id: "2", thumbnail: image({ width: 1920, height: 1080 }, "two") }];
    answer = { kind: "rect", displayId: 2, rect: { x: 0, y: 0, width: 100, height: 100 } };
    await provider().capture({ mode: "frame", overlay: fake });
    expect(requested).toEqual([{ width: 1920, height: 1080 }]);
    expect(crops).toEqual([{ x: 0, y: 0, width: 150, height: 150 }]);
  });

  it("an image smaller than requested still crops the right region", async () => {
    displays = [primary, hiDpi];
    // Asked for 1920x1080, got 1280x720 (scale 1.0): 100 DIP is now 100 px, not 150.
    sources = [{ display_id: "2", thumbnail: image({ width: 1280, height: 720 }, "two") }];
    answer = { kind: "rect", displayId: 2, rect: { x: 640, y: 360, width: 100, height: 100 } };
    await provider().capture({ mode: "frame", overlay: fake });
    expect(crops).toEqual([{ x: 640, y: 360, width: 100, height: 100 }]);
  });

  it("matches the source by display_id when there are two", async () => {
    displays = [primary, hiDpi];
    sources = [
      { display_id: "1", thumbnail: image({ width: 1920, height: 1080 }, "one") },
      { display_id: "2", thumbnail: image({ width: 1920, height: 1080 }, "two") },
    ];
    answer = { kind: "display", displayId: 2 };
    const out = await provider().capture({ mode: "screen", overlay: fake });
    expect(out).toEqual({ kind: "captured", png: PNG("two"), mode: "screen" });
    expect(crops).toEqual([]); // Screen takes the whole thumbnail
  });

  it("falls back to the lone source when its display_id is empty", async () => {
    sources = [{ display_id: "", thumbnail: image({ width: 1920, height: 1080 }, "lone") }];
    const out = await provider().capture({ mode: "screen", overlay: fake });
    expect(out).toEqual({ kind: "captured", png: PNG("lone"), mode: "screen" });
  });

  it("does not guess among several sources when none matches", async () => {
    displays = [primary, hiDpi];
    sources = [
      { display_id: "7", thumbnail: image({ width: 1, height: 1 }, "a") },
      { display_id: "8", thumbnail: image({ width: 1, height: 1 }, "b") },
    ];
    answer = { kind: "display", displayId: 2 };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await provider().capture({ mode: "screen", overlay: fake })).toEqual({
      kind: "cancelled",
    });
  });

  it("screen with one display skips the overlay, settles, hides and captures", async () => {
    const out = await provider().capture({ mode: "screen", overlay: fake });
    expect(fake.pick).not.toHaveBeenCalled();
    expect(log).toEqual(["settle", "hideAll", "getSources", "destroyAll"]);
    expect(out).toEqual({ kind: "captured", png: PNG("one"), mode: "screen" });
  });

  it("one display waits for the settle delay before asking for sources", async () => {
    let release = (): void => {};
    settle = () => new Promise<void>((resolve) => (release = resolve));
    const pending = provider().capture({ mode: "screen", overlay: fake });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(log).not.toContain("getSources");
    release();
    expect((await pending).kind).toBe("captured");
  });

  it("answers cancelled with a warning when the picked display is gone after the answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    displays = [primary, hiDpi];
    answer = { kind: "display", displayId: 2 };
    fake.hideAll = vi.fn(async () => {
      log.push("hideAll");
      displays = [primary];
    });
    expect(await provider().capture({ mode: "screen", overlay: fake })).toEqual({
      kind: "cancelled",
    });
    expect(log).toEqual(["pick:screen", "hideAll", "settle", "destroyAll"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("display 2"));
  });

  it("an empty source list answers cancelled with a warning and destroys", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sources = [];
    expect(await provider().capture({ mode: "screen", overlay: fake })).toEqual({
      kind: "cancelled",
    });
    expect(warn).toHaveBeenCalled();
    expect(log.at(-1)).toBe("destroyAll");
  });

  it("an empty thumbnail is not a match: cancelled with a warning, nothing cropped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    sources = [{ display_id: "1", thumbnail: image({ width: 0, height: 0 }, "empty") }];
    expect(await provider().capture({ mode: "screen", overlay: fake })).toEqual({
      kind: "cancelled",
    });
    expect(warn).toHaveBeenCalled();
    expect(crops).toEqual([]);
    expect(log.at(-1)).toBe("destroyAll");
  });

  it("an image reporting isEmpty() is not a match even with a size", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sources = [
      {
        display_id: "1",
        thumbnail: { ...image({ width: 1920, height: 1080 }, "x"), isEmpty: () => true },
      },
    ];
    expect(await provider().capture({ mode: "screen", overlay: fake })).toEqual({
      kind: "cancelled",
    });
  });

  it("cancel at pick answers cancelled, captures nothing, and still destroys", async () => {
    expect(await provider().capture({ mode: "area", overlay: fake })).toEqual({
      kind: "cancelled",
    });
    expect(log).toEqual(["pick:area", "destroyAll"]);
  });

  it("destroys the overlay and rethrows when getSources throws", async () => {
    const throwing = new WindowsProvider({
      getSources: async () => {
        throw new Error("boom");
      },
      getDisplays: async () => displays,
      settle,
    });
    await expect(throwing.capture({ mode: "screen", overlay: fake })).rejects.toThrow("boom");
    expect(fake.destroyAll).toHaveBeenCalledTimes(1);
  });
});

describe("supports", () => {
  it("Mac and Windows serve every mode; others serve nothing", () => {
    const mac = new MacProvider();
    expect(MODES.map((m) => mac.supports(m))).toEqual([true, true, true]);
    expect(new UnsupportedProvider().supports()).toBe(false);
  });

  it("lists the supported modes for the renderer", () => {
    expect(new MacProvider().supportedModes()).toEqual(["area", "screen", "frame"]);
    expect(new UnsupportedProvider().supportedModes()).toEqual([]);
  });
});

describe("createScreenshotProvider", () => {
  it("picks the provider by platform", () => {
    expect(createScreenshotProvider("darwin")).toBeInstanceOf(MacProvider);
    expect(createScreenshotProvider("win32")).toBeInstanceOf(WindowsProvider);
    expect(createScreenshotProvider("linux")).toBeInstanceOf(UnsupportedProvider);
  });
});
