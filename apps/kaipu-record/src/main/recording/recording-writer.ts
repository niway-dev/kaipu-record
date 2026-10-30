import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  link,
  lstat,
  open,
  mkdir,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalRecording } from "@shared/types/library-storage";
import type { RecordingFinalizeMeta } from "@shared/types/ipc";
import { sanitizeRecordingCapture } from "@shared/recording-capture";
import { LibraryVault } from "../library/library-vault";

/** Staging folder inside the vault, so the final move is a same-volume rename. Exported for the sweep. */
export const STAGING_DIR = join(".kaipu", "tmp");

export interface RecordingWriterDeps {
  /** Current vault directory (can change at runtime). */
  vaultDir: () => string;
  /** Wall clock (ms) — injectable for tests. */
  now?: () => number;
  /** Forces every in-progress file into this directory (tests). Unset: stage inside the vault. */
  tempDir?: string;
  /** Used when the vault staging folder cannot be created. Default: os.tmpdir(). */
  fallbackTempDir?: string;
}

interface Session {
  handle: FileHandle;
  tempPath: string;
  /**
   * Tail of the serialized write chain. Chunks arrive fire-and-forget over IPC,
   * so finalize/abort await this to guarantee every positional write has hit
   * disk *before* the handle is closed (closing mid-write loses the tail).
   * Kept non-rejecting so one failed write doesn't drop the rest.
   */
  queue: Promise<void>;
  /**
   * Set to the first write error if any positional write fails (disk full,
   * permissions, ejected drive). `finalize` refuses to present a truncated file
   * as a saved recording once this is set.
   */
  failed?: Error;
  /** Handle already closed (a retried finalize must not close it twice). */
  closed?: boolean;
  /** Finalize could not place the file; the .part is kept for recovery. */
  stranded?: boolean;
  /** Finalize owns the session: a release (a page gone, a reset) must not touch it. */
  finalizing?: boolean;
}

