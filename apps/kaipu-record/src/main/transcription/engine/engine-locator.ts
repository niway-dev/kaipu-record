import { spawn as nodeSpawn } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_ARCHIVE, ENGINE_FILES } from "./engine-catalog";

/** The release the app runs: the one `engine-catalog.ts` pins, so there is a single source. */
export const PINNED_ENGINE_VERSION = ENGINE_ARCHIVE.version;

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

export interface InspectEngineOptions {
  existsSync?: (path: string) => boolean;
  spawn?: typeof nodeSpawn;
  handshakeTimeoutMs?: number;
}

export interface LocateEngineOptions extends InspectEngineOptions {
  /** The install directory holding `bin/` and `lib/` (`EngineStore.installDir`). */
  engineDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
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
 * Checks an engine directory: every kept file is there, `sherpa-onnx-version` prints
 * `sherpa-onnx version : <pinned>` (this also proves `libonnxruntime.dylib` loads through the
 * shared rpath), and `sherpa-onnx-offline --help` exits 0 (this proves the CLI itself starts).
 * The CLI has no `--version` of its own: it prints its usage for that flag. A directory missing
 * any file is `binary-missing`, so a damaged install reads as "not installed" and can be
 * downloaded again. No platform check: the install runs it before the engine is in place.
 * Never throws.
 */
export async function inspectEngineDir(
  dir: string,
  options: InspectEngineOptions = {},
): Promise<EngineLocation> {
  const exists = options.existsSync ?? nodeExistsSync;
  if (!ENGINE_FILES.every((file) => exists(join(dir, file)))) {
    return { available: false, reason: "binary-missing" };
  }
  const cliPath = join(dir, "bin", CLI_NAME);
  const versionPath = join(dir, "bin", VERSION_NAME);

  const spawnImpl = options.spawn ?? nodeSpawn;
  const timeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const versionRun = await probe(spawnImpl, versionPath, [], timeoutMs);
  const version = versionRun?.code === 0 ? parseEngineVersion(versionRun.stdout) : undefined;
  if (version !== PINNED_ENGINE_VERSION) {
    return { available: false, reason: "handshake-failed" };
  }
  const cliRun = await probe(spawnImpl, cliPath, ["--help"], timeoutMs);
  if (cliRun?.code !== 0) return { available: false, reason: "handshake-failed" };

  return { available: true, cliPath, libDir: join(dir, "lib"), version };
}

/** The downloaded engine, when this machine can run it and the handshake passes. Never throws. */
export async function locateEngine(options: LocateEngineOptions): Promise<EngineLocation> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== "darwin" || arch !== "arm64") {
    return { available: false, reason: "unsupported-platform" };
  }
  return inspectEngineDir(options.engineDir, options);
}
