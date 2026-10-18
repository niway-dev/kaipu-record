import type { Display } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRect } from "@shared/types/screenshot-capture";
import {
  createWindowLister,
  decodeNativeWindowHandle,
  MacWindowLister,
  NoopWindowLister,
  parseMacWindowList,
  parseWindowsWindowLines,
  type ListerDeps,
  type RawWindow,
  selfWindowHandles,
  toListedWindows,
  WINDOW_LIST_TIMEOUT_MS,
  WindowsWindowLister,
} from "./window-lister";

function display(id: number, x: number, width = 1000, height = 800, scaleFactor = 2): Display {
  const bounds = { x, y: 0, width, height };
  return { id, bounds, workArea: bounds, scaleFactor } as Display;
}

function raw(overrides: Partial<RawWindow> = {}): RawWindow {
  return {
    id: "10",
    title: "Notes",
    ownerName: "Notes",
    pid: 500,
    bounds: { x: 100, y: 100, width: 400, height: 300 },
    layer: 0,
    ...overrides,
  };
}

const noSelf = { pids: [], handles: [] };
const primary = display(1, 0);

describe("toListedWindows", () => {
  it("keeps a plain window, display-relative, in the display holding it", () => {
    expect(toListedWindows([raw()], [primary], noSelf)).toEqual([
      {
        id: "10",
        title: "Notes",
        ownerName: "Notes",
        displayId: 1,
        rect: { x: 100, y: 100, width: 400, height: 300 },
      },
    ]);
  });

  it("drops windows owned by our own pid", () => {
    const list = toListedWindows(
      [raw({ id: "1", pid: 42 }), raw({ id: "2", pid: 500 })],
      [primary],
      { pids: [42], handles: [] },
    );
    expect(list.map((w) => w.id)).toEqual(["2"]);
  });

  it("drops windows whose handle is one of ours (Windows HWND)", () => {
    const list = toListedWindows([raw({ id: "132456" }), raw({ id: "777" })], [primary], {
      pids: [],
      handles: ["132456"],
    });
    expect(list.map((w) => w.id)).toEqual(["777"]);
  });

  it("drops tool windows, cloaked windows and invisible windows", () => {
    const list = toListedWindows(
      [
        raw({ id: "tool", exStyle: 0x80 | 0x08 }),
        raw({ id: "cloaked", cloaked: true }),
        raw({ id: "hidden", visible: false }),
        raw({ id: "app", exStyle: 0x100, cloaked: false, visible: true }),
      ],
      [primary],
      noSelf,
    );
    expect(list.map((w) => w.id)).toEqual(["app"]);
  });

  it("drops non-zero layers (menu bar, Dock, overlays on macOS)", () => {
    const list = toListedWindows(
      [raw({ id: "menubar", layer: 24 }), raw({ id: "dock", layer: 20 }), raw({ id: "app" })],
      [primary],
      noSelf,
    );
    expect(list.map((w) => w.id)).toEqual(["app"]);
  });

  it("drops windows under 50 x 50 DIP in either dimension", () => {
    const list = toListedWindows(
      [
        raw({ id: "tiny", bounds: { x: 0, y: 0, width: 49, height: 400 } }),
        raw({ id: "strip", bounds: { x: 0, y: 0, width: 400, height: 49 } }),
        raw({ id: "ok", bounds: { x: 0, y: 0, width: 50, height: 50 } }),
      ],
      [primary],
      noSelf,
    );
    expect(list.map((w) => w.id)).toEqual(["ok"]);
  });

  it("uses the owner name as title when the title is empty", () => {
    const [listed] = toListedWindows([raw({ title: "", ownerName: "Safari" })], [primary], noSelf);
    expect(listed?.title).toBe("Safari");
    expect(listed?.ownerName).toBe("Safari");
  });

  it("converts physical pixels to DIP with the injected converter (150 % display)", () => {
    const at150 = display(1, 0, 1280, 720, 1.5);
    const toDip = (r: CaptureRect): CaptureRect => ({
      x: r.x / 1.5,
      y: r.y / 1.5,
      width: r.width / 1.5,
      height: r.height / 1.5,
    });
    const list = toListedWindows(
      [
        raw({ bounds: { x: 300, y: 150, width: 900, height: 600 } }),
        // 60 px physical is 40 DIP: the size filter runs after conversion.
        raw({ id: "small", bounds: { x: 0, y: 0, width: 60, height: 600 } }),
      ],
      [at150],
      noSelf,
      toDip,
    );
    expect(list).toEqual([
      expect.objectContaining({ id: "10", rect: { x: 200, y: 100, width: 600, height: 400 } }),
    ]);
  });

  it("assigns a window spanning two displays to the one holding its centre and clamps it", () => {
    const left = display(2, -1920, 1920, 1080);
    const main = display(1, 0, 1512, 982);
    // x -1000..+400: centre at -300, which is on the left display.
    const spanning = raw({ bounds: { x: -1000, y: 100, width: 1400, height: 500 } });
    const [listed] = toListedWindows([spanning], [main, left], noSelf);
    expect(listed?.displayId).toBe(2);
    expect(listed?.rect).toEqual({ x: 920, y: 100, width: 1000, height: 500 });
  });

  it("assigns by largest overlap when the centre is on no display", () => {
    const main = display(1, 0, 1000, 800);
    const right = display(2, 1200, 1000, 800);
    // Both centres sit in the 1000..1200 gap; the overlap decides.
    const mostlyLeft = raw({ bounds: { x: 750, y: 0, width: 600, height: 400 } }); // 250 vs 150
    const mostlyRight = raw({ bounds: { x: 850, y: 0, width: 600, height: 400 } }); // 150 vs 250
    expect(toListedWindows([mostlyLeft], [main, right], noSelf)[0]).toEqual(
      expect.objectContaining({ displayId: 1, rect: { x: 750, y: 0, width: 250, height: 400 } }),
    );
    expect(toListedWindows([mostlyRight], [main, right], noSelf)[0]).toEqual(
      expect.objectContaining({ displayId: 2, rect: { x: 0, y: 0, width: 250, height: 400 } }),
    );
  });

  it("falls back to the primary display and drops a window that is on no display", () => {
    const right = display(2, 1000, 1000, 800);
    const offscreen = raw({ bounds: { x: 5000, y: 5000, width: 400, height: 300 } });
    expect(toListedWindows([offscreen], [primary, right], noSelf)).toEqual([]);
  });

  it("clamps a window that runs off the top-left of its display", () => {
    const [listed] = toListedWindows(
      [raw({ bounds: { x: -50, y: -20, width: 400, height: 300 } })],
      [primary],
      noSelf,
    );
    expect(listed?.rect).toEqual({ x: 0, y: 0, width: 350, height: 280 });
  });

  it("preserves the front-to-back order", () => {
    const list = toListedWindows(
      [raw({ id: "front" }), raw({ id: "middle" }), raw({ id: "back" })],
      [primary],
      noSelf,
    );
    expect(list.map((w) => w.id)).toEqual(["front", "middle", "back"]);
  });

  it("returns nothing when there are no displays", () => {
    expect(toListedWindows([raw()], [], noSelf)).toEqual([]);
  });
});

