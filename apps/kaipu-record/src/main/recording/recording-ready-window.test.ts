import { describe, expect, it, vi } from "vitest";
import type { Rectangle } from "electron";
import { IPC_CHANNELS } from "@shared/types/ipc";
import type { RecordingReadyPayload } from "@shared/types/recording-ready";

vi.mock("electron", () => ({ BrowserWindow: class {}, ipcMain: {}, screen: {} }));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const {
  RecordingReadyWindow,
  readyWindowBounds,
  READY_WINDOW_WIDTH,
  READY_DEFAULT_CARD_HEIGHT,
  READY_WINDOW_PADDING,
} = await import("./recording-ready-window");

const PRIMARY = { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 957 } };
const EXTERNAL = { id: 2, workArea: { x: 1512, y: 0, width: 2560, height: 1415 } };

const FRESH: RecordingReadyPayload = {
  assetId: "asset-1",
  durationSeconds: 78,
  dimensions: { width: 2560, height: 1440 },
  sizeBytes: 4_000_000,
  canEdit: true,
};

class FakeWindow {
  webContents = { send: vi.fn() };
  setAlwaysOnTop = vi.fn();
  setContentProtection = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  setBounds = vi.fn();
  showInactive = vi.fn();
  hide = vi.fn();
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
  destroyed = false;
  isDestroyed = (): boolean => this.destroyed;
  closed: (() => void) | null = null;
  on = vi.fn((_event: "closed", listener: () => void) => {
    this.closed = listener;
  });
}

function setup(options: { recordedOn?: number | null; createFails?: boolean } = {}) {
  const listeners = new Map<string, (event: { sender: unknown }, payload?: unknown) => void>();
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
  const windows: FakeWindow[] = [];
  const created: Array<Record<string, unknown>> = [];
  const openInMain = vi.fn();
  const ready = new RecordingReadyWindow({
    createWindow: (opts) => {
      if (options.createFails) throw new Error("no window for you");
      created.push(opts as Record<string, unknown>);
      const window = new FakeWindow();
      windows.push(window);
      return window;
    },
    load: vi.fn(),
    ipc: {
      on: (channel, listener) => listeners.set(channel, listener),
      handle: (channel, listener) => handlers.set(channel, listener),
    },
    screen: {
      getAllDisplays: () => [PRIMARY, EXTERNAL],
      getCursorDisplay: () => PRIMARY,
    },
    platform: "darwin",
    recordingDisplayId: () => options.recordedOn ?? null,
    openInMain,
  });
  const window = (): FakeWindow => windows[windows.length - 1]!;
  const fromCard = (channel: string, payload?: unknown): void =>
    listeners.get(channel)?.({ sender: window().webContents }, payload);
  const cardReady = (): void => fromCard(IPC_CHANNELS.recordingReadyCardReady);
  const press = (action: unknown): void => fromCard(IPC_CHANNELS.recordingReadyAction, action);
  const askFromMainWindow = (payload: unknown): unknown =>
    handlers.get(IPC_CHANNELS.recordingReadyShow)?.({}, payload);
  return {
    ready,
    windows,
    created,
    window,
    openInMain,
    listeners,
    fromCard,
    cardReady,
    press,
    askFromMainWindow,
  };
}

describe("readyWindowBounds", () => {
  it("puts the card 18 DIP in from the top-right corner, its padding around it", () => {
    const bounds = readyWindowBounds(PRIMARY.workArea, 300);
    expect(bounds).toEqual({
      x: 1512 - READY_WINDOW_WIDTH - 2,
      y: 25 + 2,
      width: READY_WINDOW_WIDTH,
      height: 300 + 2 * READY_WINDOW_PADDING,
    });
  });

  it("never runs off a display narrower or shorter than the card", () => {
    const tiny: Rectangle = { x: -400, y: 0, width: 300, height: 200 };
    const bounds = readyWindowBounds(tiny, 500);
    expect(bounds.x).toBe(-400);
    expect(bounds.height).toBe(200);
  });
});

