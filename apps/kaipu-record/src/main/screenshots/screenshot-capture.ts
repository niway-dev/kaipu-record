import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Display, Rectangle } from "electron";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { toGlobal } from "./capture-geometry";
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
    // The overlay session lasts until `destroyAll`, so every path out of here must call it,
    // or every later pick answers "cancelled".
    try {
      const rect = await this.pickRect(mode, overlay);
      if (!rect) return { kind: "cancelled" };
      await overlay.hideAll(); // Failure 1: capture only once no overlay is on screen
      // `-R` takes global points (DIP), not pixels, and handles Retina itself.
      return await this.grab(["-R", rectArg(rect), "-x"], mode);
    } finally {
      overlay.destroyAll();
    }
  }

  /** The global DIP rectangle to capture, or null when the user cancelled. */
  private async pickRect(
    mode: "screen" | "frame",
    overlay: OverlayPort,
  ): Promise<Rectangle | null> {
    const displays = await this.deps.getDisplays();
    // One display: nothing to choose, so Screen skips the overlay entirely.
    if (mode === "screen" && displays.length === 1) {
      // No overlay to wait on, but `beforeCapture` just hid the app: let it leave the screen.
      await this.deps.settle();
      return displays[0]!.bounds;
    }
    const answer = await overlay.pick(mode, displays);
    if (answer.kind === "cancelled") return null;
    const display = displays.find((candidate) => candidate.id === answer.displayId);
    if (!display) return null;
    return answer.kind === "display" ? display.bounds : toGlobal(answer.rect, display);
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

/** Windows: skeleton until the Windows backend lands; every mode is unsupported. */
export class WindowsProvider implements ScreenshotCaptureProvider {
  // No mode yet; the Windows backend task flips these.
  supports(): boolean {
    return false;
  }

  async capture({ mode }: CaptureRequest): Promise<ProviderResult> {
    return { kind: "unsupported", mode };
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
