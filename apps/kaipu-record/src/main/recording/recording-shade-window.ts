import { BrowserWindow } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { IPC_CHANNELS } from "@shared/types";
import type { RecordingShadeState } from "@shared/types/ipc";
import type { CaptureRect } from "@shared/types/screenshot-capture";

/** The slice of `Electron.Display` the shade reads. */
export interface ShadeDisplay {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
}

/** The renderer route for a shade: the region (absent for a whole display) and the phase. */
export function shadeSearch(rect: CaptureRect | null, state: RecordingShadeState): string {
  const region = rect ? `&rect=${[rect.x, rect.y, rect.width, rect.height].join(",")}` : "";
  const phase =
    state.phase === "countdown"
      ? `&phase=countdown${state.value === null ? "" : `&value=${state.value}`}`
      : "&phase=recording";
  return `?window=recording-shade${region}${phase}`;
}

/**
 * The marker over the recorded display (spec "Record capture modes" decision 4, extended by
 * its task 5 notes; no ADR amendment). While the countdown runs it dims everything outside
 * the chosen region and shows the number. While an area records it keeps the dark fill
 * outside the area and adds a pink border just outside it and a "REC · border not recorded"
 * tag; a whole-display recording gets only a pink border around the display, no fill (and
 * none at all where content protection cannot exclude it, see `fullDisplayBorderAllowed`).
 *
 * Three properties carry the whole design and are pinned by `floating-window-policy.test.ts`:
 * - content-protected, so the shade itself is never in the video;
 * - click-through (`setIgnoreMouseEvents(true)`) and not focusable, so the app being
 *   recorded keeps every click, scroll and key;
 * - a macOS `panel` joining full-screen Spaces with `skipTransformProcessType` (ADR 0029).
 *
 * It sits one level below the control bar and the camera bubble ("status" against their
 * "screen-saver"), so neither is ever covered; `onShown` lets the hub raise them as well,
 * because Windows ignores the levels and orders topmost windows by when they were shown.
 */
export class RecordingShadeWindow {
  private window: BrowserWindow | null = null;
  /** What the current window covers, so a countdown shade can become the recording one. */
  private key: string | null = null;
  private state: RecordingShadeState = { phase: "recording" };

  /**
   * Cover `display`, marking `rect` (display-relative DIP) or, with `null`, the whole
   * display. A shade already up for the same region only changes phase; any other replaces it.
   */
  show(
    display: ShadeDisplay,
    rect: CaptureRect | null,
    onShown?: () => void,
    state: RecordingShadeState = { phase: "recording" },
  ): void {
    const key = JSON.stringify([display.id, display.bounds, rect]);
    if (this.window && !this.window.isDestroyed() && this.key === key) {
      this.update(state);
      onShown?.();
      return;
    }
    this.hide();
    this.key = key;
    this.state = state;
    const { x, y, width, height } = display.bounds;
    const window = new BrowserWindow({
      x,
      y,
      width,
      height,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
      },
    });
    this.window = window;
    window.setIgnoreMouseEvents(true);
    window.setContentProtection(true);
    window.setAlwaysOnTop(true, "status");
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });

    const search = shadeSearch(rect, state);
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${search}`);
    } else {
      void window.loadFile(join(__dirname, "../renderer/index.html"), { search });
    }
    window.once("ready-to-show", () => {
      if (this.window !== window || window.isDestroyed()) return;
      // A phase change that arrived while the page loaded is applied now.
      window.webContents.send(IPC_CHANNELS.recordingShadeState, this.state);
      window.showInactive();
      onShown?.();
    });
    window.on("closed", () => {
      if (this.window === window) {
        this.window = null;
        this.key = null;
      }
    });
  }

  /** Change what the shade paints (the next countdown tick, or recording). */
  update(state: RecordingShadeState): void {
    this.state = state;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(IPC_CHANNELS.recordingShadeState, state);
    }
  }

  /** Destroy the shade: it holds nothing worth keeping between takes. */
  hide(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
    this.key = null;
  }
}
