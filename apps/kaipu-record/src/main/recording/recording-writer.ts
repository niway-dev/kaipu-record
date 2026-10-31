import { randomUUID } from "node:crypto";
import { open, mkdir, stat, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalRecording } from "@shared/types/library-storage";
import { isExportDestinationId } from "@shared/types/export-preset";
import type { RecordingFinalizeMeta } from "@shared/types/ipc";
import { sanitizeRecordingCapture } from "@shared/recording-capture";
import {
  sanitizeWebcamTrackMeta,
  webcamSiblingPath,
  type RecordingWriterKind,
  type WebcamTrackMeta,
} from "@shared/webcam-track";
import { LibraryVault, type Reservation } from "../library/library-vault";
import {
  isFileExists,
  type PlacedFile,
  placeNew,
  placeNoReplace,
  removeIfSame,
  replaceConfirmed,
  takenError,
} from "../library/safe-place";

export { isFileExists };

/** Staging folder inside the vault, so the final move is a same-volume rename. Exported for the sweep. */
export const STAGING_DIR = join(".kaipu", "tmp");

/** A take's webcam part: its screen part's name with `.webcam` before `.mp4.part`. */
export function webcamPartFor(screenPart: string): string {
  return screenPart.replace(/\.mp4\.part$/, ".webcam.mp4.part");
}

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
  /** The take's id: a take has a screen session and, with the webcam on, a webcam one. */
  id: string;
  kind: RecordingWriterKind;
  handle: FileHandle;
  tempPath: string;
  /** The vault folder bound when the take started; finalize moves the take there only. */
  vaultDir: string;
  /** A webcam session: the staging file of the screen session it belongs to. */
  screenTempPath?: string;
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
 * Place a staging file at a vault path, never replacing a file there (`safe-place`): EEXIST
 * when one is, whenever it arrived. A placed staging file that cannot be removed is set aside
 * or marked, so the sweep never recovers it as a second recording.
 */
