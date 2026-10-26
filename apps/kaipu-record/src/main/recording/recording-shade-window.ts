import { BrowserWindow } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import type { CaptureRect } from "@shared/types/screenshot-capture";

/** The slice of `Electron.Display` the shade reads. */
export interface ShadeDisplay {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * The shade over the recorded display while an AREA records (ADR 0030, spec decision 4):
 * the area is clear, everything else on that display is dimmed, so the user sees where the
 * recorded pixels end.
 *
 * Three properties carry the whole design and are pinned by `floating-window-policy.test.ts`:
 * - content-protected, so the shade itself is never in the video;
 * - click-through (`setIgnoreMouseEvents(true)`) and not focusable, so the app being
 *   recorded keeps every click, scroll and key;
 * - a macOS `panel` joining full-screen Spaces with `skipTransformProcessType` (ADR 0029).
 *
 * It sits one level below the control bar and the camera bubble ("status" against their
 * "screen-saver"), so neither is ever dimmed; `onShown` lets the hub raise them as well,
 * because Windows ignores the levels and orders topmost windows by when they were shown.
 */
export class RecordingShadeWindow {
  private window: BrowserWindow | null = null;

  show(display: ShadeDisplay, rect: CaptureRect, onShown?: () => void): void {
    this.hide();
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

    const search = `?window=recording-shade&rect=${[rect.x, rect.y, rect.width, rect.height].join(",")}`;
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      void window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${search}`);
    } else {
      void window.loadFile(join(__dirname, "../renderer/index.html"), { search });
    }
    window.once("ready-to-show", () => {
      if (this.window !== window || window.isDestroyed()) return;
      window.showInactive();
      onShown?.();
    });
    window.on("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  /** Destroy the shade: it holds nothing worth keeping between takes. */
  hide(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}