describe("RecordingReadyWindow", () => {
  it("creates a frameless, transparent, always-on-top panel that never takes focus by itself", () => {
    const { ready, created, window } = setup();
    expect(ready.show(FRESH)).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: "panel",
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      width: READY_WINDOW_WIDTH,
    });
    expect(window().setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
    // Kept out of the next recording and of screenshots.
    expect(window().setContentProtection).toHaveBeenCalledWith(true);
    // Nothing is shown before the card can paint.
    expect(window().showInactive).not.toHaveBeenCalled();
  });

  it("shows inactive on the recorded display once the card is ready, joining every Space", () => {
    const { ready, window, cardReady } = setup({ recordedOn: 2 });
    ready.show(FRESH);
    cardReady();
    expect(window().webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.recordingReadyPayload,
      FRESH,
    );
    expect(window().setBounds).toHaveBeenLastCalledWith(
      readyWindowBounds(EXTERNAL.workArea, READY_DEFAULT_CARD_HEIGHT),
    );
    expect(window().setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    expect(window().showInactive).toHaveBeenCalledTimes(1);
  });

  it("falls back to the display under the pointer when the take's display is unknown", () => {
    const { ready, window, cardReady } = setup({ recordedOn: 99 });
    ready.show(FRESH);
    cardReady();
    expect(window().setBounds).toHaveBeenLastCalledWith(
      readyWindowBounds(PRIMARY.workArea, READY_DEFAULT_CARD_HEIGHT),
    );
  });

  it("fits the window to the height the card reports", () => {
    const { ready, window, cardReady, fromCard } = setup();
    ready.show(FRESH);
    cardReady();
    fromCard(IPC_CHANNELS.recordingReadyResize, { height: 248.4 });
    expect(window().setBounds).toHaveBeenLastCalledWith(readyWindowBounds(PRIMARY.workArea, 248.4));
    // Malformed sizes are ignored.
    window().setBounds.mockClear();
    fromCard(IPC_CHANNELS.recordingReadyResize, { height: -1 });
    fromCard(IPC_CHANNELS.recordingReadyResize, { height: "tall" });
    expect(window().setBounds).not.toHaveBeenCalled();
  });

  it("a new recording replaces the card in the same window", () => {
    const { ready, windows, window, cardReady } = setup();
    ready.show(FRESH);
    cardReady();
    const next = { ...FRESH, assetId: "asset-2" };
    expect(ready.show(next)).toBe(true);
    expect(windows).toHaveLength(1);
    expect(window().webContents.send).toHaveBeenLastCalledWith(
      IPC_CHANNELS.recordingReadyPayload,
      next,
    );
  });

  it("is asked for by the main window through `recording-ready:show`, which validates", () => {
    const { askFromMainWindow, windows } = setup();
    expect(askFromMainWindow({ assetId: "" })).toBe(false);
    expect(windows).toHaveLength(0);
    expect(askFromMainWindow(FRESH)).toBe(true);
    expect(windows).toHaveLength(1);
  });

  it("answers false when the window cannot be created, so the page keeps its in-app card", () => {
    const { ready, askFromMainWindow } = setup({ createFails: true });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(ready.show(FRESH)).toBe(false);
    expect(askFromMainWindow(FRESH)).toBe(false);
    error.mockRestore();
  });

  it("✕ (and Escape, the same action) closes it and opens nothing", () => {
    const { ready, window, cardReady, press, openInMain } = setup();
    ready.show(FRESH);
    cardReady();
    press({ kind: "dismiss" });
    expect(window().hide).toHaveBeenCalledTimes(1);
    expect(window().setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(false, {
      visibleOnFullScreen: false,
      skipTransformProcessType: true,
    });
    expect(openInMain).not.toHaveBeenCalled();
    // Closed: a late press does nothing.
    press({ kind: "open" });
    expect(openInMain).not.toHaveBeenCalled();
  });

  it.each([
    [
      { kind: "pick", destination: "youtube" },
      { target: "prepare", assetId: "asset-1", destination: "youtube" },
    ],
    [
      { kind: "pick", destination: "vertical" },
      { target: "prepare", assetId: "asset-1", destination: "vertical" },
    ],
    [
      { kind: "pick", destination: null },
      { target: "prepare", assetId: "asset-1", destination: null },
    ],
    [{ kind: "edit" }, { target: "editor", assetId: "asset-1" }],
    [{ kind: "open" }, { target: "detail", assetId: "asset-1" }],
  ])("%o closes the card first, then opens the main window on %o", (action, handOff) => {
    const { ready, window, cardReady, press, openInMain } = setup();
    ready.show(FRESH);
    cardReady();
    press(action);
    expect(window().hide).toHaveBeenCalledTimes(1);
    expect(openInMain).toHaveBeenCalledWith(handOff);
    expect(window().hide.mock.invocationCallOrder[0]).toBeLessThan(
      openInMain.mock.invocationCallOrder[0]!,
    );
  });

  it("ignores Edit first when the card did not offer it, and malformed or foreign presses", () => {
    const { ready, cardReady, press, listeners, openInMain, window } = setup();
    ready.show({ ...FRESH, canEdit: false });
    cardReady();
    press({ kind: "pick", destination: "square" });
    press({ kind: "launch" });
    listeners.get(IPC_CHANNELS.recordingReadyAction)?.({ sender: {} }, { kind: "open" });
    expect(openInMain).not.toHaveBeenCalled();
    expect(window().hide).not.toHaveBeenCalled();
    press({ kind: "edit" });
    expect(window().hide).toHaveBeenCalledTimes(1);
    expect(openInMain).not.toHaveBeenCalled();
  });

  it("recreates a window the system closed, and never shows again after quit", () => {
    const { ready, windows, window } = setup();
    ready.show(FRESH);
    window().closed?.();
    ready.show(FRESH);
    expect(windows).toHaveLength(2);
    ready.destroy();
    expect(window().destroy).toHaveBeenCalled();
    expect(ready.show(FRESH)).toBe(false);
    expect(windows).toHaveLength(2);
  });
});
