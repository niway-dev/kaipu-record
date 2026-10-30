import { constants } from "node:fs";
import { access, copyFile, open, mkdir, rename, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalRecording } from "@shared/types/library-storage";
import type { RecordingFinalizeMeta } from "@shared/types/ipc";
import { sanitizeRecordingCapture } from "@shared/recording-capture";
import {
  sanitizeWebcamTrackMeta,
  webcamSiblingPath,
  type RecordingWriterKind,
  type WebcamTrackMeta,
} from "@shared/webcam-track";
import { LibraryVault } from "../library/library-vault";

/** Staging folder inside the vault, so the final move is a same-volume rename. Exported for the sweep. */
export const STAGING_DIR = join(".kaipu", "tmp");

export interface RecordingWriterDeps {
  /** Current vault directory (can change at runtime). */
  vaultDir: () => string;
  /** Generates a filesystem-safe, sortable recording id. */
  newId: () => string;
  /** Wall clock (ms) — injectable for tests. */
  now?: () => number;
  /** Forces every in-progress file into this directory (tests). Unset: stage inside the vault. */
  tempDir?: string;
  /** Used when the vault staging folder cannot be created. Default: os.tmpdir(). */
  fallbackTempDir?: string;
}

interface Session {
  /** The take's id: a take has a screen session and, with the webcam on, a webcam one. */
  id: string;
  kind: RecordingWriterKind;
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
  /** Every open session, keyed by take id and kind (`sessionKey`); one map for both kinds. */
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
   * Open a session's staging file: `kaipu-rec-<id>.mp4.part` for the screen,
   * `kaipu-rec-<id>.webcam.mp4.part` for the take's webcam (ADR 0032).
   */
  async create(
    sessionId: string,
    kind: RecordingWriterKind = "screen",
  ): Promise<{ tempPath: string }> {
    const suffix = kind === "webcam" ? ".webcam.mp4.part" : ".mp4.part";
    const tempPath = join(await this.stagingDir(), `kaipu-rec-${sessionId}${suffix}`);
    // A session already under this id (a renderer restarted its counter) is released first:
    // its handle must not outlive the map entry that replaces it.
    const key = sessionKey(sessionId, kind);
    const previous = this.sessions.get(key);
    if (previous) {
      this.sessions.delete(key);
      await previous.queue;
      await this.closeHandle(previous).catch(() => {});
    }
    const handle = await open(tempPath, "w+");
    this.sessions.set(key, { id: sessionId, kind, handle, tempPath, queue: Promise.resolve() });
    return { tempPath };
  }

