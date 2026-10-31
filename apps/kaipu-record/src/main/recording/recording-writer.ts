import { constants } from "node:fs";
import { copyFile, open, mkdir, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalRecording } from "@shared/types/library-storage";
import type { RecordingFinalizeMeta } from "@shared/types/ipc";
import { sanitizeRecordingCapture } from "@shared/recording-capture";
import { LibraryVault } from "../library/library-vault";

/** Staging folder inside the vault, so the final move is a same-volume rename. Exported for the sweep. */
export const STAGING_DIR = join(".kaipu", "tmp");

export interface RecordingWriterDeps {
  /**
   * The active workspace's folder, resolved ONCE per take, at `create()`: the take, its
   * finalize and its cursor track all use that folder, so a switch can never split a take
   * (ADR 0032, decision 5). Throws when the workspace is not connected, which refuses the
   * take instead of saving it anywhere else.
   */
  vaultDir: () => string | Promise<string>;
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
  /** The vault folder bound when the take started; finalize moves the take there only. */
  vaultDir: string;
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
 * replaces on POSIX, so the copy fallback must too. Vault and sweep moves leave it off and never clobber a take.
 */
export async function moveFile(
  from: string,
  to: string,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  try {
    await rename(from, to);
    return;
  } catch {
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

  private async stagingDir(vaultDir: string): Promise<string> {
    if (this.deps.tempDir) return this.deps.tempDir;
    try {
      const dir = join(vaultDir, STAGING_DIR);
      await mkdir(dir, { recursive: true });
      return dir;
    } catch {
      return this.fallbackTempDir; // vault missing/unwritable: record to tmp, finalize reports it
    }
  }

  async create(sessionId: string): Promise<{ tempPath: string }> {
    // Outside the staging fallback on purpose: a workspace that is not connected refuses
    // the take here, it does not record into the temp folder.
    const vaultDir = await this.deps.vaultDir();
    const tempPath = join(await this.stagingDir(vaultDir), `kaipu-rec-${sessionId}.mp4.part`);
    // A session already under this id (a renderer restarted its counter) is released first:
    // its handle must not outlive the map entry that replaces it.
    const previous = this.sessions.get(sessionId);
    if (previous) {
      this.sessions.delete(sessionId);
      await previous.queue;
      await this.closeHandle(previous).catch(() => {});
    }
    const handle = await open(tempPath, "w+");
    this.sessions.set(sessionId, { handle, tempPath, vaultDir, queue: Promise.resolve() });
    return { tempPath };
  }

  /** The folder a session is bound to (the cursor track goes next to its take). */
  directoryOf(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.vaultDir ?? null;
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
    await session.queue; // flush in-flight positional writes before closing

    // A write failed mid-recording — the .part is truncated/holed. Refuse to move
    // it into the vault as a "saved" recording; clean up and surface the original
    // error so the renderer reports it instead of showing a corrupt file.
    if (session.failed) {
      await session.handle.close().catch(() => {});
      await unlink(session.tempPath).catch(() => {});
      this.sessions.delete(sessionId);
      throw session.failed;
    }

    // The folder bound at create(), never the one active now. Checked BEFORE touching the
    // session: a vault that vanished (unplugged drive, revoked folder) must leave the take
    // recoverable, and is never recreated (that would hide the take in an empty folder).
    // The id is allocated from the title (ADR 0035): its stub sidecar reserves the stem, so a
    // capture in the same second or a rename racing this one gets another name.
    const vaultDir = session.vaultDir;
    const vault = new LibraryVault(vaultDir);
    const createdAt = this.now();
    let id: string;
    let dest: string;
    try {
      if (!(await stat(vaultDir)).isDirectory()) throw new Error(`not a folder: ${vaultDir}`);
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
      // Release the reserved stem: only its stub sidecar exists.
      await vault.remove(id).catch(() => {});
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
        this.sessions.delete(sessionId);
        throw cause;
      }
      session.stranded = true;
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    this.sessions.delete(sessionId);
    return recording;
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
    const released = [...this.sessions.entries()].filter(([, session]) => !session.stranded);
    for (const [id] of released) this.sessions.delete(id);
    await Promise.all(
      released.map(async ([, session]) => {
        await session.queue;
        await this.closeHandle(session).catch(() => {});
      }),
    );
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    // A stranded take is kept on disk for recovery. The renderer aborts after every failed finalize.
    if (session.stranded) {
      this.sessions.delete(sessionId);
      return;
    }
    await session.queue; // let in-flight writes settle before closing the handle
    await session.handle.close().catch(() => {});
    await unlink(session.tempPath).catch(() => {});
    this.sessions.delete(sessionId);
  }
}

/** A renderer-supplied export fingerprint: a short token ("whole" or "edit:<hash>"). */
function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}
