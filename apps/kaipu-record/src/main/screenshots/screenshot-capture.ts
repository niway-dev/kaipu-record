import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import type { OverlayPort } from "./overlay-port";

const execFileAsync = promisify(execFile);

export type CaptureRequest = { mode: CaptureMode; overlay: OverlayPort };

/** Main-side result; the IPC handler turns it into the renderer's `CaptureResult`. */
export type ProviderResult =
  | { kind: "captured"; png: Buffer; mode: CaptureMode }
  | { kind: "cancelled" }
  | { kind: "unsupported"; mode: CaptureMode };

export interface ScreenshotCaptureProvider {
  capture(request: CaptureRequest): Promise<ProviderResult>;
}

export interface Deps {
  runCli(cmd: string, args: string[]): Promise<void>;
  readPng(path: string): Promise<Buffer>;
  fileExists(path: string): Promise<boolean>;
  tempPath(): string;
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
};

/** macOS: Area uses the native `screencapture -i -o -x` region selector. */
export class MacProvider implements ScreenshotCaptureProvider {
  constructor(private readonly deps: Deps = realDeps) {}

  async capture({ mode }: CaptureRequest): Promise<ProviderResult> {
    // Screen and Frame need our own overlay: a later task wires
    // `request.overlay.pick(...)` here (pick -> `screencapture -R <bounds> -x`).
    if (mode !== "area") return { kind: "unsupported", mode };
    const target = this.deps.tempPath();
    await this.deps.runCli("screencapture", ["-i", "-o", "-x", target]);
    if (!(await this.deps.fileExists(target))) return { kind: "cancelled" }; // user pressed Esc
    const png = await this.deps.readPng(target);
    await rm(target, { force: true }).catch(() => {});
    return { kind: "captured", png, mode };
  }
}

/** Windows: skeleton until the Windows backend lands; every mode is unsupported. */
export class WindowsProvider implements ScreenshotCaptureProvider {
  async capture({ mode }: CaptureRequest): Promise<ProviderResult> {
    return { kind: "unsupported", mode };
  }
}

/** Any other platform has no capture backend. */
export class UnsupportedProvider implements ScreenshotCaptureProvider {
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
