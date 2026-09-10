import { basename, join } from "node:path";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { LocalRecording } from "@shared/types/library-storage";
import { sha256FileBase64 } from "./content-hash";

const META_DIR = ".kaipu";
/** Known video containers, in preference order — `.mp4` is what we now write. */
const VIDEO_EXTS = [".mp4", ".webm"] as const;
const IMAGE_EXTS = [".png"] as const;
const ALL_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS] as const;

/** Version 2 adds identity + provenance + hash cache. Every field stays optional so a v1 file reads fine. */
export interface Sidecar {
  sidecarVersion?: 1 | 2;
  title?: string;
  durationSeconds?: number;
  createdAt?: number;
  assetId?: string;
  derivedFromAssetId?: string | null;
  /** base64 sha256 + the file stats it was computed for; stale when they differ. */
  contentSha256?: string;
  hashedSizeBytes?: number;
  hashedMtimeMs?: number;
  /** Set by `removeLocalCopy`; cleared when a file reappears under this id. */
  localRemovedAt?: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Local recordings vault. A recording lives as `<id><ext>` (ext ∈ VIDEO_EXTS)
 * with optional sidecar metadata (`.kaipu/<id>.json`) and thumbnail
 * (`.kaipu/<id>.jpg`). The filename *is* the id. Pure: no Electron — the
 * directory is injected so it's testable against a temp folder.
 */
export class LibraryVault {
  /** Guards `ensureIdentity` so two parallel `describe(id)` calls never mint two ids for the same id. */
  private readonly identityInFlight = new Map<string, Promise<Sidecar & { assetId: string }>>();

  constructor(private readonly directory: string) {}

  /** Resolve an id to its real file; if none exists yet, default to `.mp4`. */
  async filePath(id: string): Promise<string> {
    for (const ext of ALL_EXTS) {
      const candidate = join(this.directory, `${id}${ext}`);
      if (await exists(candidate)) return candidate;
    }
    return join(this.directory, `${id}${VIDEO_EXTS[0]}`);
  }

  private metaDirectory(): string {
    return join(this.directory, META_DIR);
  }

  sidecarPath(id: string): string {
    return join(this.metaDirectory(), `${id}.json`);
  }

  thumbnailPath(id: string): string {
    return join(this.metaDirectory(), `${id}.jpg`);
  }

