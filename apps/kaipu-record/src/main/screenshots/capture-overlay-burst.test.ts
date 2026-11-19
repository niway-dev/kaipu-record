import type { Display } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CAPTURE_MODES } from "@shared/types/screenshot-capture";

/**
 * NIW2-878, AC6: a burst of open / Esc cycles must open the widget every time.
 *
 * The failure it pins: the windows of a pick used to be destroyed when it ended and rebuilt
 * only after a 2 s warm-up delay. A press inside that delay found no windows and loaded
 * them fresh, which takes 176 ms in production and about 360 ms in dev (about 1.4 s with
 * three displays). Esc is read by the key window's own `before-input-event`, so an Esc sent
 * while nothing is on screen reaches nobody. The pick stays open, and the next press of the
 * shortcut reads "the widget is open in my intent" and CLOSES it, so that press opens
 * nothing at all. The bug shows as a widget that comes back late, or not at all, on the
 * second and later presses.
 *
 * The windows here load for `LOAD_MS` and are destroyed asynchronously, like real ones; the
 * assertion is that every press has a visible window by the time the user would press Esc.
 */

const created: FakeWindow[] = [];
const ipcListeners = new Map<
  string,
  (event: { sender: { id: number } }, payload?: unknown) => void
>();
let nextWebContentsId = 100;
let loadMs = 360;

class FakeWindow {
  private contentsListeners = new Map<string, (...args: never[]) => void>();
  webContents = {
    id: nextWebContentsId++,
    send: vi.fn(),
    on: vi.fn((event: string, callback: (...args: never[]) => void) => {
      this.contentsListeners.set(event, callback);
    }),
  };
  setAlwaysOnTop = vi.fn();
  setContentProtection = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
  private visible = false;
  show = vi.fn(() => {
    this.visible = true;
  });
  showInactive = vi.fn(() => {
    this.visible = true;
  });
  hide = vi.fn(() => {
    this.visible = false;
  });
  focus = vi.fn();
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async () => {});
  private destroyed = false;
  private readyToShow: (() => void) | null = null;
  private closed: (() => void) | null = null;
  /** Electron emits `closed` a moment after `destroy()`, not inside it. */
  destroy = vi.fn(() => {
    this.destroyed = true;
    setTimeout(() => this.closed?.(), 5);
  });
  isDestroyed = () => this.destroyed;
  once = vi.fn((event: string, callback: () => void) => {
    if (event === "ready-to-show") this.readyToShow = callback;
  });
  on = vi.fn((event: string, callback: () => void) => {
    if (event === "closed") this.closed = callback;
  });
  constructor() {
    created.push(this);
    setTimeout(() => {
      if (!this.destroyed) this.readyToShow?.();
    }, loadMs);
  }
  /** On screen right now: shown and neither hidden again nor destroyed. */
  get shown(): boolean {
    return !this.destroyed && this.visible;
  }
  /** Esc, as the key window's `before-input-event` sees it. */
  pressEscape(): void {
    (this.contentsListeners.get("before-input-event") as (...a: unknown[]) => void)?.(
      { preventDefault() {} },
      { type: "keyDown", key: "Escape" },
    );
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  ipcMain: { on: (channel: string, listener: never) => ipcListeners.set(channel, listener) },
  screen: {
    on: () => {},
    getCursorScreenPoint: () => ({ x: 100, y: 100 }),
    getPrimaryDisplay: () => ({ id: 1 }),
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));

const { CaptureOverlayWindows } = await import("./capture-overlay-windows");
const { decideWidgetShortcut } = await import("../shortcuts/widget-shortcut");
const { createCaptureHandler } = await import("./capture-handler");
const { runWithOverlay } = await import("./screenshot-capture");
const { IPC_CHANNELS } = await import("@shared/types/ipc");

function display(id: number, x: number): Display {
  return {
    id,
    bounds: { x, y: 0, width: 1440, height: 900 },
    workArea: { x, y: 25, width: 1440, height: 875 },
    scaleFactor: 2,
  } as Display;
}

