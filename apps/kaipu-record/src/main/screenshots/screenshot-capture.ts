import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ScreenshotCaptureProvider {
  /** Interactive region capture; resolves the PNG, or null if cancelled. */
  captureInteractive(): Promise<Buffer | null>;
}

interface Deps {
  runCli(cmd: string, args: string[]): Promise<void>;
  readPng(path: string): Promise<Buffer>;
  fileExists(path: string): Promise<boolean>;
  tempPath(): string;
}

const realDeps: Deps = {
  runCli: async (cmd, args) => { await execFileAsync(cmd, args); },
  readPng: (path) => readFile(path),
  fileExists: async (path) => { try { await access(path); return true; } catch { return false; } },
  // Note: no Date.now()/Math.random() in plan code is fine here — this is runtime, not a workflow.
  tempPath: () => join(tmpdir(), `kaipu-shot-${process.hrtime.bigint()}.png`),
};

/** macOS Path A: `screencapture -i -o` interactive region select to a temp PNG. */
export class MacNativeProvider implements ScreenshotCaptureProvider {
  constructor(private readonly deps: Deps = realDeps) {}

  async captureInteractive(): Promise<Buffer | null> {
    const target = this.deps.tempPath();
    await this.deps.runCli("screencapture", ["-i", "-o", target]);
    if (!(await this.deps.fileExists(target))) return null; // user pressed Esc
    const png = await this.deps.readPng(target);
    await rm(target, { force: true }).catch(() => {});
    return png;
  }
}

export function createScreenshotProvider(): ScreenshotCaptureProvider {
  return new MacNativeProvider();
}
