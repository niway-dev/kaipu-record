import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Display } from "electron";
import {
  CAPTURE_MODES,
  type CaptureMode,
  type OverlayAnswer,
} from "@shared/types/screenshot-capture";
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

const MODES: CaptureMode[] = ["frame", "window", "screen"];
const overlay: OverlayPort = {
  pick: vi.fn(async () => ({ kind: "cancelled" as const })),
  hideAll: vi.fn(async () => {}),
  destroyAll: vi.fn(),
};

describe("MacProvider", () => {
  // Typed with the Deps signatures so the injected object is assignable (vi.fn's
  // loose Mock type otherwise fails the typecheck even though it runs fine).
  let runCli: (cmd: string, args: string[]) => Promise<void>;
  let fileExists: (path: string) => Promise<boolean>;

  beforeEach(() => {
    runCli = vi.fn(async () => {});
    fileExists = vi.fn(async () => true);
  });
  afterEach(() => vi.restoreAllMocks());

  describe("through the overlay", () => {
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
      expect(out).toEqual({ kind: "captured", png: PNG, mode: "screen", action: "capture" });
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
      answer = { kind: "display", mode: "screen", action: "capture", displayId: 2 };
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

    it.each([
      ["record", true],
      ["select", false],
    ] as const)(
      "a %s answer chooses a recording target and captures nothing",
      async (action, start) => {
        displays = [main, left];
        const rect = { x: 100, y: 50, width: 640, height: 360 };
        answer = { kind: "rect", mode: "frame", action, displayId: 2, rect };
        const out = await macProvider().capture({ mode: "frame", overlay: fake, intent: "record" });
        expect(fake.pick).toHaveBeenCalledWith("frame", displays, "record");
        expect(log).toEqual(["pick:frame", "destroyAll"]);
        expect(out).toEqual({ kind: "record", start, displayId: 2, rect });
      },
    );

    it("a record answer on the Screen chooser records the whole display", async () => {
      displays = [main, left];
      answer = { kind: "display", mode: "screen", action: "record", displayId: 2 };
      const out = await macProvider().capture({ mode: "screen", overlay: fake });
      expect(out).toEqual({ kind: "record", start: true, displayId: 2, rect: null });
      expect(runCli).not.toHaveBeenCalled();
    });

    it("screen with one display in the record intent records it without an overlay", async () => {
      // "Start recording" in Screen on a lone display: the take starts, it does not only
      // set the target (which left the user with no recording at all).
      const out = await macProvider().capture({ mode: "screen", overlay: fake, intent: "record" });
      expect(fake.pick).not.toHaveBeenCalled();
      expect(out).toEqual({ kind: "record", start: true, displayId: 1, rect: null });
      expect(runCli).not.toHaveBeenCalled();
    });

    it("frame converts the display-relative rect to global DIP", async () => {
      displays = [main, left];
      answer = {
        kind: "rect",
        mode: "frame",
        action: "capture",
        displayId: 2,
        rect: { x: 100, y: 50, width: 640, height: 360 },
      };
      const out = await macProvider().capture({ mode: "frame", overlay: fake });
      expect(log).toEqual([
        "pick:frame",
        "hideAll",
        "settle",
        "runCli:-R -1820,50,640,360 -x /tmp/x.png",
        "destroyAll",
      ]);
      expect(out).toEqual({ kind: "captured", png: PNG, mode: "frame", action: "capture" });
    });

    it("frame with one display still goes through the overlay", async () => {
      answer = {
        kind: "rect",
        mode: "frame",
        action: "capture",
        displayId: 1,
        rect: { x: 10, y: 20, width: 30, height: 40 },
      };
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

    describe("capturing by the overlay's answer, not the requested mode", () => {
      it("a Frame request answered with a display captures the whole display as Screen", async () => {
        displays = [main, left];
        answer = { kind: "display", mode: "screen", action: "capture", displayId: 2 };
        const out = await macProvider().capture({ mode: "frame", overlay: fake });
        expect(log).toContain("runCli:-R -1920,0,1920,1080 -x /tmp/x.png");
        expect(out).toEqual({ kind: "captured", png: PNG, mode: "screen", action: "capture" });
      });

      it("a Screen request answered with a rect crops that rect as Frame", async () => {
        displays = [main, left];
        answer = {
          kind: "rect",
          mode: "frame",
          action: "capture",
          displayId: 1,
          rect: { x: 10, y: 20, width: 30, height: 40 },
        };
        const out = await macProvider().capture({ mode: "screen", overlay: fake });
        expect(log).toContain("runCli:-R 10,20,30,40 -x /tmp/x.png");
        expect(out).toEqual({ kind: "captured", png: PNG, mode: "frame", action: "capture" });
      });

      it("carries the answer's action on the result", async () => {
        answer = {
          kind: "rect",
          mode: "frame",
          action: "copy",
          displayId: 1,
          rect: { x: 1, y: 2, width: 3, height: 4 },
        };
        const out = await macProvider().capture({ mode: "frame", overlay: fake });
        expect(out).toMatchObject({ kind: "captured", action: "copy" });
      });

      describe("window answers", () => {
        const windowAnswer = (displayId: number): OverlayAnswer => ({
          kind: "window",
          mode: "window",
          action: "capture",
          displayId,
          windowId: "77",
          rect: { x: 100, y: 50, width: 640, height: 360 },
        });

        it("captures by window id without shadow, inside the overlay sequence", async () => {
          answer = windowAnswer(1);
          const out = await macProvider().capture({ mode: "frame", overlay: fake });
          expect(log).toEqual([
            "pick:frame",
            "hideAll",
            "settle",
            "runCli:-l 77 -o -x /tmp/x.png",
            "destroyAll",
          ]);
          expect(out).toEqual({ kind: "captured", png: PNG, mode: "window", action: "capture" });
        });

        /**
         * What `screencapture -l <gone id>` really does (checked on macOS 2026-10-18): prints
         * "could not create image from window", exits 1 and writes no file, so `execFile`
         * rejects.
         */
        const rejectWindowGrab = (): void => {
          runCli = vi.fn(async (_cmd: string, args: string[]) => {
            log.push(`runCli:${args.join(" ")}`);
            if (args[0] === "-l") throw new Error("Command failed: screencapture exited 1");
          });
        };

        it("a -l grab that exits non-zero retries once with -R at the global rect of the answer's display", async () => {
          const offset = display(3, 1440, 0, 1920, 1080);
          displays = [main, offset];
          answer = windowAnswer(3);
          rejectWindowGrab();
          vi.spyOn(console, "warn").mockImplementation(() => {});
          const out = await macProvider().capture({ mode: "window", overlay: fake });
          expect(vi.mocked(runCli).mock.calls.map(([, args]) => args.join(" "))).toEqual([
            "-l 77 -o -x /tmp/x.png",
            "-R 1540,50,640,360 -x /tmp/x.png",
          ]);
          expect(out).toEqual({ kind: "captured", png: PNG, mode: "window", action: "capture" });
          expect(fake.destroyAll).toHaveBeenCalledTimes(1);
        });

        it("a -l grab that exits 0 without a file also retries with -R", async () => {
          answer = windowAnswer(1);
          let calls = 0;
          fileExists = vi.fn(async () => ++calls > 1);
          vi.spyOn(console, "warn").mockImplementation(() => {});
          const out = await macProvider().capture({ mode: "window", overlay: fake });
          expect(runCli).toHaveBeenCalledTimes(2);
          expect(out.kind).toBe("captured");
        });

        it("answers cancelled when the -R retry also leaves no file", async () => {
          answer = windowAnswer(1);
          rejectWindowGrab();
          fileExists = vi.fn(async () => false);
          vi.spyOn(console, "warn").mockImplementation(() => {});
          const out = await macProvider().capture({ mode: "window", overlay: fake });
          expect(out).toEqual({ kind: "cancelled" });
          expect(runCli).toHaveBeenCalledTimes(2);
          expect(fake.destroyAll).toHaveBeenCalledTimes(1);
        });
      });

      it("never shells out to Apple's interactive picker (-i)", async () => {
        displays = [main, left];
        answer = { kind: "display", mode: "screen", action: "capture", displayId: 1 };
        await macProvider().capture({ mode: "frame", overlay: fake });
        for (const [, args] of vi.mocked(runCli).mock.calls) expect(args).not.toContain("-i");
      });
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
      answer = { kind: "display", mode: "screen", action: "capture", displayId: 2 };
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
      answer = { kind: "display", mode: "screen", action: "capture", displayId: 2 };
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
    return new WindowsProvider(deps, CAPTURE_MODES);
  };

  it("serves Frame, Window and Screen when Window is enabled", () => {
    expect(MODES.map((m) => provider().supports(m))).toEqual([true, true, true]);
  });

  it("screen with one display in the record intent records it without an overlay", async () => {
    const out = await provider().capture({ mode: "screen", overlay: fake, intent: "record" });
    expect(fake.pick).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "record", start: true, displayId: 1, rect: null });
    expect(log).not.toContain("getSources");
  });

  it("frame: pick, hide, capture, destroy, in that order, cropped in physical pixels", async () => {
    answer = {
      kind: "rect",
      mode: "frame",
      action: "capture",
      displayId: 1,
      rect: { x: 100, y: 50, width: 640, height: 360 },
    };
    const out = await provider().capture({ mode: "frame", overlay: fake });
    expect(log).toEqual(["pick:frame", "hideAll", "settle", "getSources", "destroyAll"]);
    expect(crops).toEqual([{ x: 100, y: 50, width: 640, height: 360 }]);
    expect(out).toEqual({
      kind: "captured",
      png: PNG("one-crop"),
      mode: "frame",
      action: "capture",
    });
  });

  it("captures by the overlay's answer: a Frame request answered with a display takes the whole display", async () => {
    displays = [primary, hiDpi];
    sources = [{ display_id: "2", thumbnail: image({ width: 1920, height: 1080 }, "two") }];
    answer = { kind: "display", mode: "screen", action: "capture", displayId: 2 };
    const out = await provider().capture({ mode: "frame", overlay: fake });
    expect(crops).toEqual([]);
    expect(out).toEqual({ kind: "captured", png: PNG("two"), mode: "screen", action: "capture" });
  });

  describe("window answers", () => {
    const winAnswer = (displayId: number, windowId = "9"): OverlayAnswer => ({
      kind: "window",
      mode: "window",
      action: "capture",
      displayId,
      windowId,
      rect: { x: 100, y: 50, width: 200, height: 100 },
    });
    let types: string[][];
    const windowsProvider = (): WindowsProvider =>
      new WindowsProvider({
        getSources: async (options) => {
          types.push([...options.types]);
          requested.push(options.thumbnailSize);
          return options.types[0] === "window" ? windowSources : sources;
        },
        getDisplays: async () => displays,
        settle: () => settle(),
      });
    let windowSources: ScreenSource[];
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      types = [];
      windowSources = [];
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("asks for the window source at the window's physical size and matches by id prefix", async () => {
      displays = [hiDpi];
      answer = winAnswer(2);
      windowSources = [
        {
          id: "window:99:0",
          display_id: "",
          thumbnail: image({ width: 300, height: 150 }, "other"),
        },
        { id: "window:9:0", display_id: "", thumbnail: image({ width: 300, height: 150 }, "mine") },
      ];
      const out = await windowsProvider().capture({ mode: "window", overlay: fake });
      expect(types).toEqual([["window"]]);
      expect(requested).toEqual([{ width: 300, height: 150 }]);
      expect(crops).toEqual([]);
      expect(out).toEqual({
        kind: "captured",
        png: PNG("mine"),
        mode: "window",
        action: "capture",
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it("asks for a window spanning two displays at its whole size, not the clamped rect (failure 9)", async () => {
      displays = [primary, hiDpi];
      // Clamped to display 2 the window is 200 × 100 DIP; whole, it is 900 × 400 DIP.
      answer = { ...winAnswer(2), fullSize: { width: 900, height: 400 } } as OverlayAnswer;
      windowSources = [
        {
          id: "window:9:0",
          display_id: "",
          thumbnail: image({ width: 1350, height: 600 }, "whole"),
        },
      ];
      const out = await windowsProvider().capture({ mode: "window", overlay: fake });
      expect(requested).toEqual([{ width: 1350, height: 600 }]);
      expect(out).toMatchObject({ kind: "captured", png: PNG("whole") });
    });

    it("ignores a source with the same name but another id (id 9 is not 90)", async () => {
      answer = winAnswer(1);
      windowSources = [
        { id: "window:90:0", display_id: "", thumbnail: image({ width: 200, height: 100 }, "w90") },
      ];
      const out = await windowsProvider().capture({ mode: "window", overlay: fake });
      expect(out).toMatchObject({ kind: "captured", png: PNG("one-crop") });
      expect(types).toEqual([["window"], ["screen"]]);
    });

    it("an empty thumbnail falls back to the display crop and warns once", async () => {
      answer = winAnswer(1);
      windowSources = [
        { id: "window:9:0", display_id: "", thumbnail: image({ width: 0, height: 0 }, "empty") },
      ];
      const out = await windowsProvider().capture({ mode: "window", overlay: fake });
      expect(crops).toEqual([{ x: 100, y: 50, width: 200, height: 100 }]);
      expect(out).toMatchObject({ kind: "captured", mode: "window" });
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("a window answer with no window and no display source is cancelled", async () => {
      answer = winAnswer(1);
      sources = [];
      const out = await windowsProvider().capture({ mode: "window", overlay: fake });
      expect(out).toEqual({ kind: "cancelled" });
      expect(fake.destroyAll).toHaveBeenCalledTimes(1);
    });

    it("a window spanning two displays: by-id returns the whole thumbnail untouched", async () => {
      displays = [primary, hiDpi];
      answer = {
        ...winAnswer(1),
        rect: { x: 1800, y: 100, width: 400, height: 300 },
      } as OverlayAnswer;
      windowSources = [
        {
          id: "window:9:0",
          display_id: "",
          thumbnail: image({ width: 400, height: 300 }, "whole"),
        },
      ];
      const out = await windowsProvider().capture({ mode: "window", overlay: fake });
      expect(crops).toEqual([]);
      expect(out).toMatchObject({ png: PNG("whole") });
    });

    it("the fallback clamps the crop to the answer's display, never stitching", async () => {
      displays = [primary, hiDpi];
      answer = {
        ...winAnswer(1),
        rect: { x: 1800, y: 100, width: 400, height: 300 },
      } as OverlayAnswer;
      await windowsProvider().capture({ mode: "window", overlay: fake });
      // 1920 wide display: the part past x = 1920 is dropped (width 120, not 400).
      expect(crops).toEqual([{ x: 1800, y: 100, width: 120, height: 300 }]);
    });
  });

  it("frame on a 150% display crops 150 physical px for a 100 DIP frame", async () => {
    displays = [primary, hiDpi];
    sources = [{ display_id: "2", thumbnail: image({ width: 1920, height: 1080 }, "two") }];
    answer = {
      kind: "rect",
      mode: "frame",
      action: "capture",
      displayId: 2,
      rect: { x: 0, y: 0, width: 100, height: 100 },
    };
    await provider().capture({ mode: "frame", overlay: fake });
    expect(requested).toEqual([{ width: 1920, height: 1080 }]);
    expect(crops).toEqual([{ x: 0, y: 0, width: 150, height: 150 }]);
  });

  it("an image smaller than requested still crops the right region", async () => {
    displays = [primary, hiDpi];
    // Asked for 1920x1080, got 1280x720 (scale 1.0): 100 DIP is now 100 px, not 150.
    sources = [{ display_id: "2", thumbnail: image({ width: 1280, height: 720 }, "two") }];
    answer = {
      kind: "rect",
      mode: "frame",
      action: "capture",
      displayId: 2,
      rect: { x: 640, y: 360, width: 100, height: 100 },
    };
    await provider().capture({ mode: "frame", overlay: fake });
    expect(crops).toEqual([{ x: 640, y: 360, width: 100, height: 100 }]);
  });

  it("matches the source by display_id when there are two", async () => {
    displays = [primary, hiDpi];
    sources = [
      { display_id: "1", thumbnail: image({ width: 1920, height: 1080 }, "one") },
      { display_id: "2", thumbnail: image({ width: 1920, height: 1080 }, "two") },
    ];
    answer = { kind: "display", mode: "screen", action: "capture", displayId: 2 };
    const out = await provider().capture({ mode: "screen", overlay: fake });
    expect(out).toEqual({ kind: "captured", png: PNG("two"), mode: "screen", action: "capture" });
    expect(crops).toEqual([]); // Screen takes the whole thumbnail
  });

  it("falls back to the lone source when its display_id is empty", async () => {
    sources = [{ display_id: "", thumbnail: image({ width: 1920, height: 1080 }, "lone") }];
    const out = await provider().capture({ mode: "screen", overlay: fake });
    expect(out).toEqual({ kind: "captured", png: PNG("lone"), mode: "screen", action: "capture" });
  });

  it("does not guess among several sources when none matches", async () => {
    displays = [primary, hiDpi];
    sources = [
      { display_id: "7", thumbnail: image({ width: 1, height: 1 }, "a") },
      { display_id: "8", thumbnail: image({ width: 1, height: 1 }, "b") },
    ];
    answer = { kind: "display", mode: "screen", action: "capture", displayId: 2 };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await provider().capture({ mode: "screen", overlay: fake })).toEqual({
      kind: "cancelled",
    });
  });

  it("screen with one display skips the overlay, settles, hides and captures", async () => {
    const out = await provider().capture({ mode: "screen", overlay: fake });
    expect(fake.pick).not.toHaveBeenCalled();
    expect(log).toEqual(["settle", "hideAll", "getSources", "destroyAll"]);
    expect(out).toEqual({ kind: "captured", png: PNG("one"), mode: "screen", action: "capture" });
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
    answer = { kind: "display", mode: "screen", action: "capture", displayId: 2 };
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
    expect(await provider().capture({ mode: "frame", overlay: fake })).toEqual({
      kind: "cancelled",
    });
    expect(log).toEqual(["pick:frame", "destroyAll"]);
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
  const realDeps = undefined; // the providers' default deps

  it("Mac and Windows serve every enabled mode; others serve nothing", () => {
    const mac = new MacProvider(realDeps, CAPTURE_MODES);
    expect(MODES.map((m) => mac.supports(m))).toEqual([true, true, true]);
    expect(new UnsupportedProvider().supports()).toBe(false);
  });

  it("lists the supported modes for the renderer when Window is enabled", () => {
    expect(new MacProvider(realDeps, CAPTURE_MODES).supportedModes()).toEqual([
      "frame",
      "window",
      "screen",
    ]);
    expect(new WindowsProvider(realDeps, CAPTURE_MODES).supportedModes()).toEqual([
      "frame",
      "window",
      "screen",
    ]);
    expect(new UnsupportedProvider().supportedModes()).toEqual([]);
  });

  it("with the flag as shipped (Window off), every provider reports Frame and Screen only", () => {
    for (const provider of [new MacProvider(), new WindowsProvider()]) {
      expect(provider.supportedModes()).toEqual(["frame", "screen"]);
      expect(provider.supports("window")).toBe(false);
      expect(provider.supports("frame")).toBe(true);
      expect(provider.supports("screen")).toBe(true);
    }
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