beforeEach(() => {
  created.length = 0;
  ipcListeners.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

/** Ms between the press and the Esc, and the gap before the next press. */
const ESC_AFTER_PRESS_MS = 150;
const GAP_MS = 300;

for (const displays of [[display(1, 0)], [display(1, 0), display(2, 1440), display(3, 2880)]]) {
  for (const dev of [false, true]) {
    it(`opens on every press of a 6-cycle burst, ${displays.length} display(s), ${dev ? "dev" : "prod"} load`, async () => {
      loadMs = dev ? 360 : 176;
      const port = new CaptureOverlayWindows({
        platform: "darwin",
        enabledModes: CAPTURE_MODES,
        warmup: { next: () => ({ ui: "frame", intent: "capture", displays }), canWarm: () => true },
      });
      // The app warms the first set at launch, long before the burst.
      port.prewarm();
      await vi.advanceTimersByTimeAsync(5000);

      const shownAtEsc: boolean[] = [];
      for (let cycle = 0; cycle < 6; cycle += 1) {
        // The press: the same decision the shortcut handler makes, then the pick it starts.
        const decision = decideWidgetShortcut({
          key: "capture",
          takeActive: false,
          takePending: false,
          overlayOpen: port.isPicking(),
          overlayIntent: port.currentIntent(),
        });
        if (decision === "close") port.cancelPick();
        let ended = Promise.resolve();
        if (decision === "open") {
          ended = port.pick("frame", displays, "capture").then(() => port.endPick());
        }

        await vi.advanceTimersByTimeAsync(ESC_AFTER_PRESS_MS);
        const visible = created.filter((window) => window.shown);
        shownAtEsc.push(decision === "open" && visible.length >= displays.length);
        const escape = visible.at(-1);
        escape?.pressEscape();
        // An Esc with no window on screen reaches nobody: the pick stays open.
        if (escape) await ended;
        await vi.advanceTimersByTimeAsync(GAP_MS);
      }

      expect(shownAtEsc).toEqual([true, true, true, true, true, true]);
    });
  }
}

/**
 * The same burst, but each pick ends in a shot, through the real capture handler: the press
 * that follows lands while the previous shot is still being saved. The handler used to keep
 * its guard until the save was done, so that press found the overlay "closed" (the pick had
 * ended), decided to open it, and was answered `cancelled`: no widget, no error.
 */
it("opens on every press even while the previous shot is still saving, through the handler", async () => {
  loadMs = 176;
  const displays = [display(1, 0)];
  const port = new CaptureOverlayWindows({
    platform: "darwin",
    enabledModes: CAPTURE_MODES,
    warmup: { next: () => ({ ui: "frame", intent: "capture", displays }), canWarm: () => true },
  });
  port.prewarm();
  await vi.advanceTimersByTimeAsync(5000);

  const SAVE_MS = 200;
  const saved: number[] = [];
  const handler = createCaptureHandler({
    platform: "darwin",
    provider: {
      supports: () => true,
      supportedModes: () => [],
      capture: ({ overlay, intent }) =>
        runWithOverlay(
          overlay,
          async () => {
            const answer = await overlay.pick("frame", displays, intent ?? "capture");
            if (answer.kind !== "display") return null;
            return {
              display: displays[0]!,
              rect: null,
              mode: "screen",
              action: "capture",
              viaOverlay: true,
            };
          },
          async () => ({
            kind: "captured",
            png: Buffer.from([1]),
            mode: "screen",
            action: "capture",
          }),
          { settle: async () => {}, getDisplays: async () => displays },
        ),
    },
    overlay: {
      pick: (ui, shown, intent) => port.pick(ui, shown, intent),
      hideAll: () => port.hideAll(),
      endPick: () => port.endPick(),
    },
    windows: { beforeCapture: () => {}, afterCapture: () => {}, reveal: () => {} },
    measure: () => ({ width: 1, height: 1 }),
    displayCount: () => 1,
    track: () => {},
    rememberMode: () => {},
    settings: () => ({ copy: "manual" }),
    saveToVault: () =>
      new Promise((resolve) =>
        setTimeout(() => {
          saved.push(Date.now());
          resolve({ id: "s", assetId: "a" });
        }, SAVE_MS),
      ),
    copyToClipboard: () => {},
    thumbnail: () => "data:image/png;base64,",
  });

  const answerFrom = (window: FakeWindow): void => {
    const state = window.webContents.send.mock.calls
      .filter(([channel]) => channel === IPC_CHANNELS.screenshotOverlayState)
      .at(-1)![1] as { session: number };
    ipcListeners.get(IPC_CHANNELS.screenshotOverlayAnswer)!(
      { sender: { id: window.webContents.id } },
      { kind: "display", mode: "screen", action: "capture", displayId: 1, session: state.session },
    );
  };

  const shownAtPress: boolean[] = [];
  const results: Promise<unknown>[] = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    const decision = decideWidgetShortcut({
      key: "capture",
      takeActive: false,
      takePending: false,
      overlayOpen: port.isPicking(),
      overlayIntent: port.currentIntent(),
    });
    if (decision === "open") results.push(handler({ mode: "frame", intent: "capture" }));
    await vi.advanceTimersByTimeAsync(ESC_AFTER_PRESS_MS);
    const visible = created.filter((window) => window.shown);
    shownAtPress.push(decision === "open" && visible.length >= displays.length);
    if (visible.at(-1)) answerFrom(visible.at(-1)!);
    // The next press comes while the shot is being hidden, grabbed and saved.
    await vi.advanceTimersByTimeAsync(GAP_MS);
  }
  await vi.advanceTimersByTimeAsync(5000);

  expect(shownAtPress).toEqual([true, true, true, true, true]);
  expect((await Promise.all(results)).map((result) => (result as { kind: string }).kind)).toEqual(
    Array(5).fill("captured"),
  );
  expect(saved).toHaveLength(5);
});
