import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { chmod, copyFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  assertAllowedUrl,
  assertDiskSpace,
  defaultStatfs,
  DownloadError,
  downloadVerifiedFile,
  toDownloadError,
  type StatfsImpl,
} from "../download-file";
import {
  ENGINE_ARCHIVE,
  ENGINE_BINARIES,
  ENGINE_FILES,
  type EngineArchive,
} from "./engine-catalog";
import { inspectEngineDir } from "./engine-locator";

/**
 * Downloads and installs the speech engine (ADR 0062, amendment 2026-11-16).
 *
 * The archive is staged in `<root>/<version>.partial/`: downloaded, its size and SHA-256 checked
 * BEFORE anything is extracted, extracted with the system `tar`, and only the two binaries and
 * three libraries are copied into a `stage/` directory. The version handshake runs from there.
 * Only then does ONE rename move `stage/` to `<root>/<version>/`, so nothing half-installed is
 * ever at the final path. Any failure or cancel deletes the partial directory.
 */

export interface EngineStoreOptions {
  /** `userData/speech-engine`. */
  rootDir: string;
  /** Defaults to the pinned release; tests pass a small one. */
  archive?: EngineArchive;
  fetchImpl?: typeof fetch;
  statfsImpl?: StatfsImpl;
  /** Lets tests serve from `http://127.0.0.1`. Production accepts `https:` only. */
  allowInsecureHttpForTests?: boolean;
  /** Unpacks `archivePath` into `destDir`. Defaults to `/usr/bin/tar -xjf`. */
  extract?: (archivePath: string, destDir: string, signal: AbortSignal) => Promise<void>;
  /** Whether the engine in `dir` runs. Defaults to the locator's version handshake. */
  handshake?: (dir: string) => Promise<boolean>;
}

export interface EngineInstallOptions {
  /** Reinstall even when the files are there (an installed engine whose handshake fails). */
  force?: boolean;
  signal?: AbortSignal;
  /** Called with each chunk's size while the archive downloads. */
  onBytes?: (bytes: number) => void;
}

const PARTIAL_SUFFIX = ".partial";
/** Free space needed, as a multiple of the archive: the archive, its extracted tree and the copy. */
const DISK_SPACE_FACTOR = 5;
const TAR_PATH = "/usr/bin/tar";

/** `/usr/bin/tar -xjf`, spawned with an argument array (no shell), killed when `signal` aborts. */
export function extractWithTar(
  archivePath: string,
  destDir: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolveExtract, reject) => {
    const child = spawn(TAR_PATH, ["-xjf", archivePath, "-C", destDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    const onAbort = () => child.kill("SIGKILL");
    signal.addEventListener("abort", onAbort, { once: true });
    const done = (error?: Error) => {
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolveExtract();
    };
    child.on("error", (error) => done(error));
    child.on("close", (code) => {
      if (signal.aborted) done(new Error("tar was stopped"));
      else if (code === 0) done();
      else done(new Error(`tar exited with ${code}: ${stderr.trim()}`));
    });
  });
}

export class EngineStore {
  private readonly rootDir: string;
  private readonly archive: EngineArchive;
  private readonly fetchImpl: typeof fetch;
  private readonly statfsImpl: StatfsImpl;
  private readonly allowInsecureHttp: boolean;
  private readonly extract: NonNullable<EngineStoreOptions["extract"]>;
  private readonly handshake: NonNullable<EngineStoreOptions["handshake"]>;
  private inflight: Promise<string> | null = null;

  constructor(options: EngineStoreOptions) {
    this.rootDir = resolve(options.rootDir);
    this.archive = options.archive ?? ENGINE_ARCHIVE;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.statfsImpl = options.statfsImpl ?? defaultStatfs;
    this.allowInsecureHttp = options.allowInsecureHttpForTests ?? false;
    this.extract = options.extract ?? extractWithTar;
    this.handshake = options.handshake ?? (async (dir) => (await inspectEngineDir(dir)).available);
    this.cleanStale();
  }

  /** `<root>/<version>`: where the engine is, once installed. */
  get installDir(): string {
    return join(this.rootDir, this.archive.version);
  }

  /** The install directory, only when the two binaries and three libraries are all there. */
  locate(): string | null {
    const dir = this.installDir;
    return ENGINE_FILES.every((file) => existsSync(join(dir, file))) ? dir : null;
  }