  async list(): Promise<LocalRecording[]> {
    await mkdir(this.directory, { recursive: true });
    // Let a readdir failure propagate (unreadable folder, unreachable network
    // drive) instead of returning [] — an empty array is indistinguishable from
    // "vault is empty" and gets rendered as the first-run empty state, which
    // reads as data loss. The caller surfaces the real error.
    const entries = await readdir(this.directory);
    const ids = entries
      .filter((f) => ALL_EXTS.some((ext) => f.endsWith(ext)))
      .map((f) => basename(f, ALL_EXTS.find((ext) => f.endsWith(ext))!));
    const described = await Promise.all(ids.map((id) => this.describe(id)));
    return described
      .filter((r): r is LocalRecording => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async describe(id: string): Promise<LocalRecording | null> {
    const filePath = await this.filePath(id);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return null;
    }
    const isImage = IMAGE_EXTS.some((ext) => filePath.endsWith(ext));
    const meta = await this.ensureIdentity(id);
    const hashIsFresh =
      meta.contentSha256 !== undefined &&
      meta.hashedSizeBytes === info.size &&
      meta.hashedMtimeMs === info.mtimeMs;
    return {
      id,
      assetId: meta.assetId,
      kind: isImage ? "screenshot" : "recording",
      title: meta.title ?? humanizeId(id),
      filePath,
      createdAt: meta.createdAt ?? info.birthtimeMs,
      sizeBytes: info.size,
      durationSeconds: meta.durationSeconds ?? 0,
      derivedFromAssetId: meta.derivedFromAssetId ?? null,
      contentSha256: hashIsFresh ? (meta.contentSha256 ?? null) : null,
      thumbnailUrl: isImage
        ? // `?v=<mtime>` busts the renderer image cache when a screenshot is
          // overwritten in place (same id/URL) — only the changed item, so the
          // rest stay cacheable.
          `kaipu-media://screenshot/${id}?v=${Math.round(info.mtimeMs)}`
        : (await exists(this.thumbnailPath(id)))
          ? `kaipu-media://thumb/${id}`
          : null,
    };
  }

  async sidecar(id: string): Promise<Sidecar> {
    try {
      return JSON.parse(await readFile(this.sidecarPath(id), "utf-8")) as Sidecar;
    } catch {
      return {};
    }
  }

  /**
   * Read the sidecar and make sure it carries an assetId. A legacy (v1) item gets
   * one minted here, on first read, and persisted best-effort: if the vault is
   * read-only the id lives for this process only — the alternative (failing to
   * list) reads as data loss. Also clears `localRemovedAt`, since the file is back.
   */
  private async ensureIdentity(id: string): Promise<Sidecar & { assetId: string }> {
    const inFlight = this.identityInFlight.get(id);
    if (inFlight) return inFlight;

    const promise = (async (): Promise<Sidecar & { assetId: string }> => {
      const current = await this.sidecar(id);
      if (current.assetId && current.localRemovedAt === undefined) {
        return current as Sidecar & { assetId: string };
      }
      const next: Sidecar = {
        ...current,
        sidecarVersion: 2,
        assetId: current.assetId ?? randomUUID(),
      };
      delete next.localRemovedAt;
      try {
        await this.writeMeta(id, next);
      } catch {
        // Read-only vault: keep the in-memory identity; nothing else could persist either.
      }
      return next as Sidecar & { assetId: string };
    })();

    this.identityInFlight.set(id, promise);
    try {
      return await promise;
    } finally {
      this.identityInFlight.delete(id);
    }
  }

  /** Merge fields into the sidecar (used by rename and by finalize). */
  async writeMeta(id: string, meta: Sidecar): Promise<void> {
    const current = await this.sidecar(id);
    await mkdir(this.metaDirectory(), { recursive: true });
    await writeFile(
      this.sidecarPath(id),
      JSON.stringify({ ...current, ...meta, sidecarVersion: 2 }, null, 2),
    );
  }

  /**
   * The file's sha256, from the sidecar cache when it still matches the file's
   * size + mtime, otherwise recomputed and cached. Never called by `list()`.
   * Retries up to 3 times if the file changes during hashing; throws if it
   * keeps changing after the third attempt.
   */
  async ensureContentHash(
    id: string,
  ): Promise<{ contentSha256: string; sizeBytes: number } | null> {
    const filePath = await this.filePath(id);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return null;
    }
    const meta = await this.sidecar(id);
    if (
      meta.contentSha256 &&
      meta.hashedSizeBytes === info.size &&
      meta.hashedMtimeMs === info.mtimeMs
    ) {
      return { contentSha256: meta.contentSha256, sizeBytes: info.size };
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      const contentSha256 = await sha256FileBase64(filePath);
      // Re-stat after hashing: if the file changed underneath, don't cache a lie.
      const after = await stat(filePath);
      if (after.size === info.size && after.mtimeMs === info.mtimeMs) {
        await this.writeMeta(id, {
          contentSha256,
          hashedSizeBytes: info.size,
          hashedMtimeMs: info.mtimeMs,
        });
        return { contentSha256, sizeBytes: info.size };
      }
      if (attempt < 3) {
        info = after;
      }
    }

    throw new Error(`File "${id}" changed while hashing`);
  }

  async writeThumbnail(id: string, jpg: Buffer): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    await writeFile(this.thumbnailPath(id), jpg);
  }

  /**
   * Backfills a recording whose metadata was never derived from the file — a
   * hand-imported clip, or one whose `finalize` was interrupted before the
   * sidecar was written. The renderer decodes duration + poster from the file
   * (main has no video decoder) and hands them here to persist. Only
   * `durationSeconds` is written; title and createdAt keep their stable
   * describe() fallbacks (humanized id / file birthtime), so a later rename is
   * never clobbered. Returns the re-described recording, or null if the file
   * vanished meanwhile.
   */
  async backfill(
    id: string,
    meta: { durationSeconds: number; thumbnail: ArrayBuffer | null },
  ): Promise<LocalRecording | null> {
    await this.writeMeta(id, { durationSeconds: meta.durationSeconds });
    if (meta.thumbnail) await this.writeThumbnail(id, Buffer.from(meta.thumbnail));
    return this.describe(id);
  }

  /** Writes a screenshot PNG as `<id>.png` in the vault root. */
  async writeImage(id: string, png: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `${id}.png`), png);
  }

  /** Updates the user-facing title without touching the video file. */
  async rename(id: string, title: string): Promise<void> {
    await this.writeMeta(id, { title });
  }

  /**
   * Removes the video plus its sidecar and thumbnail. The sidecar/thumbnail are
   * best-effort (they may not exist), but a failure to delete the actual
   * recording propagates so the UI can report it — `Promise.allSettled` over all
   * three previously swallowed even a permission/locked-file error on the video.
   */
  async remove(id: string): Promise<void> {
    await Promise.allSettled([
      rm(this.sidecarPath(id), { force: true }),
      rm(this.thumbnailPath(id), { force: true }),
    ]);
    await rm(await this.filePath(id), { force: true });
  }
}

function humanizeId(id: string): string {
  const cleaned = id.replace(/[-_]+/g, " ").trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : "Recording";
}
