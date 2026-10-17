import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Display, Rectangle } from "electron";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { cropForDisplay, physicalSizeFor, toGlobal } from "./capture-geometry";
import type { OverlayPort } from "./overlay-port";

const execFileAsync = promisify(execFile);

export type CaptureRequest = { mode: CaptureMode; overlay: OverlayPort };

/** Main-side result; the IPC handler turns it into the renderer's `CaptureResult`. */
export type ProviderResult =
  | { kind: "captured"; png: Buffer; mode: CaptureMode }
  | { kind: "cancelled" }
  | { kind: "unsupported"; mode: CaptureMode };

export interface ScreenshotCaptureProvider {
  /** Whether `capture` can serve `mode`; lets the handler answer before hiding any window. */
  supports(mode: CaptureMode): boolean;
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

/** What the user chose: a display, and a display-relative DIP rect inside it (null = all of it). */
export interface CaptureTarget {
  display: Display;
  rect: Rectangle | null;
}

/** Shows the overlay in `ui` mode and resolves the answer to a target; null when cancelled. */
export async function pickTarget(
  overlay: OverlayPort,
  ui: "area" | "screen" | "frame",
  displays: Display[],
): Promise<CaptureTarget | null> {
  const answer = await overlay.pick(ui, displays);
  if (answer.kind === "cancelled") return null;
  const display = displays.find((candidate) => candidate.id === answer.displayId);
  if (!display) return null;
  return { display, rect: answer.kind === "rect" ? answer.rect : null };
}

/**
 * The sequence both backends share: choose → hide every overlay → capture → destroy.
 * `destroyAll` runs on every path out (cancel, throw, success): the overlay session lasts
 * until then, and a skipped call makes every later pick answer "cancelled".
 */
export async function runWithOverlay(
  overlay: OverlayPort,
  choose: () => Promise<CaptureTarget | null>,
  capture: (target: CaptureTarget) => Promise<ProviderResult>,
): Promise<ProviderResult> {
  try {
    const target = await choose();
    if (!target) return { kind: "cancelled" };
    await overlay.hideAll(); // Failure 1: capture only once no overlay is on screen
    return await capture(target);
  } finally {
    overlay.destroyAll();
  }
}

/**
 * macOS: Area uses the native `screencapture -i -o -x` region selector; Screen and Frame
 * pick on our overlay, hide it, then capture a global rectangle with `screencapture -R`.
 */
export class MacProvider implements ScreenshotCaptureProvider {
  constructor(private readonly deps: Deps = realDeps) {}

  supports(_mode: CaptureMode): boolean {
    return true;
  }

  async capture({ mode, overlay }: CaptureRequest): Promise<ProviderResult> {
    if (mode === "area") return this.grab(["-i", "-o", "-x"], mode);
    return runWithOverlay(
      overlay,
      async () => {
        const displays = await this.deps.getDisplays();
        // One display: nothing to choose, so Screen skips the overlay entirely.
        if (mode === "screen" && displays.length === 1) {
          // No overlay to wait on, but `beforeCapture` just hid the app: let it leave the screen.
          await this.deps.settle();
          return { display: displays[0]!, rect: null };
        }
        return pickTarget(overlay, mode, displays);
      },
      // `-R` takes global points (DIP), not pixels, and handles Retina itself.
      ({ display, rect }) =>
        this.grab(["-R", rectArg(rect ? toGlobal(rect, display) : display.bounds), "-x"], mode),
    );
  }

  private async grab(flags: string[], mode: CaptureMode): Promise<ProviderResult> {
    const target = this.deps.tempPath();
    await this.deps.runCli("screencapture", [...flags, target]);
    // No file: Esc in Apple's own picker, or `-R` refused the rectangle.
    if (!(await this.deps.fileExists(target))) return { kind: "cancelled" };
    try {
      const png = await this.deps.readPng(target);
      return { kind: "captured", png, mode };
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
  crop(rect: Rectangle): CapturedImage;
  toPNG(): Buffer;
}

export interface ScreenSource {
  /** desktopCapturer `display_id`; "" when the platform cannot say. */
  display_id: string;
  thumbnail: CapturedImage;
}

export interface WindowsDeps {
  getSources(options: {
    types: ["screen"];
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

  async capture({ mode, overlay }: CaptureRequest): Promise<ProviderResult> {
    return runWithOverlay(
      overlay,
      async () => {
        const displays = await this.deps.getDisplays();
        if (mode === "screen" && displays.length === 1) {
          await this.deps.settle(); // the app was just hidden: let it leave the screen
          return { display: displays[0]!, rect: null };
        }
        return pickTarget(overlay, mode, displays);
      },
      async ({ display, rect }) => {
        const image = await this.captureDisplay(display);
        if (!image) {
          console.warn(`[screenshot] no desktopCapturer source for display ${display.id}`);
          return { kind: "cancelled" };
        }
        const shot = rect ? image.crop(cropForDisplay(image.getSize(), display, rect)) : image;
        return { kind: "captured", png: shot.toPNG(), mode };
      },
    );
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
    return match?.thumbnail ?? null;
  }
}

/** Any other platform has no capture backend. */
export class UnsupportedProvider implements ScreenshotCaptureProvider {
  supports(): boolean {
    return false;
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