/** Finalize could not move the finished file into the vault. The .part still exists at `tempPath`. */
export class FinalizeMoveError extends Error {
  constructor(
    readonly tempPath: string,
    readonly cause: unknown,
  ) {
    super(
      `Could not move the recording into the vault: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "FinalizeMoveError";
  }
}

/**
 * Rename, else copy (cross-volume). A failed copy removes the half-written destination, never an existing file.
 * `overwrite` is for a destination the user already confirmed replacing (the save dialog asks): rename
 * replaces on POSIX, so the copy fallback must too. Vault and sweep moves leave it off and never clobber
 * a take: a plain rename replaces silently, so they place the file with a hard link, which fails on an
 * existing destination (a volume without hard links checks that nothing is there, then renames).
 */
export async function moveFile(
  from: string,
  to: string,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  try {
    if (options.overwrite) await rename(from, to);
    else await placeExclusive(from, to);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw error;
    // EXDEV or any rename failure: fall through to copy.
  }
  try {
    await copyFile(from, to, options.overwrite ? 0 : constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") await unlink(to).catch(() => {});
    throw error;
  }
  await unlink(from).catch(() => {});
}

/** Move `from` to `to` without ever replacing a file at `to`: EEXIST if one is there. */
async function placeExclusive(from: string, to: string): Promise<void> {
  try {
    await link(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "EXDEV" || code === "ENOENT") throw error;
    // No hard links on this volume (exFAT, some network shares): check, then rename.
    if (await exists(to)) {
      throw Object.assign(new Error(`"${to}" already exists`), { code: "EEXIST" });
    }
    await rename(from, to);
    return;
  }
  await unlink(from).catch(() => {});
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Writes streamed MP4 chunks from the renderer's mediabunny StreamTarget to disk
 * at exact byte positions, then moves the finished file into the vault. The
 * StreamTarget may rewrite earlier regions (faststart patches the moov), so we
 * write positionally with `FileHandle.write(buf, 0, len, position)` — never an
 * append stream.
 */
export class RecordingWriter {
  private readonly sessions = new Map<string, Session>();
  private readonly fallbackTempDir: string;
  private readonly now: () => number;

  constructor(private readonly deps: RecordingWriterDeps) {
    this.fallbackTempDir = deps.fallbackTempDir ?? tmpdir();
    this.now = deps.now ?? (() => Date.now());
  }

  private async stagingDir(): Promise<string> {
    if (this.deps.tempDir) return this.deps.tempDir;
    try {
      const dir = join(this.deps.vaultDir(), STAGING_DIR);
      await mkdir(dir, { recursive: true });
      return dir;
    } catch {
      return this.fallbackTempDir; // vault missing/unwritable: record to tmp, finalize reports it
    }
  }

  /**
   * Open a session. An id that is already open is refused: its file may be the only copy of a
   * take. Every session gets its own staging file, created exclusively, so a new session can
   * never truncate a partial another one left behind.
   */
  async create(sessionId: string): Promise<{ tempPath: string }> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Recording session "${sessionId}" is already open`);
    }
    const dir = await this.stagingDir();
    const tempPath = join(dir, `kaipu-rec-${sessionId}-${randomUUID().slice(0, 8)}.mp4.part`);
    const handle = await open(tempPath, "wx+");
    if (this.sessions.has(sessionId)) {
      // Another create for this id won the race while this one opened its file.
      await handle.close().catch(() => {});
      await unlink(tempPath).catch(() => {});
      throw new Error(`Recording session "${sessionId}" is already open`);
    }
    this.sessions.set(sessionId, { handle, tempPath, queue: Promise.resolve() });
    return { tempPath };
  }

  async write(sessionId: string, data: ArrayBuffer, position: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No recording session "${sessionId}"`);
    const buf = Buffer.from(data);
    const op = session.queue.then(() => session.handle.write(buf, 0, buf.byteLength, position));
    // The queue tail must never reject, or a single failed write would poison
    // every subsequent one; callers still see their own write's error via `op`.
    session.queue = op.then(
      () => undefined,
      () => undefined,
    );
    try {
      await op;
    } catch (error) {
      // Remember the first failure so finalize can refuse to report success —
      // otherwise a truncated/hole-filled .part gets renamed into the vault and
      // presented as a saved recording that won't play.
      session.failed ??= error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  /** Whether any write for this session has failed (used to stop early). */
  hasFailed(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.failed !== undefined;
  }

  /**
   * Size in bytes of the session's temp file once every queued positional write has landed
   * (NIW2-218: the Small-file preset checks it against its cap before finalizing).
   */
  async stat(sessionId: string): Promise<number> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No recording session "${sessionId}"`);
    await session.queue;
    return (await session.handle.stat()).size;
  }

  async finalize(sessionId: string, meta: RecordingFinalizeMeta): Promise<LocalRecording> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No recording session "${sessionId}"`);
    if (session.finalizing) throw new Error(`Recording session "${sessionId}" is finalizing`);
    session.finalizing = true;
    try {
      return await this.finalizeSession(sessionId, session, meta);
    } finally {
      session.finalizing = false;
    }
  }

  private async finalizeSession(
    sessionId: string,
    session: Session,
    meta: RecordingFinalizeMeta,
  ): Promise<LocalRecording> {
    await session.queue; // flush in-flight positional writes before closing

    // A write failed mid-recording — the .part is truncated/holed. Refuse to move
    // it into the vault as a "saved" recording; clean up and surface the original
    // error so the renderer reports it instead of showing a corrupt file.
    if (session.failed) {
      await session.handle.close().catch(() => {});
      await unlink(session.tempPath).catch(() => {});
      this.forget(sessionId, session);
      throw session.failed;
    }

    // Resolve the destination BEFORE touching the session: a vault that vanished
    // (unplugged drive, revoked folder) must leave the take recoverable.
    // The id is allocated from the title (ADR 0032): its stub sidecar reserves the stem, so a
    // capture in the same second or a rename racing this one gets another name.
    const vaultDir = this.deps.vaultDir();
    const vault = new LibraryVault(vaultDir);
    const createdAt = this.now();
    let id: string;
    let dest: string;
    try {
      await mkdir(vaultDir, { recursive: true });
      id = await vault.allocateId({ kind: "recording", title: meta.title, createdAt });
      dest = await vault.filePath(id); // <id>.mp4 (does not exist yet)
    } catch (cause) {
      session.stranded = true;
      await this.closeHandle(session).catch(() => {});
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    await this.closeHandle(session);

    try {
      await moveFile(session.tempPath, dest);
    } catch (cause) {
      // Release the reserved stem: only its stub sidecar exists. Unless a file took the
      // destination meanwhile: then the stem is no longer this take's, and removing it would
      // delete that file.
      if (!isFileExists(cause)) await vault.remove(id).catch(() => {});
      session.stranded = true;
      throw new FinalizeMoveError(session.tempPath, cause);
    }

    // From the move on, the take is in the vault: if its metadata cannot be written, it is
    // taken back out, so no `.mp4` is left in the vault without its sidecar, and the take
    // stays salvageable from the staging file.
    let recording: LocalRecording;
    try {
      // Renderer-supplied, so validated before it lands on disk; exports send none.
      const capture = sanitizeRecordingCapture(meta.capture);
      await vault.writeMeta(id, {
        title: meta.title,
        durationSeconds: meta.durationSeconds,
        ...(capture ? { capture } : {}),
        createdAt,
        derivedFromAssetId: meta.derivedFromAssetId ?? null,
        ...(meta.exportPreset ? { exportPreset: meta.exportPreset } : {}),
        ...(isFingerprint(meta.exportFingerprint)
          ? { exportFingerprint: meta.exportFingerprint }
          : {}),
      });
      if (meta.thumbnail) await vault.writeThumbnail(id, Buffer.from(meta.thumbnail));
      const described = await vault.describe(id);
      if (!described) throw new Error(`Finalized recording "${id}" not found in vault`);
      recording = described;
    } catch (cause) {
      if (!(await this.takeBack(vault, id, dest, session))) {
        // The media stays in the vault (listed without its sidecar) and staging has nothing
        // left: a salvage would fail, so the error must not offer one.
        this.forget(sessionId, session);
        throw cause;
      }
      session.stranded = true;
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    this.forget(sessionId, session);
    return recording;
  }

  /** Drop `session` from the map, only while it is still the one under `sessionId`. */
  private forget(sessionId: string, session: Session): void {
    if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
  }

  /** The open session under `sessionId`, if it is the one whose staging file is `tempPath`. */
  private bound(sessionId: string, tempPath?: string): Session | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || (tempPath !== undefined && session.tempPath !== tempPath)) return undefined;
    return session;
  }

  /**
   * Move a finalized take back from the vault to its staging path and remove what was written
   * for it. If the media cannot be moved back, the vault keeps it: removing it would lose it.
   * Resolves whether the take is back in staging.
   */
  private async takeBack(
    vault: LibraryVault,
    id: string,
    dest: string,
    session: Session,
  ): Promise<boolean> {
    try {
      await moveFile(dest, session.tempPath, { overwrite: true });
    } catch {
      return false;
    }
    await vault.remove(id).catch(() => {});
    return true;
  }

  private async closeHandle(session: Session): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    await session.handle.close();
  }

  /** Move a stranded take to a path the user picked, then forget the session. */
  async salvage(sessionId: string, destPath: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.stranded) throw new Error(`No stranded recording session "${sessionId}"`);
    await moveFile(session.tempPath, destPath, { overwrite: true }); // the save dialog confirmed it
    this.sessions.delete(sessionId);
  }

  /** Ids of the sessions still open (a stranded take included), e.g. to end them all on a reset. */
  ids(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Close every open session without deleting its file, for a take whose renderer is gone
   * (crash, window closed mid-take): the partial `.part` stays on disk, but no handle is
   * leaked. A stranded take is kept, so the save dialog can still salvage it.
   */
  async releaseAll(): Promise<void> {
    await Promise.all(this.ids().map((id) => this.release(id)));
  }

  /**
   * `releaseAll` for one session: a take whose page is gone (a reload) is not a discard, so
   * its `.part` stays for the stranded-take sweep. Only `abort` (the user cancelled) deletes.
   * With `tempPath`, only the session that owns that staging file is released, never a later
   * one under the same id. A session being finalized belongs to its finalize.
   */
  async release(sessionId: string, tempPath?: string): Promise<void> {
    const session = this.bound(sessionId, tempPath);
    if (!session || session.stranded || session.finalizing) return;
    this.sessions.delete(sessionId);
    await session.queue;
    await this.closeHandle(session).catch(() => {});
  }

  /**
   * Discard an export's partial, a stranded one included: an export's source is still in the
   * library, so its partial is no take to recover, and a kept one would be swept up as a
   * recording. Bound to the session that owns `tempPath` (required), so it can never reach a
   * recording's partial or a later session; a finalized take is no longer a session, so its
   * vault file is never touched.
   */
  async discardExport(sessionId: string, tempPath: string): Promise<void> {
    const session = this.bound(sessionId, tempPath);
    if (!session || session.finalizing) return;
    this.sessions.delete(sessionId);
    await session.queue;
    await this.closeHandle(session).catch(() => {});
    await unlink(session.tempPath).catch(() => {});
  }

  /** Discard a session and its partial. `tempPath` binds it to one session, as in `release`. */
  async abort(sessionId: string, tempPath?: string): Promise<void> {
    const session = this.bound(sessionId, tempPath);
    if (!session || session.finalizing) return;
    // A stranded take is kept on disk for recovery. The renderer aborts after every failed finalize.
    if (session.stranded) {
      this.sessions.delete(sessionId);
      return;
    }
    this.sessions.delete(sessionId);
    await session.queue; // let in-flight writes settle before closing the handle
    await this.closeHandle(session).catch(() => {});
    await unlink(session.tempPath).catch(() => {});
  }
}

/** The move found a file at its destination (it never replaces one). */
export function isFileExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "EEXIST";
}

/** A renderer-supplied export fingerprint: a short token ("whole" or "edit:<hash>"). */
function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}
