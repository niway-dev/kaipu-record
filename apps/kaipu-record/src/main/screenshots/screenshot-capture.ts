import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Display, Rectangle } from "electron";
import {
  CAPTURE_MODES,
  type CaptureAction,
  type CaptureMode,
} from "@shared/types/screenshot-capture";
import { cropForDisplay, physicalSizeFor, toGlobal } from "./capture-geometry";
import type { OverlayPort } from "./overlay-port";

const execFileAsync = promisify(execFile);

export type CaptureRequest = { mode: CaptureMode; overlay: OverlayPort };

/** Main-side result; the IPC handler turns it into the renderer's `CaptureResult`. */
export type ProviderResult =
  | { kind: "captured"; png: Buffer; mode: CaptureMode; action: CaptureAction }
  | { kind: "cancelled" }
  | { kind: "unsupported"; mode: CaptureMode };

export interface ScreenshotCaptureProvider {
  /** Whether `capture` can serve `mode`; lets the handler answer before hiding any window. */
  supports(mode: CaptureMode): boolean;
  /** Every mode `supports` accepts; the renderer asks once to render unsupported entry points disabled. */
  supportedModes(): CaptureMode[];
  capture(request: CaptureRequest): Promise<ProviderResult>;
}

export interface Deps {
  runCli(cmd: string, args: string[]): Promise<void>;
  readPng(path: string): Promise<Buffer>;
  fileExists(path: string): Promise<boolean>;
  tempPath(): string;
  /** Every connected display, in Electron's order. */
  getDisplays(): Promise<Display[]>;
  /** Short pause so a window hidden just before a no-overlay capture is off screen. */
  settle(): Promise<void>;
}

const realDeps: Deps = {
  runCli: async (cmd, args) => {
    await execFileAsync(cmd, args);
  },
  readPng: (path) => readFile(path),
  fileExists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  // Note: no Date.now()/Math.random() in plan code is fine here — this is runtime, not a workflow.
  tempPath: () => join(tmpdir(), `kaipu-shot-${process.hrtime.bigint()}.png`),
  // Loaded lazily so importing this module (tests, type checks) never needs Electron.
  settle: () => new Promise((resolve) => setTimeout(resolve, 80)),
  getDisplays: async () => (await import("electron")).screen.getAllDisplays(),
};

/**
 * What the user chose: a display, and a display-relative DIP rect inside it (null = all of it).
 * `mode` and `action` are the overlay's answer, not the requested mode: the user may have
 * switched mode on the overlay, and backends capture by what they ended in.
 */
export interface CaptureTarget {
  display: Display;
  rect: Rectangle | null;
  mode: CaptureMode;
  action: CaptureAction;
  /** Window mode only: the OS window id the answer named. */
  windowId?: string;
  /** Window mode only: the whole window's DIP size (`rect` is clamped to `display`). */
  fullSize?: { width: number; height: number };
  /** True when the user picked on our overlay, so `runWithOverlay` waits for it to leave. */
  viaOverlay: boolean;
}

/** Shows the overlay in `ui` mode and resolves the answer to a target; null when cancelled. */
export async function pickTarget(
  overlay: OverlayPort,
  ui: CaptureMode,
  displays: Display[],
): Promise<CaptureTarget | null> {
  const answer = await overlay.pick(ui, displays);
  if (answer.kind === "cancelled") return null;
  const display = displays.find((candidate) => candidate.id === answer.displayId);
  if (!display) return null;
  const { mode, action } = answer;
  switch (answer.kind) {
    case "rect":
      return { display, rect: answer.rect, mode, action, viaOverlay: true };
    case "window":
      return {
        display,
        rect: answer.rect,
        mode,
        action,
        windowId: answer.windowId,
        ...(answer.fullSize ? { fullSize: answer.fullSize } : {}),
        viaOverlay: true,
      };
    case "display":
      return { display, rect: null, mode, action, viaOverlay: true };
  }
}

/** Screen on a lone display needs no overlay: the whole display, captured as asked. */
function wholeDisplay(display: Display): CaptureTarget {
  return { display, rect: null, mode: "screen", action: "capture", viaOverlay: false };
}

/**
 * The sequence both backends share: choose → hide every overlay → settle → capture → destroy.
 * `destroyAll` runs on every path out (cancel, throw, success): the overlay session lasts
 * until then, and a skipped call makes every later pick answer "cancelled".
 */
