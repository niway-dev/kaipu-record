import { spawn as nodeSpawn } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The sherpa-onnx release the app ships. `scripts/speech-engine.lock` pins the same version for
 * the fetch script; `engine-locator.test.ts` fails when the two differ, so a bump touches both.
 */
export const PINNED_ENGINE_VERSION = "1.13.8";

const CLI_NAME = "sherpa-onnx-offline";
/** Ships in the same archive and is the only binary that prints the release version. */
const VERSION_NAME = "sherpa-onnx-version";
const HANDSHAKE_TIMEOUT_MS = 10_000;

export type EngineUnavailableReason =
  | "unsupported-platform"
  | "binary-missing"
  | "handshake-failed";

export type EngineLocation =
  | { available: true; cliPath: string; libDir: string; version: string }
  | { available: false; reason: EngineUnavailableReason };

export interface LocateEngineOptions {
  resourcesPath: string;
  appPath?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  existsSync?: (path: string) => boolean;
  spawn?: typeof nodeSpawn;
  handshakeTimeoutMs?: number;
}

/** `<root>/resources/native/sherpa-onnx`, in the dev tree first, then under asar.unpacked. */
export function engineDir(
  resourcesPath: string,
  appPath: string | undefined,
  existsSync: (path: string) => boolean = nodeExistsSync,
): string {
  if (appPath) {
    for (const root of [appPath, join(appPath, "..", "..")]) {
      const dev = join(root, "resources", "native", "sherpa-onnx");
      if (existsSync(join(dev, "bin", CLI_NAME))) return dev;
    }
  }
  return join(resourcesPath, "app.asar.unpacked", "resources", "native", "sherpa-onnx");
}

interface ProbeResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a binary to completion with a short deadline; never rejects, never leaves it running. */
function probe(
  spawnImpl: typeof nodeSpawn,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProbeResult | undefined> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (result: ProbeResult | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: ReturnType<typeof nodeSpawn>;
    try {
      child = spawnImpl(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(undefined);
    }, timeoutMs);
    // Bounded: a version line or a usage text is a few KB; anything past 64 KB is ignored.
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 65536) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 65536) stderr += chunk.toString("utf8");
    });
    child.on("error", () => finish(undefined));
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });
}

/** `sherpa-onnx version : 1.13.8` -> `1.13.8` */
export function parseEngineVersion(output: string): string | undefined {
  return /sherpa-onnx version\s*:\s*(\S+)/.exec(output)?.[1];
}

/**
 * Finds the bundled `sherpa-onnx-offline` and checks it is the pinned release.
 *
 * Handshake: `sherpa-onnx-version` must print `sherpa-onnx version : <pinned>` (this also proves
 * `libonnxruntime.dylib` loads through the shared rpath), and `sherpa-onnx-offline --help` must
 * exit 0 (this proves the CLI itself starts). The CLI has no `--version` of its own: it prints
 * its usage for that flag. Never throws.
 */
export async function locateEngine(options: LocateEngineOptions): Promise<EngineLocation> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== "darwin" || arch !== "arm64") {
    return { available: false, reason: "unsupported-platform" };
  }
  const exists = options.existsSync ?? nodeExistsSync;
  const dir = engineDir(options.resourcesPath, options.appPath, exists);
  const cliPath = join(dir, "bin", CLI_NAME);
  const libDir = join(dir, "lib");
  const versionPath = join(dirname(cliPath), VERSION_NAME);
  if (!exists(cliPath) || !exists(versionPath)) {
    return { available: false, reason: "binary-missing" };
  }

  const spawnImpl = options.spawn ?? nodeSpawn;
  const timeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const versionRun = await probe(spawnImpl, versionPath, [], timeoutMs);
  const version = versionRun?.code === 0 ? parseEngineVersion(versionRun.stdout) : undefined;
  if (version !== PINNED_ENGINE_VERSION) {
    return { available: false, reason: "handshake-failed" };
  }
  const cliRun = await probe(spawnImpl, cliPath, ["--help"], timeoutMs);
  if (cliRun?.code !== 0) return { available: false, reason: "handshake-failed" };

  return { available: true, cliPath, libDir, version };
}
