import { readdirSync, rmSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertAllowedUrl,
  assertDiskSpace,
  defaultStatfs,
  DownloadError,
  downloadVerifiedFile,
  hashFile,
  toDownloadError,
  type DownloadErrorCode,
  type StatfsImpl,
} from "../download-file";
import { listModels, type ModelCatalogEntry } from "./catalog";

/**
 * Consented, verified, cancellable model download (ADR 0062, decision 5).
 *
 * Files stream into `<rootDir>/<id>.partial/`, each hashed while it is written. Any mismatch,
 * cancel or error deletes the partial directory. Only after every file verified does ONE rename
 * move the directory to `<rootDir>/<id>/`, so the engine never sees a half-installed model.
 */

export type ModelStoreErrorCode = DownloadErrorCode;

/** What `download` rejects with: the shared download's error, named for the model store. */
export class ModelStoreError extends DownloadError {
  constructor(code: ModelStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = "ModelStoreError";
  }
}

export interface DownloadProgress {
  id: string;
  receivedBytes: number;
  totalBytes: number;
  fileName: string;
}

export type ModelStatus =
  | { state: "missing" }
  | { state: "downloading"; receivedBytes: number; totalBytes: number }
  | { state: "ready"; dir: string }
  | { state: "failed"; reason: string };

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "size-mismatch" | "hash-mismatch"; fileName: string };

export interface ModelStoreOptions {
  /** `userData/models`. */
  rootDir: string;
  /** Defaults to the real catalog; tests pass their own small one. */
  catalog?: readonly ModelCatalogEntry[];
  fetchImpl?: typeof fetch;
  /** Free-space probe; defaults to `fs.statfs` (blocks available times block size). */
  statfsImpl?: StatfsImpl;
  /** Deletes a directory tree in `remove`; tests hold it open to pin the ordering. */
  rmImpl?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  now?: () => number;
  /** Lets tests serve from `http://127.0.0.1`. Production accepts `https:` only. */
  allowInsecureHttpForTests?: boolean;
  /** Minimum gap between progress callbacks. Default 200 ms (5 per second). */
  progressIntervalMs?: number;
}

/** Free space the disk must have, as a multiple of the model size. */
const DISK_SPACE_FACTOR = 1.2;
const PARTIAL_SUFFIX = ".partial";

type ProgressListener = (progress: DownloadProgress) => void;

interface ActiveDownload {
  id: string;
  controller: AbortController;
  promise: Promise<string>;
  listeners: Set<ProgressListener>;
  receivedBytes: number;
  totalBytes: number;
}

export class ModelStore {
  private readonly rootDir: string;
  private readonly catalog: readonly ModelCatalogEntry[];
  private readonly fetchImpl: typeof fetch;
  private readonly statfsImpl: StatfsImpl;
  private readonly rmImpl: NonNullable<ModelStoreOptions["rmImpl"]>;
  private readonly now: () => number;
  private readonly allowInsecureHttp: boolean;
  private readonly progressIntervalMs: number;
  private active: ActiveDownload | null = null;
  private readonly failures = new Map<string, string>();

  constructor(options: ModelStoreOptions) {
    this.rootDir = resolve(options.rootDir);
    this.catalog = options.catalog ?? listModels();
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.statfsImpl = options.statfsImpl ?? defaultStatfs;
    this.rmImpl = options.rmImpl ?? ((path, rmOptions) => rm(path, rmOptions));
    this.now = options.now ?? Date.now;
    this.allowInsecureHttp = options.allowInsecureHttpForTests ?? false;
    this.progressIntervalMs = options.progressIntervalMs ?? 200;
    this.cleanStale();
  }

  /** The absolute directory the model installs into: what the consent prompt shows. */
  destination(id: string): string {
    return join(this.rootDir, this.entry(id).id);
  }

  status(id: string): ModelStatus {
    const entry = this.entry(id);
    if (this.active?.id === entry.id) {
      return {
        state: "downloading",
        receivedBytes: this.active.receivedBytes,
        totalBytes: this.active.totalBytes,
      };
    }
    const dir = this.locate(entry.id);
    if (dir) return { state: "ready", dir };
    const failure = this.failures.get(entry.id);
    if (failure !== undefined) return { state: "failed", reason: failure };
    return { state: "missing" };
  }

  /**
   * The model directory, only when it is complete and every file's size matches the catalog.
   * A cheap check: the full SHA-256 runs at download time and in `verify`.
   */
  locate(id: string): string | null {
    const entry = this.entry(id);
    if (this.active?.id === entry.id) return null;
    const dir = this.destination(entry.id);
    try {
      for (const file of entry.files) {
        const stat = statSync(join(dir, file.name));
        if (!stat.isFile() || stat.size !== file.sizeBytes) return null;
      }
    } catch {
      return null;
    }
    return dir;
  }

  /** Re-hash every installed file. Slow (reads the whole model); call it on demand. */
  async verify(id: string): Promise<VerifyResult> {
    const entry = this.entry(id);
    const dir = this.destination(entry.id);
    for (const file of entry.files) {
      const path = join(dir, file.name);
      let size: number;
      try {
        size = statSync(path).size;
      } catch {
        return { ok: false, reason: "missing", fileName: file.name };
      }
      if (size !== file.sizeBytes) {
        return { ok: false, reason: "size-mismatch", fileName: file.name };
      }
      if ((await hashFile(path)) !== file.sha256) {
        return { ok: false, reason: "hash-mismatch", fileName: file.name };
      }
    }
    return { ok: true };
  }