export async function runWithOverlay(
  overlay: OverlayPort,
  choose: () => Promise<CaptureTarget | null>,
  capture: (target: CaptureTarget) => Promise<ProviderResult>,
  deps: { settle(): Promise<void>; getDisplays(): Promise<Display[]> },
): Promise<ProviderResult> {
  try {
    const target = await choose();
    if (!target) return { kind: "cancelled" };
    await overlay.hideAll(); // Failure 1: capture only once no overlay is on screen
    // The window server / DWM can keep a hidden transparent window for a few frames.
    // No overlay was shown (single-display Screen): `choose` already waited for the app.
    if (target.viaOverlay) await deps.settle();
    // A display unplugged after the answer would leave stale bounds: cancel, don't grab.
    const current = await deps.getDisplays();
    if (!current.some((display) => display.id === target.display.id)) {
      console.warn(`[screenshot] display ${target.display.id} is gone since the pick`);
      return { kind: "cancelled" };
    }
    return await capture(target);
  } finally {
    overlay.destroyAll();
  }
}

/**
 * macOS: every mode picks on our overlay, hides it, then captures a global rectangle with
 * `screencapture -R`. The backend is chosen by the overlay's answer, not the requested mode.
 */
export class MacProvider implements ScreenshotCaptureProvider {
  constructor(private readonly deps: Deps = realDeps) {}

  supports(_mode: CaptureMode): boolean {
    return true;
  }

  supportedModes(): CaptureMode[] {
    return CAPTURE_MODES.filter((mode) => this.supports(mode));
  }

  async capture({ mode, overlay }: CaptureRequest): Promise<ProviderResult> {
    return runWithOverlay(
      overlay,
      async () => {
        const displays = await this.deps.getDisplays();
        // One display: nothing to choose, so Screen skips the overlay entirely.
        if (mode === "screen" && displays.length === 1) {
          // No overlay to wait on, but `beforeCapture` just hid the app: let it leave the screen.
          await this.deps.settle();
          return wholeDisplay(displays[0]!);
        }
        return pickTarget(overlay, mode, displays);
      },
      // `-R` takes global points (DIP), not pixels, and handles Retina itself.
      (target) => this.captureTarget(target),
      this.deps,
    );
  }

  private async captureTarget({
    display,
    rect,
    mode,
    action,
    windowId,
  }: CaptureTarget): Promise<ProviderResult> {
    const region = ["-R", rectArg(rect ? toGlobal(rect, display) : display.bounds), "-x"];
    if (mode === "window" && windowId && rect) {
      // `-l` captures the window by id, whole and without its shadow (`-o`), even when covered.
      let byId: ProviderResult;
      try {
        byId = await this.grab(["-l", windowId, "-o", "-x"], mode, action);
      } catch (error) {
        // A window that closed since the list: `screencapture -l` prints "could not create
        // image from window" and exits 1, so `runCli` rejects. That is "no file", not a failure.
        console.warn(`[screenshot] screencapture -l ${windowId} failed`, error);
        byId = { kind: "cancelled" };
      }
      if (byId.kind === "captured") return byId;
      // The window vanished or `-l` refused it: one retry on the rectangle the user saw.
      console.warn(`[screenshot] screencapture -l ${windowId} produced no file; using the rect`);
    }
    return this.grab(region, mode, action);
  }

  private async grab(
    flags: string[],
    mode: CaptureMode,
    action: CaptureAction,
  ): Promise<ProviderResult> {
    const target = this.deps.tempPath();
    await this.deps.runCli("screencapture", [...flags, target]);
    // No file: `-l` or `-R` refused the target.
    if (!(await this.deps.fileExists(target))) return { kind: "cancelled" };
    try {
      const png = await this.deps.readPng(target);
      return { kind: "captured", png, mode, action };
    } finally {
      await rm(target, { force: true }).catch(() => {});
    }
  }
}