  async write(
    sessionId: string,
    data: ArrayBuffer,
    position: number,
    kind: RecordingWriterKind = "screen",
  ): Promise<void> {
    const session = this.sessions.get(sessionKey(sessionId, kind));
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
  hasFailed(sessionId: string, kind: RecordingWriterKind = "screen"): boolean {
    return this.sessions.get(sessionKey(sessionId, kind))?.failed !== undefined;
  }

  /**
   * Size in bytes of the session's temp file once every queued positional write has landed
   * (NIW2-218: the Small-file preset checks it against its cap before finalizing).
   */
  async stat(sessionId: string, kind: RecordingWriterKind = "screen"): Promise<number> {
    const session = this.sessions.get(sessionKey(sessionId, kind));
    if (!session) throw new Error(`No recording session "${sessionId}"`);
    await session.queue;
    return (await session.handle.stat()).size;
  }

  /**
   * Move the finished take into the vault: the screen file as `<id>.mp4`, then the webcam
   * session's file, when there is one and `meta.webcam` says it is usable, as
   * `.kaipu/<id>.webcam.mp4`, recorded on the sidecar. The webcam never fails the take: a
   * webcam that cannot be placed is dropped and the recording is saved without it.
   */
  async finalize(sessionId: string, meta: RecordingFinalizeMeta): Promise<LocalRecording> {
    const session = this.sessions.get(sessionKey(sessionId, "screen"));
    if (!session) throw new Error(`No recording session "${sessionId}"`);
    const webcamSession = this.sessions.get(sessionKey(sessionId, "webcam")) ?? null;
    await session.queue; // flush in-flight positional writes before closing

    // A write failed mid-recording — the .part is truncated/holed. Refuse to move
    // it into the vault as a "saved" recording; clean up and surface the original
    // error so the renderer reports it instead of showing a corrupt file.
    if (session.failed) {
      await session.handle.close().catch(() => {});
      await unlink(session.tempPath).catch(() => {});
      this.sessions.delete(sessionKey(sessionId, "screen"));
      if (webcamSession) await this.discard(webcamSession);
      throw session.failed;
    }

    // Resolve the destination BEFORE touching the session: a vault that vanished
    // (unplugged drive, revoked folder) must leave the take recoverable.
    const vaultDir = this.deps.vaultDir();
    const vault = new LibraryVault(vaultDir);
    const id = this.deps.newId();
    let dest: string;
    try {
      await mkdir(vaultDir, { recursive: true });
      dest = await vault.filePath(id); // <id>.mp4 (does not exist yet)
    } catch (cause) {
      await this.strand(session, webcamSession, meta);
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    await this.closeHandle(session);

    try {
      await moveFile(session.tempPath, dest);
    } catch (cause) {
      await this.strand(session, webcamSession, meta);
      throw new FinalizeMoveError(session.tempPath, cause);
    }

    // Before the sidecar, so it records the webcam only once its file is in place.
    const webcam = webcamSession ? await this.placeWebcam(vault, id, webcamSession, meta) : null;

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
        ...(webcam ? { webcam } : {}),
        createdAt: this.now(),
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
      if (!(await this.takeBack(vault, id, dest, session, webcam ? webcamSession : null))) {
        // The media stays in the vault (listed without its sidecar) and staging has nothing
        // left: a salvage would fail, so the error must not offer one.
        this.sessions.delete(sessionKey(sessionId, "screen"));
        this.sessions.delete(sessionKey(sessionId, "webcam"));
        throw cause;
      }
      session.stranded = true;
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    this.sessions.delete(sessionKey(sessionId, "screen"));
    this.sessions.delete(sessionKey(sessionId, "webcam"));
    return recording;
  }

  /**
   * Close the webcam session and move its file to `.kaipu/<id>.webcam.mp4`. Resolves the
   * sanitized meta for the sidecar, or null (and the part deleted) when the renderer sent no
   * usable meta, a write failed or the move failed. The session stays in the map until the
   * take is done, so a take-back can return the file to staging.
   */
  private async placeWebcam(
    vault: LibraryVault,
    id: string,
    webcamSession: Session,
    meta: RecordingFinalizeMeta,
  ): Promise<WebcamTrackMeta | null> {
    await webcamSession.queue;
    const webcam = sanitizeWebcamTrackMeta(meta.webcam);
    if (!webcam || webcamSession.failed) {
      await this.discard(webcamSession);
      return null;
    }
    try {
      await this.closeHandle(webcamSession);
      const dest = vault.webcamFilePath(id);
      await mkdir(dirname(dest), { recursive: true });
      await moveFile(webcamSession.tempPath, dest);
      return webcam;
    } catch (error) {
      console.error("webcam file could not be placed; the recording is saved without it", error);
      await this.discard(webcamSession);
      return null;
    }
  }

  /** Close a session and delete its part (best-effort), and forget it. */
  private async discard(session: Session): Promise<void> {
    this.sessions.delete(sessionKey(session.id, session.kind));
    await session.queue;
    await this.closeHandle(session).catch(() => {});
    await unlink(session.tempPath).catch(() => {});
  }

  /**
   * Finalize could not place the take: its parts stay in staging for a salvage. The webcam's
   * only when finalize would have placed it (`placeWebcam`): one the renderer sent no usable
   * meta for, or whose write failed, is discarded, so a salvage never hands back a broken file.
   */
  private async strand(
    session: Session,
    webcamSession: Session | null,
    meta: RecordingFinalizeMeta,
  ): Promise<void> {
    session.stranded = true;
    await this.closeHandle(session).catch(() => {});
    if (!webcamSession) return;
    await webcamSession.queue;
    if (webcamSession.failed || !sanitizeWebcamTrackMeta(meta.webcam)) {
      await this.discard(webcamSession);
      return;
    }
    webcamSession.stranded = true;
    await this.closeHandle(webcamSession).catch(() => {});
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
    webcamSession: Session | null,
  ): Promise<boolean> {
    try {
      await moveFile(dest, session.tempPath, { overwrite: true });
    } catch {
      return false;
    }
    if (webcamSession) {
      // Best-effort: a webcam that cannot come back is deleted, the screen alone is salvageable.
      const moved = await moveFile(vault.webcamFilePath(id), webcamSession.tempPath, {
        overwrite: true,
      }).then(
        () => true,
        () => false,
      );
      if (moved) webcamSession.stranded = true;
      else {
        this.sessions.delete(sessionKey(webcamSession.id, webcamSession.kind));
        await unlink(vault.webcamFilePath(id)).catch(() => {});
      }
    }
    await vault.remove(id).catch(() => {});
    return true;
  }

  private async closeHandle(session: Session): Promise<void> {
    if (session.closed) return;
    session.closed = true;
    await session.handle.close();
  }

  /**
   * Move a stranded take to a path the user picked, then forget the session. Its webcam, when
   * stranded with it, goes beside it as `<name>.webcam.mp4` (best-effort: the screen is the take).
   * The save dialog only confirmed replacing the screen file: an existing `<name>.webcam.mp4`
   * is kept, and the webcam takes the first free `<name>.webcam-<n>.mp4`.
   */
  async salvage(sessionId: string, destPath: string): Promise<void> {
    const session = this.sessions.get(sessionKey(sessionId, "screen"));
    if (!session?.stranded) throw new Error(`No stranded recording session "${sessionId}"`);
    await moveFile(session.tempPath, destPath, { overwrite: true }); // the save dialog confirmed it
    this.sessions.delete(sessionKey(sessionId, "screen"));
    const webcam = this.sessions.get(sessionKey(sessionId, "webcam"));
    if (webcam?.stranded) {
      this.sessions.delete(sessionKey(sessionId, "webcam"));
      await freeWebcamSiblingPath(destPath)
        .then((to) => moveFile(webcam.tempPath, to))
        .catch((error) => console.error("webcam salvage failed", error));
    }
  }

  /** Ids of the takes still open (a stranded take included), e.g. to end them all on a reset. */
  ids(): string[] {
    return [...new Set([...this.sessions.values()].map((session) => session.id))];
  }

  /**
   * Close every open session without deleting its file, for a take whose renderer is gone
   * (crash, window closed mid-take): the partial `.part` stays on disk, but no handle is
   * leaked. A stranded take is kept, so the save dialog can still salvage it.
   */
  async releaseAll(): Promise<void> {
    const released = [...this.sessions.entries()].filter(([, session]) => !session.stranded);
    for (const [key] of released) this.sessions.delete(key);
    await Promise.all(
      released.map(async ([, session]) => {
        await session.queue;
        await this.closeHandle(session).catch(() => {});
      }),
    );
  }

  /** Discard a take: its screen session and its webcam session, if any. */
  async abort(sessionId: string): Promise<void> {
    await Promise.all(
      (["screen", "webcam"] as const).map(async (kind) => {
        const key = sessionKey(sessionId, kind);
        const session = this.sessions.get(key);
        if (!session) return;
        // A stranded take is kept on disk for recovery. The renderer aborts after every failed
        // finalize.
        if (session.stranded) {
          this.sessions.delete(key);
          return;
        }
        await session.queue; // let in-flight writes settle before closing the handle
        await session.handle.close().catch(() => {});
        await unlink(session.tempPath).catch(() => {});
        this.sessions.delete(key);
      }),
    );
  }
}

/**
 * `<name>.webcam.mp4` beside a salvaged screen file, or `<name>.webcam-<n>.mp4` from 2 up when
 * it is taken: `moveFile` renames, and a rename replaces an existing file without asking.
 */
async function freeWebcamSiblingPath(screenPath: string): Promise<string> {
  const first = webcamSiblingPath(screenPath);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? first : first.replace(/\.webcam\.mp4$/, `.webcam-${n}.mp4`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`No free webcam file name beside "${screenPath}"`);
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** The map key of a take's session of one kind; the screen's is the bare id. */
function sessionKey(sessionId: string, kind: RecordingWriterKind): string {
  return kind === "screen" ? sessionId : `${sessionId}::${kind}`;
}

/** A renderer-supplied export fingerprint: a short token ("whole" or "edit:<hash>"). */
function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/** Default id: sortable, filesystem-safe, second-resolution timestamp. */
export function timestampId(now: number): string {
  const iso = new Date(now).toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  return `recording-${iso}`;
}
