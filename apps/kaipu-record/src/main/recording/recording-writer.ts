import { copyFile, open, mkdir, rename, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalRecording } from "@shared/types/library-storage";
import type { RecordingFinalizeMeta } from "@shared/types/ipc";
import { LibraryVault } from "../library/library-vault";

export interface RecordingWriterDeps {
  /** Current vault directory (can change at runtime). */
  vaultDir: () => string;
  /** Generates a filesystem-safe, sortable recording id. */
  newId: () => string;
  /** Wall clock (ms) — injectable for tests. */
  now?: () => number;
  /** Temp directory for in-progress files. */
  tempDir?: string;
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
  private readonly tempDir: string;
  private readonly now: () => number;

  constructor(private readonly deps: RecordingWriterDeps) {
    this.tempDir = deps.tempDir ?? tmpdir();
    this.now = deps.now ?? (() => Date.now());
  }

  async create(sessionId: string): Promise<{ tempPath: string }> {
    const tempPath = join(this.tempDir, `kaipu-rec-${sessionId}.mp4.part`);
    const handle = await open(tempPath, "w+");
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
    await op;
  }

  async finalize(sessionId: string, meta: RecordingFinalizeMeta): Promise<LocalRecording> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No recording session "${sessionId}"`);
    await session.queue; // flush in-flight positional writes before closing
    await session.handle.close();
    this.sessions.delete(sessionId);

    const vault = new LibraryVault(this.deps.vaultDir());
    const id = this.deps.newId();
    await mkdir(this.deps.vaultDir(), { recursive: true });
    const dest = await vault.filePath(id); // <id>.mp4 (does not exist yet)

    try {
      await rename(session.tempPath, dest);
    } catch {
      await copyFile(session.tempPath, dest);
      await unlink(session.tempPath).catch(() => {});
    }

    await vault.writeMeta(id, {
      title: meta.title,
      durationSeconds: meta.durationSeconds,
      createdAt: this.now(),
    });
    if (meta.thumbnail) await vault.writeThumbnail(id, Buffer.from(meta.thumbnail));

    const recording = await vault.describe(id);
    if (!recording) throw new Error(`Finalized recording "${id}" not found in vault`);
    return recording;
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await session.queue; // let in-flight writes settle before closing the handle
    await session.handle.close().catch(() => {});
    await unlink(session.tempPath).catch(() => {});
    this.sessions.delete(sessionId);
  }
}

/** Default id: sortable, filesystem-safe, second-resolution timestamp. */
export function timestampId(now: number): string {
  const iso = new Date(now).toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  return `recording-${iso}`;
}