describe("parseMacWindowList", () => {
  // Shape of the real probe on the development Mac, 2026-10-17.
  const probe =
    '[{"id":"203","title":"Menubar","ownerName":"Window Server","pid":601,"layer":24,"bounds":{"x":0,"y":0,"width":1512,"height":33}},' +
    '{"id":"213","title":"","ownerName":"Ghostty","pid":1226,"layer":0,"bounds":{"x":0,"y":33,"width":1512,"height":68}},' +
    '{"id":"212","title":"kaipu","ownerName":"Ghostty","pid":1226,"layer":0,"bounds":{"x":0,"y":69,"width":1512,"height":913}}]\n';

  it("parses the probe output shape", () => {
    expect(parseMacWindowList(probe)).toEqual([
      {
        id: "203",
        title: "Menubar",
        ownerName: "Window Server",
        pid: 601,
        layer: 24,
        bounds: { x: 0, y: 0, width: 1512, height: 33 },
      },
      {
        id: "213",
        title: "",
        ownerName: "Ghostty",
        pid: 1226,
        layer: 0,
        bounds: { x: 0, y: 33, width: 1512, height: 68 },
      },
      {
        id: "212",
        title: "kaipu",
        ownerName: "Ghostty",
        pid: 1226,
        layer: 0,
        bounds: { x: 0, y: 69, width: 1512, height: 913 },
      },
    ]);
  });

  it("skips malformed entries and keeps the rest", () => {
    const text = JSON.stringify([
      { id: "1", title: "", ownerName: "A", pid: 1, layer: 0 },
      null,
      {
        id: "2",
        title: "B",
        ownerName: "B",
        pid: 2,
        layer: 0,
        bounds: { x: 0, y: 0, width: 1, height: "x" },
      },
      {
        id: "3",
        title: "C",
        ownerName: "C",
        pid: 3,
        layer: 0,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    ]);
    expect(parseMacWindowList(text).map((w) => w.id)).toEqual(["3"]);
  });

  it("throws on output that is not a JSON array", () => {
    expect(() => parseMacWindowList("execution error: -1743")).toThrow();
    expect(() => parseMacWindowList('{"id":"1"}')).toThrow();
  });
});

describe("parseWindowsWindowLines", () => {
  const line = (id: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      id,
      title: `Window ${id}`,
      ownerName: "notepad",
      pid: 900,
      exStyle: 256,
      cloaked: false,
      visible: true,
      bounds: { x: -8, y: 0, width: 1936, height: 1048 },
      ...extra,
    });

  it("parses one object per line, skipping blank lines and a trailing newline", () => {
    const text = `${line("65802")}\r\n\r\n${line("131340", { cloaked: true })}\n`;
    const list = parseWindowsWindowLines(text);
    expect(list).toEqual([
      {
        id: "65802",
        title: "Window 65802",
        ownerName: "notepad",
        pid: 900,
        exStyle: 256,
        cloaked: false,
        visible: true,
        bounds: { x: -8, y: 0, width: 1936, height: 1048 },
      },
      expect.objectContaining({ id: "131340", cloaked: true }),
    ]);
  });

  it("ignores malformed lines", () => {
    const text = [
      "WARNING: something PowerShell printed",
      line("1"),
      "{not json",
      JSON.stringify({ id: "2", title: "no bounds", ownerName: "", pid: 1 }),
      line("3"),
    ].join("\n");
    expect(parseWindowsWindowLines(text).map((w) => w.id)).toEqual(["1", "3"]);
  });

  it("returns an empty list for empty output", () => {
    expect(parseWindowsWindowLines("")).toEqual([]);
    expect(parseWindowsWindowLines("\r\n")).toEqual([]);
  });
});