  /**
   * Download and install a model. A second call for the id already downloading returns the
   * same promise; a call for another id while one runs rejects with `busy`. A caller that joins
   * a running download only gets its `onProgress` listener added (kept until the download ends):
   * its `signal` is ignored, so cancel through `cancel(id)`.
   */
  download(id: string, onProgress: ProgressListener, signal?: AbortSignal): Promise<string> {
    let entry: ModelCatalogEntry;
    try {
      entry = this.entry(id);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.active) {
      if (this.active.id === entry.id) {
        this.active.listeners.add(onProgress);
        return this.active.promise;
      }
      return Promise.reject(
        new ModelStoreError(
          "busy",
          `Cannot download ${entry.id}: ${this.active.id} is already downloading.`,
        ),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(new ModelStoreError("cancelled", "The download was cancelled."));
    }
    const ready = this.locate(entry.id);
    if (ready) return Promise.resolve(ready);

    this.failures.delete(entry.id);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const active: ActiveDownload = {
      id: entry.id,
      controller,
      promise: undefined as unknown as Promise<string>,
      listeners: new Set([onProgress]),
      receivedBytes: 0,
      totalBytes: entry.sizeBytes,
    };
    this.active = active;
    active.promise = this.run(entry, active).then(
      (dir) => {
        this.finish(active, onAbort, signal);
        return dir;
      },
      (error: unknown) => {
        this.finish(active, onAbort, signal);
        const failure = toStoreError(error, controller.signal);
        if (failure.code !== "cancelled") this.failures.set(entry.id, failure.message);
        throw failure;
      },
    );
    return active.promise;
  }

  /** Stop a running download of this model. No-op when none runs. */
  cancel(id: string): void {
    if (this.active?.id === id) this.active.controller.abort();
  }

  /** Delete the installed model and any partial download. Cancels a running one first. */
  async remove(id: string): Promise<void> {
    const entry = this.entry(id);
    const running = this.active;
    if (running?.id === entry.id) {
      running.controller.abort();
      await running.promise.catch(() => undefined);
    }
    await this.rmImpl(this.destination(entry.id), { recursive: true, force: true });
    // A download of this model may have started while the install was being deleted: the
    // partial directory is then its live one, and `run` already cleared any older leftover.
    if (this.active?.id !== entry.id) {
      await this.rmImpl(this.partialDir(entry.id), { recursive: true, force: true });
    }
    this.failures.delete(entry.id);
  }

  /** Delete `*.partial` directories a crash left behind. Skips the one being written. */
  cleanStale(): void {
    let names: string[];
    try {
      names = readdirSync(this.rootDir);
    } catch {
      return;
    }
    const writing = this.active ? `${this.active.id}${PARTIAL_SUFFIX}` : null;
    for (const name of names) {
      if (name.endsWith(PARTIAL_SUFFIX) && name !== writing) {
        rmSync(join(this.rootDir, name), { recursive: true, force: true });
      }
    }
  }

  private entry(id: string): ModelCatalogEntry {
    const found = this.catalog.find((model) => model.id === id);
    if (!found) throw new Error(`Unknown model id: ${id}`);
    return found;
  }

  private partialDir(id: string): string {
    return join(this.rootDir, `${id}${PARTIAL_SUFFIX}`);
  }

  private finish(active: ActiveDownload, onAbort: () => void, signal?: AbortSignal): void {
    signal?.removeEventListener("abort", onAbort);
    if (this.active === active) this.active = null;
  }

  private async run(entry: ModelCatalogEntry, active: ActiveDownload): Promise<string> {
    const { signal } = active.controller;
    const partial = this.partialDir(entry.id);
    const finalDir = this.destination(entry.id);
    try {
      for (const file of entry.files) assertAllowedUrl(file.url, this.allowInsecureHttp);
      await mkdir(this.rootDir, { recursive: true });
      await assertDiskSpace(
        this.rootDir,
        entry.sizeBytes * DISK_SPACE_FACTOR,
        entry.id,
        this.statfsImpl,
      );
      await rm(partial, { recursive: true, force: true });
      await mkdir(partial, { recursive: true });

      let lastEmitAt = Number.NEGATIVE_INFINITY;
      let lastEmittedBytes = -1;
      let lastFileName = entry.files[0]?.name ?? "";
      const emit = (fileName: string) => {
        lastEmitAt = this.now();
        lastEmittedBytes = active.receivedBytes;
        for (const listener of active.listeners) {
          listener({
            id: entry.id,
            receivedBytes: active.receivedBytes,
            totalBytes: active.totalBytes,
            fileName,
          });
        }
      };

      for (const file of entry.files) {
        lastFileName = file.name;
        await downloadVerifiedFile({
          url: file.url,
          name: file.name,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          path: join(partial, file.name),
          signal,
          fetchImpl: this.fetchImpl,
          allowInsecureHttp: this.allowInsecureHttp,
          onBytes: (bytes) => {
            active.receivedBytes += bytes;
            if (this.now() - lastEmitAt >= this.progressIntervalMs) emit(file.name);
          },
        });
      }
      if (lastEmittedBytes !== active.receivedBytes) emit(lastFileName);

      // A leftover (incomplete) install would make the rename fail on a non-empty directory.
      await rm(finalDir, { recursive: true, force: true });
      await rename(partial, finalDir);
      return finalDir;
    } catch (error) {
      await rm(partial, { recursive: true, force: true });
      throw error;
    }
  }
}

function toStoreError(error: unknown, signal: AbortSignal): ModelStoreError {
  if (error instanceof ModelStoreError) return error;
  const base = toDownloadError(error, signal);
  return new ModelStoreError(base.code, base.message, { cause: base.cause });
}