function rectArg(rect: Rectangle): string {
  return [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(",");
}

/** The slice of `NativeImage` the Windows backend uses; tests pass plain fakes. */
export interface CapturedImage {
  getSize(): { width: number; height: number };
  /** True when the grab produced no pixels (desktopCapturer returns this when it fails). */
  isEmpty(): boolean;
  crop(rect: Rectangle): CapturedImage;
  toPNG(): Buffer;
}

export interface ScreenSource {
  /** desktopCapturer id: `screen:<n>:0` or `window:<HWND decimal>:0`. Absent in older fakes. */
  id?: string;
  /** desktopCapturer `display_id`; "" when the platform cannot say. */
  display_id: string;
  thumbnail: CapturedImage;
}

export interface WindowsDeps {
  getSources(options: {
    types: ["screen"] | ["window"];
    thumbnailSize: { width: number; height: number };
  }): Promise<ScreenSource[]>;
  getDisplays(): Promise<Display[]>;
  /** Short pause so a window hidden just before a no-overlay capture is off screen. */
  settle(): Promise<void>;
}

const realWindowsDeps: WindowsDeps = {
  getSources: async (options) => {
    const { desktopCapturer } = await import("electron");
    return desktopCapturer.getSources(options);
  },
  getDisplays: async () => (await import("electron")).screen.getAllDisplays(),
  settle: realDeps.settle,
};

/**
 * Windows: every mode picks on our overlay, hides it, then grabs the display through
 * `desktopCapturer` and crops it to the picked rectangle in physical pixels.
 */
export class WindowsProvider implements ScreenshotCaptureProvider {
  constructor(private readonly deps: WindowsDeps = realWindowsDeps) {}

  supports(_mode?: CaptureMode): boolean {
    return true;
  }

  supportedModes(): CaptureMode[] {
    return CAPTURE_MODES.filter((mode) => this.supports(mode));
  }

  async capture({ mode, overlay }: CaptureRequest): Promise<ProviderResult> {
    return runWithOverlay(
      overlay,
      async () => {
        const displays = await this.deps.getDisplays();
        if (mode === "screen" && displays.length === 1) {
          await this.deps.settle(); // the app was just hidden: let it leave the screen
          return wholeDisplay(displays[0]!);
        }
        return pickTarget(overlay, mode, displays);
      },
      async ({ display, rect, mode: picked, action, windowId, fullSize }) => {
        if (picked === "window" && windowId && rect) {
          const win = await this.captureWindow(display, fullSize ?? rect, windowId);
          if (win) return { kind: "captured", png: win.toPNG(), mode: picked, action };
          console.warn(`[screenshot] no window source for ${windowId}; cropping the display`);
        }
        const image = await this.captureDisplay(display);
        if (!image) {
          console.warn(`[screenshot] no desktopCapturer source for display ${display.id}`);
          return { kind: "cancelled" };
        }
        const shot = rect ? image.crop(cropForDisplay(image.getSize(), display, rect)) : image;
        return { kind: "captured", png: shot.toPNG(), mode: picked, action };
      },
      this.deps,
    );
  }

  /**
   * The window's own pixels by id (`window:<id>:`), never by name or index; null when unusable.
   * `size` is the whole window in DIP: a window spanning two displays is larger than its
   * clamped rect, and a thumbnail asked at the clamped size would come back downscaled.
   */
  private async captureWindow(
    display: Display,
    size: { width: number; height: number },
    windowId: string,
  ): Promise<CapturedImage | null> {
    const sources = await this.deps.getSources({
      types: ["window"],
      thumbnailSize: {
        width: Math.round(size.width * display.scaleFactor),
        height: Math.round(size.height * display.scaleFactor),
      },
    });
    const thumbnail = sources.find((source) =>
      source.id?.startsWith(`window:${windowId}:`),
    )?.thumbnail;
    if (!thumbnail) return null;
    const { width, height } = thumbnail.getSize();
    if (thumbnail.isEmpty() || width === 0 || height === 0) return null;
    return thumbnail;
  }

  private async captureDisplay(display: Display): Promise<CapturedImage | null> {
    const sources = await this.deps.getSources({
      types: ["screen"],
      thumbnailSize: physicalSizeFor(display),
    });
    // Electron: `display_id` "corresponds to the `id` of the matching Display" and is an empty
    // string if not available. So match on it first; only a lone source with an empty id is
    // unambiguous enough to take as this display.
    const match =
      sources.find((source) => source.display_id === String(display.id)) ??
      (sources.length === 1 && !sources[0]!.display_id ? sources[0] : undefined);
    const thumbnail = match?.thumbnail;
    if (!thumbnail) return null;
    // A failed grab comes back as a 0x0 image: not a match, or the editor opens on nothing.
    const { width, height } = thumbnail.getSize();
    if (thumbnail.isEmpty() || width === 0 || height === 0) return null;
    return thumbnail;
  }
}

/** Any other platform has no capture backend. */
export class UnsupportedProvider implements ScreenshotCaptureProvider {
  supports(): boolean {
    return false;
  }

  supportedModes(): CaptureMode[] {
    return [];
  }

  async capture({ mode }: CaptureRequest): Promise<ProviderResult> {
    return { kind: "unsupported", mode };
  }
}

export function createScreenshotProvider(
  platform: NodeJS.Platform,
  deps?: Deps,
): ScreenshotCaptureProvider {
  switch (platform) {
    case "darwin":
      return new MacProvider(deps);
    case "win32":
      return new WindowsProvider();
    default:
      return new UnsupportedProvider();
  }
}