  /**
   * Download and install the engine; resolves with the install directory. Calls made while one
   * install runs share its promise (and so its signal and progress callback). Resolves at once
   * when the engine is already installed, unless `force` is set. The new engine is verified and
   * staged first; only then is the old directory removed and the new one renamed into place. A
   * failure before that leaves the old directory alone; one between the remove and the rename
   * leaves no engine, and the next status offers the download again.
   */
  install(options: EngineInstallOptions = {}): Promise<string> {
    if (this.inflight) return this.inflight;
    if (options.signal?.aborted) {
      return Promise.reject(new DownloadError("cancelled", "The download was cancelled."));
    }
    const installed = options.force ? null : this.locate();
    if (installed) return Promise.resolve(installed);

    const promise = this.run(options).finally(() => {
      this.inflight = null;
    });
    this.inflight = promise;
    return promise;
  }

  /** Delete `*.partial` directories a crash left behind. Skips the one being written. */
  cleanStale(): void {
    if (this.inflight) return;
    let names: string[];
    try {
      names = readdirSync(this.rootDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.endsWith(PARTIAL_SUFFIX)) {
        rmSync(join(this.rootDir, name), { recursive: true, force: true });
      }
    }
  }

  private async run({ signal: outer, onBytes }: EngineInstallOptions): Promise<string> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    outer?.addEventListener("abort", onAbort, { once: true });
    const { signal } = controller;
    const { archive } = this;
    const partial = join(this.rootDir, `${archive.version}${PARTIAL_SUFFIX}`);
    try {
      assertAllowedUrl(archive.url, this.allowInsecureHttp);
      await mkdir(this.rootDir, { recursive: true });
      await assertDiskSpace(
        this.rootDir,
        archive.sizeBytes * DISK_SPACE_FACTOR,
        `The speech engine ${archive.version}`,
        this.statfsImpl,
      );
      await rm(partial, { recursive: true, force: true });
      await mkdir(partial, { recursive: true });

      const archivePath = join(partial, archive.archiveName);
      await downloadVerifiedFile({
        url: archive.url,
        name: archive.archiveName,
        sizeBytes: archive.sizeBytes,
        sha256: archive.sha256,
        path: archivePath,
        signal,
        fetchImpl: this.fetchImpl,
        allowInsecureHttp: this.allowInsecureHttp,
        onBytes: (bytes) => onBytes?.(bytes),
      });

      // The archive's bytes are the pinned ones. Only now is it unpacked.
      const extracted = join(partial, "extracted");
      await mkdir(extracted, { recursive: true });
      await this.step(signal, "Could not unpack the speech engine.", () =>
        this.extract(archivePath, extracted, signal),
      );

      const staged = join(partial, "stage");
      await this.step(signal, "The speech engine archive is not what was expected.", () =>
        this.keepEngineFiles(join(extracted, archive.topDir), staged),
      );
      const works = await this.step(signal, "Could not run the speech engine.", () =>
        this.handshake(staged),
      );
      // The version probe cannot be aborted, so a cancel can land while it runs and make it
      // report "unavailable". That is a cancellation, not an engine failure.
      if (signal.aborted) throw new DownloadError("cancelled", "The download was cancelled.");
      if (!works) {
        throw new DownloadError(
          "engine-failed-to-start",
          "The downloaded speech engine did not pass its version check.",
        );
      }

      // A leftover (incomplete) install would make the rename fail on a non-empty directory.
      await rm(this.installDir, { recursive: true, force: true });
      await rename(staged, this.installDir);
      await rm(partial, { recursive: true, force: true });
      return this.installDir;
    } catch (error) {
      await rm(partial, { recursive: true, force: true });
      throw toDownloadError(error, signal);
    } finally {
      outer?.removeEventListener("abort", onAbort);
    }
  }

  /** Runs one install step; its own failures become `engine-failed-to-start`, an abort `cancelled`. */
  private async step<T>(signal: AbortSignal, message: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      if (signal.aborted) throw new DownloadError("cancelled", "The download was cancelled.");
      throw new DownloadError("engine-failed-to-start", message, { cause: error });
    }
  }

  /** Copies the five kept files from the unpacked archive; refuses anything but regular files. */
  private async keepEngineFiles(sourceRoot: string, destRoot: string): Promise<void> {
    for (const file of ENGINE_FILES) {
      const source = join(sourceRoot, file);
      const stat = await lstat(source);
      if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
      const dest = join(destRoot, file);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(source, dest);
    }
    for (const binary of ENGINE_BINARIES) await chmod(join(destRoot, binary), 0o755);
  }
}