describe("listers", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let debug: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    debug = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const self = async () => ({ pids: [42], handles: [] });

  it("macOS: runs osascript JXA with the inline script and filters the result", async () => {
    const runCommand = vi.fn(async () =>
      JSON.stringify([
        raw({ id: "menubar", layer: 24 }),
        raw({ id: "own", pid: 42 }),
        raw({ id: "app", title: "" }),
      ]),
    );
    const lister = new MacWindowLister({ runCommand, getSelf: self });
    const list = await lister.list([primary]);

    expect(list).toEqual([expect.objectContaining({ id: "app", title: "Notes" })]);
    expect(runCommand).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = runCommand.mock.calls[0] as unknown as [
      string,
      string[],
      { timeoutMs: number },
    ];
    expect(cmd).toBe("osascript");
    expect(args.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
    expect(args[3]).toContain("CGWindowListCopyWindowInfo");
    expect(options.timeoutMs).toBe(WINDOW_LIST_TIMEOUT_MS);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("[window-lister]"));
  });

  it("Windows: runs PowerShell, converts physical pixels to DIP and drops our HWNDs", async () => {
    const runCommand = vi.fn(
      async () =>
        [
          JSON.stringify(
            raw({ id: "111", pid: 7, bounds: { x: 0, y: 0, width: 600, height: 300 } }),
          ),
          JSON.stringify(raw({ id: "222", pid: 7 })),
          JSON.stringify(raw({ id: "333", pid: 7, exStyle: 0x80 })),
        ].join("\r\n") + "\r\n",
    );
    const screenToDip = vi.fn((r: CaptureRect) => ({
      x: r.x / 1.5,
      y: r.y / 1.5,
      width: r.width / 1.5,
      height: r.height / 1.5,
    }));
    const lister = new WindowsWindowLister({
      runCommand,
      getSelf: async () => ({ pids: [], handles: ["222"] }),
      screenToDip,
    });
    const list = await lister.list([display(1, 0, 1280, 720, 1.5)]);

    expect(list).toEqual([
      expect.objectContaining({ id: "111", rect: { x: 0, y: 0, width: 400, height: 200 } }),
    ]);
    const [cmd, args] = runCommand.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe("powershell");
    expect(args).toEqual(
      expect.arrayContaining(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]),
    );
    // The script travels base64 UTF-16LE so no quote in it is mangled on the command line.
    const encoded = args[args.indexOf("-EncodedCommand") + 1] ?? "";
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    expect(script).toContain("EnumWindows");
    expect(script).toContain("DwmGetWindowAttribute");
  });

  it.each([
    ["macOS", (deps: ListerDeps) => new MacWindowLister(deps)],
    ["Windows", (deps: ListerDeps) => new WindowsWindowLister({ ...deps, screenToDip: (r) => r })],
  ])("%s: a runCommand that throws resolves [] and warns once", async (_name, make) => {
    const lister = make({
      runCommand: async () => {
        throw new Error("spawn ENOENT");
      },
      getSelf: self,
    });
    await expect(lister.list([primary])).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a runCommand that never answers resolves [] after the timeout and warns once", async () => {
    vi.useFakeTimers();
    const lister = new MacWindowLister({
      runCommand: () => new Promise<string>(() => {}),
      getSelf: self,
    });
    const pending = lister.list([primary]);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(WINDOW_LIST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("unparseable macOS output resolves [] and warns once", async () => {
    const lister = new MacWindowLister({
      runCommand: async () => "execution error: Not authorized (-1743)",
      getSelf: self,
    });
    await expect(lister.list([primary])).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("createWindowLister picks by platform, and Linux gets a no-op", async () => {
    expect(createWindowLister("darwin")).toBeInstanceOf(MacWindowLister);
    expect(createWindowLister("win32")).toBeInstanceOf(WindowsWindowLister);
    const linux = createWindowLister("linux");
    expect(linux).toBeInstanceOf(NoopWindowLister);
    await expect(linux.list([primary])).resolves.toEqual([]);
  });
});

describe("native window handles", () => {
  it("decodes a 64-bit Windows HWND buffer (little-endian) as decimal", () => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(0x2_0a4cn);
    expect(decodeNativeWindowHandle(buf, "win32")).toBe(String(0x2_0a4c));
  });

  it("decodes a 32-bit Windows HWND buffer", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(65802);
    expect(decodeNativeWindowHandle(buf, "win32")).toBe("65802");
  });

  it("returns null on macOS: the buffer is an NSView pointer, not a CGWindowID", () => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(0x6000_0123_4560n);
    expect(decodeNativeWindowHandle(buf, "darwin")).toBeNull();
  });

  it("selfWindowHandles collects HWNDs on Windows and nothing on macOS", () => {
    const win = (n: number) => {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(BigInt(n));
      return { getNativeWindowHandle: () => buf };
    };
    expect(selfWindowHandles([win(11), win(22)], "win32")).toEqual(["11", "22"]);
    expect(selfWindowHandles([win(11)], "darwin")).toEqual([]);
  });
});