export async function placeTake(from: string, to: string): Promise<PlacedFile> {
  const placed = await placeNew(from, to);
  if (placed === "taken") throw takenError(to);
  return placed;
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

  /**
   * Open a session. An id that is already open is refused: its file may be the only copy of a
   * take. Every session gets its own staging file, created exclusively, so a new session can
   * never truncate a partial another one left behind.
   *
   * `kind` "webcam" opens the take's second session, for its webcam file (ADR 0037): beside the
   * open screen session's part, as `webcamPartFor(<screen part>)`, bound to the same folder.
   */
  async create(
    sessionId: string,
    kind: RecordingWriterKind = "screen",
  ): Promise<{ tempPath: string }> {
    if (kind === "webcam") return this.createWebcam(sessionId);
    if (this.sessions.has(sessionKey(sessionId, "screen"))) {
      throw new Error(`Recording session "${sessionId}" is already open`);
    }
    // Outside the staging fallback on purpose: a workspace that is not connected refuses
    // the take here, it does not record into the temp folder.
    const vaultDir = await this.deps.vaultDir();
    const dir = await this.stagingDir(vaultDir);
    const tempPath = join(dir, `kaipu-rec-${sessionId}-${randomUUID().slice(0, 8)}.mp4.part`);
    const handle = await open(tempPath, "wx+");
    if (this.sessions.has(sessionKey(sessionId, "screen"))) {
      // Another create for this id won the race while this one opened its file.
      await handle.close().catch(() => {});
      await unlink(tempPath).catch(() => {});
      throw new Error(`Recording session "${sessionId}" is already open`);
    }
    this.sessions.set(sessionKey(sessionId, "screen"), {
      id: sessionId,
      kind: "screen",
      handle,
      tempPath,
      vaultDir,
      queue: Promise.resolve(),
    });
    return { tempPath };
  }

  private async createWebcam(sessionId: string): Promise<{ tempPath: string }> {
    const key = sessionKey(sessionId, "webcam");
    const screen = this.sessions.get(sessionKey(sessionId, "screen"));
    if (!screen || screen.stranded || screen.finalizing || screen.closed) {
      throw new Error(`No recording session "${sessionId}" to add a webcam to`);
    }
    if (this.sessions.has(key)) {
      throw new Error(`Recording session "${sessionId}" already has a webcam`);
    }
    const tempPath = webcamPartFor(screen.tempPath);
    const handle = await open(tempPath, "wx+");
    if (this.sessions.has(key) || this.sessions.get(sessionKey(sessionId, "screen")) !== screen) {
      // Another webcam create won the race, or the screen session ended meanwhile.
      await handle.close().catch(() => {});
      await unlink(tempPath).catch(() => {});
      throw new Error(`Recording session "${sessionId}" cannot open a webcam now`);
    }
    this.sessions.set(key, {
      id: sessionId,
      kind: "webcam",
      handle,
      tempPath,
      vaultDir: screen.vaultDir,
      screenTempPath: screen.tempPath,
      queue: Promise.resolve(),
    });
    return { tempPath };
  }

  /** The folder a session is bound to (the cursor track goes next to its take). */
  directoryOf(sessionId: string): string | null {
    return this.sessions.get(sessionKey(sessionId, "screen"))?.vaultDir ?? null;
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
    if (session.finalizing) throw new Error(`Recording session "${sessionId}" is finalizing`);
    session.finalizing = true;
    const webcamSession = this.webcamOf(session);
    if (webcamSession) webcamSession.finalizing = true;
    try {
      return await this.finalizeSession(session, webcamSession, meta);
    } finally {
      session.finalizing = false;
      if (webcamSession) webcamSession.finalizing = false;
    }
  }

  private async finalizeSession(
    session: Session,
    webcamSession: Session | null,
    meta: RecordingFinalizeMeta,
  ): Promise<LocalRecording> {
    await session.queue; // flush in-flight positional writes before closing

    // A write failed mid-recording — the .part is truncated/holed. Refuse to move
    // it into the vault as a "saved" recording; clean up and surface the original
    // error so the renderer reports it instead of showing a corrupt file.
    if (session.failed) {
      await session.handle.close().catch(() => {});
      await unlink(session.tempPath).catch(() => {});
      this.forget(session);
      if (webcamSession) await this.discard(webcamSession);
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
    let reservation: Reservation;
    let id: string;
    let dest: string;
    try {
      if (!(await stat(vaultDir)).isDirectory()) throw new Error(`not a folder: ${vaultDir}`);
      reservation = await vault.reserve({ kind: "recording", title: meta.title, createdAt });
      id = reservation.id;
      dest = await vault.filePath(id); // <id>.mp4 (does not exist yet)
    } catch (cause) {
      await this.strand(session, webcamSession, meta);
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    try {
      await this.closeHandle(session);
    } catch (cause) {
      // The bytes are in the staging file, which is the only copy: strand the take so the
      // renderer's abort after a failed finalize keeps it for salvage or the sweep.
      await vault.releaseReservation(reservation).catch(() => {});
      await this.strand(session, webcamSession, meta);
      throw new FinalizeMoveError(session.tempPath, cause);
    }

    let placed: PlacedFile;
    try {
      placed = await placeTake(session.tempPath, dest);
    } catch (cause) {
      // Release the reserved stem (its stub sidecar): never the media path, which may hold a
      // file that took it meanwhile.
      await vault.releaseReservation(reservation).catch(() => {});
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
        ...(webcam ? { webcam: webcam.meta } : {}),
        createdAt,
        derivedFromAssetId: meta.derivedFromAssetId ?? null,
        ...(meta.exportPreset ? { exportPreset: meta.exportPreset } : {}),
        ...(isFingerprint(meta.exportFingerprint)
          ? { exportFingerprint: meta.exportFingerprint }
          : {}),
        ...(isExportDestinationId(meta.exportDestination)
          ? { exportDestination: meta.exportDestination }
          : {}),
      });
      if (meta.thumbnail) await vault.writeThumbnail(id, Buffer.from(meta.thumbnail));
      const described = await vault.describe(id);
      if (!described) throw new Error(`Finalized recording "${id}" not found in vault`);
      recording = described;
    } catch (cause) {
      const media = { path: dest, file: placed };
      if (!(await this.takeBack(vault, reservation, media, session, webcam))) {
        // The media stays in the vault (listed without its sidecar) and staging has nothing
        // left: a salvage would fail, so the error must not offer one.
        this.forget(session);
        if (webcamSession) this.forget(webcamSession);
        throw cause;
      }
      session.stranded = true;
      throw new FinalizeMoveError(session.tempPath, cause);
    }
    this.forget(session);
    if (webcamSession) this.forget(webcamSession);
    return recording;
  }

  /** The webcam session of `screen`'s take, if one is open for that very screen session. */
  private webcamOf(screen: Session): Session | null {
    const webcam = this.sessions.get(sessionKey(screen.id, "webcam"));
    return webcam && webcam.screenTempPath === screen.tempPath ? webcam : null;
  }

  /**
   * Close the webcam session and move its file to `.kaipu/<id>.webcam.mp4`, never replacing a
   * file there. Resolves the sanitized meta for the sidecar and the placed file, or null (and
   * the part deleted) when the renderer sent no usable meta, a write failed or the move failed.
   * The session stays in the map until the take is done, so a take-back can return the file to
   * staging.
   */
  private async placeWebcam(
    vault: LibraryVault,
    id: string,
    webcamSession: Session,
    meta: RecordingFinalizeMeta,
  ): Promise<PlacedWebcam | null> {
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
      const file = await placeTake(webcamSession.tempPath, dest);
      return { meta: webcam, path: dest, file, session: webcamSession };
    } catch (error) {
      console.error("webcam file could not be placed; the recording is saved without it", error);
      await this.discard(webcamSession);
      return null;
    }
  }

  /** Close a session and delete its part (best-effort), and forget it. */
  private async discard(session: Session): Promise<void> {
    this.forget(session);
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

  /** Drop `session` from the map, only while it is still the one under its key. */
  private forget(session: Session): void {
    const key = sessionKey(session.id, session.kind);
    if (this.sessions.get(key) === session) this.sessions.delete(key);
  }

  /** The open screen session under `sessionId`, if it is the one whose staging file is `tempPath`. */
  private bound(sessionId: string, tempPath?: string): Session | undefined {
    const session = this.sessions.get(sessionKey(sessionId, "screen"));
    if (!session || (tempPath !== undefined && session.tempPath !== tempPath)) return undefined;
    return session;
  }

  /**
   * Move a finalized take back from the vault to its staging path and remove what was written
   * for it. Only the file placement created moves: another file at `dest` stays where it is.
   * If the media cannot be moved back, the vault keeps it: removing it would lose it.
   * Resolves whether the take is back in staging.
   */
  private async takeBack(
    vault: LibraryVault,
    reservation: Reservation,
    media: { path: string; file: PlacedFile },
    session: Session,
    webcam: PlacedWebcam | null,
  ): Promise<boolean> {
    try {
      // Back to its own staging name, never a replacing move. A vault copy that cannot be
      // removed undoes it: the take stays in the vault rather than in two places.
      const back = await placeNoReplace(media.path, session.tempPath, {
        stuck: "rollback",
        expect: media.file,
      });
      if (back === "taken") return false;
    } catch {
      return false;
    }
    if (webcam) {
      // Best-effort: a webcam that cannot come back is deleted, the screen alone is salvageable.
      const moved = await placeNoReplace(webcam.path, webcam.session.tempPath, {
        stuck: "rollback",
        expect: webcam.file,
      }).then(
        (back) => back === "placed",
        () => false,
      );
      if (moved) webcam.session.stranded = true;
      else {
        this.forget(webcam.session);
        await removeIfSame(webcam.path, webcam.file).catch(() => false);
      }
    }
    await vault.releaseReservation(reservation).catch(() => {});
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
    const webcam = this.webcamOf(session);
    await replaceConfirmed(session.tempPath, destPath); // the save dialog confirmed replacing
    this.forget(session);
    if (webcam?.stranded) {
      this.forget(webcam);
      // The save dialog only confirmed replacing the screen file: never a webcam file there.
      await placeWebcamBeside(webcam.tempPath, destPath).catch((error) =>
        console.error("webcam salvage failed", error),
      );
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
    await Promise.all(this.ids().map((id) => this.release(id)));
  }

  /**
   * `releaseAll` for one take: a take whose page is gone (a reload) is not a discard, so
   * its `.part` files stay for the stranded-take sweep. Only `abort` (the user cancelled) deletes.
   * With `tempPath`, only the take whose screen session owns that staging file is released,
   * never a later one under the same id. A session being finalized belongs to its finalize.
   */
  async release(sessionId: string, tempPath?: string): Promise<void> {
    const session = this.bound(sessionId, tempPath);
    const webcam = session ? this.webcamOf(session) : this.loneWebcam(sessionId, tempPath);
    await Promise.all(
      [session, webcam].map(async (s) => {
        if (!s || s.stranded || s.finalizing) return;
        this.forget(s);
        await s.queue;
        await this.closeHandle(s).catch(() => {});
      }),
    );
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
    this.forget(session);
    await session.queue;
    await this.closeHandle(session).catch(() => {});
    await unlink(session.tempPath).catch(() => {});
  }

  /**
   * Discard a take and its partials: its screen session and its webcam session, if any.
   * `tempPath` binds it to one take, as in `release`.
   */
  async abort(sessionId: string, tempPath?: string): Promise<void> {
    const session = this.bound(sessionId, tempPath);
    const webcam = session ? this.webcamOf(session) : this.loneWebcam(sessionId, tempPath);
    await Promise.all(
      [session, webcam].map(async (s) => {
        if (!s || s.finalizing) return;
        // A stranded take is kept on disk for recovery. The renderer aborts after every failed
        // finalize.
        if (s.stranded) {
          this.forget(s);
          return;
        }
        this.forget(s);
        await s.queue; // let in-flight writes settle before closing the handle
        await this.closeHandle(s).catch(() => {});
        await unlink(s.tempPath).catch(() => {});
      }),
    );
  }

  /**
   * A webcam session whose screen session is gone (a salvage moved the screen, or the webcam
   * was kept by a take-back): reachable only by an unbound end, or one bound to its screen part.
   */
  private loneWebcam(sessionId: string, tempPath?: string): Session | null {
    const webcam = this.sessions.get(sessionKey(sessionId, "webcam"));
    if (!webcam) return null;
    if (tempPath !== undefined && webcam.screenTempPath !== tempPath) return null;
    return webcam;
  }
}

/** The webcam file finalize placed in the vault, so a take-back can move it out again. */
interface PlacedWebcam {
  meta: WebcamTrackMeta;
  path: string;
  file: PlacedFile;
  session: Session;
}

/**
 * Place a salvaged webcam part beside its screen file as `<name>.webcam.mp4`, or
 * `<name>.webcam-<n>.mp4` from 2 up when that is taken: never replacing a file there
 * (`safe-place`), so an existing webcam file beside it is kept.
 */
async function placeWebcamBeside(from: string, screenPath: string): Promise<string> {
  const first = webcamSiblingPath(screenPath);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? first : first.replace(/\.webcam\.mp4$/, `.webcam-${n}.mp4`);
    if ((await placeNoReplace(from, candidate)) === "placed") return candidate;
  }
  throw new Error(`No free webcam file name beside "${screenPath}"`);
}

/** The map key of a take's session of one kind; the screen's is the bare id. */
function sessionKey(sessionId: string, kind: RecordingWriterKind): string {
  return kind === "screen" ? sessionId : `${sessionId}::${kind}`;
}

/** A renderer-supplied export fingerprint: a short token ("whole" or "edit:<hash>"). */
function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}
