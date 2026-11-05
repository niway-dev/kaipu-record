import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NATIVE_CAPTURE_CHANNELS as channels } from "../../../shared/native-capture";
const fake = vi.hoisted(() => ({
  sources: [] as { id: string; display_id: string }[],
  displays: [] as { id: number; bounds: { x: number; y: number; width: number; height: number } }[],
  hubArea: undefined as object | null | undefined,
  handlers: new Map<string, (...args: any[]) => any>(),
  validate: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { on: vi.fn(), getAppPath: () => "/app" },
  desktopCapturer: { getSources: async () => fake.sources },
  screen: { getAllDisplays: () => fake.displays },
  ipcMain: { handle: (name: string, handler: any) => fake.handlers.set(name, handler) },
}));
vi.mock("./session", () => ({
  nativeHelperPath: () => "/helper",
  validateNativeHelper: fake.validate,
  spawnNativeVideo: fake.spawn,
}));
import { registerNativeCaptureTransport } from "./ipc";

describe("native IPC session ownership", () => {
  let contents: EventEmitter & { id: number; mainFrame: object; isDestroyed: () => boolean };
  let reader: {
    next: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  const call = (method: keyof typeof channels, sender = contents) =>
    fake.handlers.get(channels[method])!(
      { sender, senderFrame: sender.mainFrame },
      { sourceId: "screen:3:0", width: 320, height: 180, frameRate: 30, videoBitrate: 1000000 },
    );
  beforeEach(() => {
    vi.clearAllMocks();
    fake.handlers.clear();
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.spyOn(process, "argv", "get").mockReturnValue([
      "electron",
      "--experimental-native-recording",
    ]);
    contents = Object.assign(new EventEmitter(), {
      id: 1,
      mainFrame: {},
      isDestroyed: () => false,
    });
    reader = { next: vi.fn(), stop: vi.fn(), cancel: vi.fn() };
    fake.spawn.mockReturnValue(reader);
    fake.validate.mockResolvedValue(undefined);
    fake.sources = [
      { id: "screen:3:0", display_id: "3" },
      { id: "screen:4:0", display_id: "4" },
    ];
    fake.displays = [
      { id: 3, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: 4, bounds: { x: 1920, y: 0, width: 1280, height: 720 } },
    ];
    registerNativeCaptureTransport(
      () => contents as any,
      () => fake.hubArea as any,
    );
  });
  it("rejects another sender and subframe", async () => {
    await expect(
      call("open", Object.assign(new EventEmitter(), { mainFrame: {} }) as any),
    ).rejects.toThrow("Unauthorized");
    await expect(
      fake.handlers.get(channels.open)!({ sender: contents, senderFrame: {} }),
    ).rejects.toThrow("Unauthorized");
    expect(fake.spawn).not.toHaveBeenCalled();
  });
  it("keeps hash routes and subframes alive; cancels cross-document main navigation", async () => {
    await call("open");
    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    expect(reader.cancel).not.toHaveBeenCalled();
    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(contents.listenerCount("did-start-navigation")).toBe(0);
  });
  it("rejects double open, detaches and allows another session after read failure", async () => {
    await call("open");
    await expect(call("open")).rejects.toThrow("already open");
    reader.next.mockRejectedValueOnce(new Error("native failed"));
    await expect(call("next")).rejects.toThrow("native failed");
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(contents.listenerCount("destroyed")).toBe(0);
    await call("open");
    expect(fake.spawn).toHaveBeenCalledTimes(2);
  });
  it("does not spawn after cancel invalidates an open awaiting capability", async () => {
    let resolve!: () => void;
    fake.validate.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const opening = call("open");
    await call("cancel");
    resolve();
    await expect(opening).rejects.toThrow("unavailable");
    expect(fake.spawn).not.toHaveBeenCalled();
  });
  it("opens only when the flag or the command-line switch asks for it", async () => {
    vi.spyOn(process, "argv", "get").mockReturnValue(["electron"]);
    const capability = (requested?: boolean) =>
      fake.handlers.get(channels.capability)!(
        { sender: contents, senderFrame: contents.mainFrame },
        requested,
      );
    expect(await capability()).toMatchObject({ transportAvailable: false });
    await expect(call("open")).rejects.toThrow("unavailable");
    expect(await capability(true)).toMatchObject({ transportAvailable: true });
    await call("open");
    expect(fake.spawn).toHaveBeenCalledOnce();
    await call("cancel");
    // The flag turned off before the next take: no helper.
    expect(await capability(false)).toMatchObject({ transportAvailable: false });
    await expect(call("open")).rejects.toThrow("unavailable");
    expect(fake.spawn).toHaveBeenCalledOnce();
  });
  it("does not spawn when the page reloads while open is still awaiting", async () => {
    let resolve!: () => void;
    fake.validate.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const opening = call("open");
    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    resolve();
    await expect(opening).rejects.toThrow("unavailable");
    expect(fake.spawn).not.toHaveBeenCalled();
    expect(contents.listenerCount("did-start-navigation")).toBe(0);
  });
  it("hands the renderer's request to the helper unchanged", async () => {
    await call("open");
    expect(fake.spawn).toHaveBeenCalledWith("/helper", {
      displayId: 3,
      width: 320,
      height: 180,
      frameRate: 30,
      videoBitrate: 1000000,
    });
  });
  const openWith = (request: object, hub?: object | null) => {
    // By default the hub holds the very area the renderer sends.
    fake.hubArea = hub === undefined ? (request as { area?: object }).area : hub;
    return openRaw(request);
  };
  const openRaw = (request: object) =>
    fake.handlers.get(channels.open)!(
      { sender: contents, senderFrame: contents.mainFrame },
      request,
    );
  const video = { width: 640, height: 360, frameRate: 30, videoBitrate: 1000000 };
  const area = (over: object = {}) => ({
    displayId: 3,
    displaySize: { width: 1920, height: 1080 },
    rect: { x: 320, y: 180, width: 640, height: 360 },
    ...over,
  });
  it("resolves an area to a source rect on its display and refuses an area on another display", async () => {
    await openWith({ sourceId: "screen:3:0", area: area(), ...video });
    expect(fake.spawn).toHaveBeenCalledWith("/helper", {
      displayId: 3,
      ...video,
      sourceRect: { x: 320, y: 180, width: 640, height: 360 },
    });
    await call("cancel");
    // Area drawn on display 4, source says display 3.
    await expect(
      openWith({ sourceId: "screen:3:0", area: area({ displayId: 4 }), ...video }),
    ).rejects.toThrow();
    // Below the minimum size.
    await expect(
      openWith({
        sourceId: "screen:3:0",
        area: area({ rect: { x: 0, y: 0, width: 2, height: 2 } }),
        ...video,
      }),
    ).rejects.toThrow();
    expect(fake.spawn).toHaveBeenCalledOnce();
  });
  it("clamps an area to its display and ignores the renderer's displaySize", async () => {
    await openWith({
      sourceId: "screen:4:0",
      area: area({
        displayId: 4,
        displaySize: { width: 9999, height: 9999 },
        rect: { x: 1000, y: 600, width: 800, height: 400 },
      }),
      ...video,
    });
    expect(fake.spawn).toHaveBeenCalledWith(
      "/helper",
      expect.objectContaining({
        displayId: 4,
        sourceRect: { x: 1000, y: 600, width: 280, height: 120 },
      }),
    );
  });
  it("sends no source rect for a whole display, and a null area counts as none", async () => {
    await openWith({ sourceId: "screen:3:0", area: null, ...video });
    expect(fake.spawn.mock.calls[0]![1]).toEqual({ displayId: 3, ...video });
  });
  it("drops a displayId or sourceRect the renderer sends; only main sets them", async () => {
    await openWith({
      sourceId: "screen:3:0",
      displayId: 4,
      sourceRect: { x: 1, y: 1, width: 5, height: 5 },
      ...video,
    });
    expect(fake.spawn.mock.calls[0]![1]).toEqual({ displayId: 3, ...video });
  });
  it("uses the hub's area, and refuses a renderer area that differs from it", async () => {
    await expect(
      openWith(
        { sourceId: "screen:3:0", area: area(), ...video },
        area({ rect: { x: 0, y: 0, width: 640, height: 360 } }),
      ),
    ).rejects.toThrow();
    await expect(
      openWith({ sourceId: "screen:3:0", area: area(), ...video }, null),
    ).rejects.toThrow();
    expect(fake.spawn).not.toHaveBeenCalled();
  });
});
