import { basename, join } from "node:path";
import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { LocalRecording, MetadataIssue } from "@shared/types/library-storage";
import { sanitizeRecordingCapture, type RecordingCapture } from "@shared/recording-capture";
import { normalizeExportPresetId, type StoredExportPresetId } from "@shared/types/export-preset";
import { atomicWriteFile, withLock } from "./atomic-write";
import { sha256FileBase64 } from "./content-hash";

const META_DIR = ".kaipu";
/** Known video containers, in preference order — `.mp4` is what we now write. */
const VIDEO_EXTS = [".mp4", ".webm"] as const;
const IMAGE_EXTS = [".png"] as const;
/** Animated GIF exports (NIW2-217). Local-only; thumbnail in `.kaipu/<id>.jpg` like videos. */
const GIF_EXTS = [".gif"] as const;
const ALL_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS, ...GIF_EXTS] as const;

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
  /** Phase 1 plain-string tags (never released); imported once into the registry. */
  tags?: string[];
  /** Ids of the tags in `.kaipu/tags.json` this item carries (ADR 0020). */
  tagIds?: string[];
  /** Cached names of `tagIds`, for people and other tools; the ids are the truth. */
  tagNames?: string[];
  /** Epoch ms of the last tag write on this item. */
  tagsUpdatedAt?: number;
  /** Editor exports (NIW2-218): the destination preset; absent on older items. */
  exportPreset?: StoredExportPresetId;
  /** What the export encoded ("whole" or "edit:<hash>"); see RecordingFinalizeMeta. */
  exportFingerprint?: string;
  /** GIF exports only (NIW2-217). */
  gifWidth?: number;
  gifHeight?: number;
  gifFps?: number;
  /** Epoch ms the item was last opened in an editor (the Editor home's "Opened"). */
  editorOpenedAt?: number;
  /** Screenshots: epoch ms of the last manual Save from the image editor ("Saved"). */
  editorSavedAt?: number;
  /** New recordings: how the take was captured (library labels). Absent on older items. */
  capture?: RecordingCapture;
}

// Keyed by the sidecar's absolute path (not per-instance), so a re-minted id on a
// read-only vault survives across separate `LibraryVault` instances for the same
// directory (e.g. a fresh instance per IPC call) instead of re-minting on every read.
const readOnlyIdentityMemo = new Map<string, string>();

// Sidecars already copied aside this session (`quarantine`), by absolute path, so a list
// that re-reads a corrupt sidecar every few seconds keeps one copy, not hundreds. A clean
// read clears the path, so a sidecar that is repaired and later corrupted again gets a new copy.
const quarantinedSidecars = new Set<string>();

/**
 * The sidecar exists but cannot be trusted: `unreadable` (a read error other than a missing
 * file: EIO, EACCES, a cloud-synced file that is not downloaded) or `corrupt` (it read, but
 * is not a JSON object: truncated by a crash, hand-edited). Nothing may be written for the
 * item while this holds, or the next write would replace the unknown contents (title, tags,
 * edit links, cloud association) with a freshly minted identity.
 */
export class SidecarUnavailableError extends Error {
  constructor(
    readonly issue: MetadataIssue,
    readonly path: string,
    options?: { cause?: unknown },
  ) {
    super(`sidecar ${issue}: ${path}`, options);
    this.name = "SidecarUnavailableError";
  }
}

/** File access the vault reads sidecars through; injected so tests can fail a read on demand. */
export interface VaultReader {
  readText(path: string): Promise<string>;
}

const fsReader: VaultReader = { readText: (path) => readFile(path, "utf-8") };

/** Prefix of the stand-in `assetId` of an item whose sidecar cannot be read; never persisted. */
export const UNREADABLE_ASSET_PREFIX = "unreadable:";

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
  /**
   * `workspaceId` goes into the `kaipu-media://` URLs `describe()` hands out, so a URL cached
   * before a switch never shows another workspace's item with the same id (ADR 0032).
   * `reader` is how sidecars are read (a test fails a read on demand).
   */
  constructor(
    readonly directory: string,
    readonly workspaceId: string | null = null,
    private readonly reader: VaultReader = fsReader,
  ) {}

  private mediaQuery(params: Record<string, string>): string {
    const all = this.workspaceId ? { ...params, w: this.workspaceId } : params;
    const query = new URLSearchParams(all).toString();
    return query ? `?${query}` : "";
  }

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

  /** Cursor event track written at record time (video-editor v2 auto-zoom). */
  cursorTrackPath(id: string): string {
    return join(this.metaDirectory(), `${id}.cursor.json`);
  }

  async list(): Promise<LocalRecording[]> {
    // The root is never created here: a missing folder is a workspace that is not
    // connected (an unplugged drive), and recreating it would list it as empty.
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

  /** How many media files the root holds, without describing them (the switcher's counts). */
  async countMedia(): Promise<number> {
    const entries = await readdir(this.directory);
    return entries.filter((f) => ALL_EXTS.some((ext) => f.endsWith(ext))).length;
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
    const isGif = GIF_EXTS.some((ext) => filePath.endsWith(ext));
    let meta: Sidecar & { assetId: string };
    try {
      meta = await this.ensureIdentity(id);
    } catch (error) {
      // Still listed, so the user sees the file exists; read-only until the sidecar reads again.
      if (error instanceof SidecarUnavailableError) {
        return this.describeUnreadable(id, filePath, info, error.issue);
      }
      throw error;
    }
    const hashIsFresh =
      meta.contentSha256 !== undefined &&
      meta.hashedSizeBytes === info.size &&
      meta.hashedMtimeMs === info.mtimeMs;
    return {
      id,
      assetId: meta.assetId,
      kind: isImage ? "screenshot" : isGif ? "gif" : "recording",
      title: meta.title ?? humanizeId(id),
      filePath,
      createdAt: meta.createdAt ?? info.birthtimeMs,
      sizeBytes: info.size,
      durationSeconds: meta.durationSeconds ?? 0,
      derivedFromAssetId: meta.derivedFromAssetId ?? null,
      contentSha256: hashIsFresh ? (meta.contentSha256 ?? null) : null,
      tagIds: Array.isArray(meta.tagIds)
        ? meta.tagIds.filter((t): t is string => typeof t === "string")
        : [],
      gif:
        isGif && meta.gifWidth && meta.gifHeight
          ? { width: meta.gifWidth, height: meta.gifHeight, fps: meta.gifFps ?? 0 }
          : null,
      export: describeExport(meta),
      editorOpenedAt: typeof meta.editorOpenedAt === "number" ? meta.editorOpenedAt : null,
      editorSavedAt: typeof meta.editorSavedAt === "number" ? meta.editorSavedAt : null,
      capture: isImage || isGif ? null : sanitizeRecordingCapture(meta.capture),
      thumbnailUrl: isImage
        ? // `?v=<mtime>` busts the renderer image cache when a screenshot is
          // overwritten in place (same id/URL) — only the changed item, so the
          // rest stay cacheable.
          `kaipu-media://screenshot/${id}${this.mediaQuery({ v: String(Math.round(info.mtimeMs)) })}`
        : (await exists(this.thumbnailPath(id)))
          ? `kaipu-media://thumb/${id}${this.mediaQuery({})}`
          : null,
    };
  }

  /**
   * What the file alone can tell: the item, with the sidecar's fields unknown. It carries a
   * stand-in assetId (derived from the file id, never written anywhere) so the Library can
   * still key and list it; `metadataIssue` is what tells every consumer not to trust or
   * write it.
   */
  private describeUnreadable(
    id: string,
    filePath: string,
    info: { size: number; birthtimeMs: number },
    issue: MetadataIssue,
  ): LocalRecording {
    const isImage = IMAGE_EXTS.some((ext) => filePath.endsWith(ext));
    const isGif = GIF_EXTS.some((ext) => filePath.endsWith(ext));
    return {
      id,
      assetId: `${UNREADABLE_ASSET_PREFIX}${id}`,
      kind: isImage ? "screenshot" : isGif ? "gif" : "recording",
      title: humanizeId(id),
      filePath,
      createdAt: info.birthtimeMs,
      sizeBytes: info.size,
      durationSeconds: 0,
      derivedFromAssetId: null,
      contentSha256: null,
      tagIds: [],
      gif: null,
      export: null,
      editorOpenedAt: null,
      editorSavedAt: null,
      capture: null,
      thumbnailUrl: null,
      metadataIssue: issue,
    };
  }

  /**
   * The item's sidecar. Only a missing file (`ENOENT`) means "no sidecar yet" and reads as
   * `{}`; any other failure throws {@link SidecarUnavailableError}, because `{}` here is
   * indistinguishable from a legacy item and the caller would mint a new identity over it.
   */
  async sidecar(id: string): Promise<Sidecar> {
    const path = this.sidecarPath(id);
    let raw: string;
    try {
      raw = await this.reader.readText(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new SidecarUnavailableError("unreadable", path, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      await this.quarantine(path);
      throw new SidecarUnavailableError("corrupt", path);
    }
    quarantinedSidecars.delete(path);
    return parsed as Sidecar;
  }

  /** Keep a copy of a corrupt sidecar, once per path per session. Never touches the original. */
  private async quarantine(path: string): Promise<void> {
    if (quarantinedSidecars.has(path)) return;
    quarantinedSidecars.add(path);
    await copyFile(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
  }

  /**
   * Read the sidecar and make sure it carries an assetId. A legacy (v1) item (no
   * sidecar, or one without an id) gets one minted here, on first read, and persisted
   * best-effort. A sidecar that cannot be read or parsed throws
   * {@link SidecarUnavailableError} instead: it is not a legacy item, and minting would
   * overwrite what is in it. Persisting is best-effort: if the vault is
   * read-only, the id is instead remembered in `readOnlyIdentityMemo` (keyed by the
   * sidecar's absolute path) so a later read for the same path reuses it instead of
   * minting a new one every time — the alternative (failing to list) reads as data
   * loss. Also clears `localRemovedAt`, since the file is back.
   */
  private async ensureIdentity(id: string): Promise<Sidecar & { assetId: string }> {
    // Fast path, no lock: the common case once an item has an identity.
    const quick = await this.sidecar(id);
    if (quick.assetId && quick.localRemovedAt === undefined) {
      return quick as Sidecar & { assetId: string };
    }
    const sidecarPath = this.sidecarPath(id);
    // Module-level lock keyed by path: a second caller (even from another
    // LibraryVault instance) waits, then re-reads and finds the first one's id.
    return withLock(sidecarPath, async () => {
      const current = await this.sidecar(id);
      if (current.assetId && current.localRemovedAt === undefined) {
        return current as Sidecar & { assetId: string };
      }
      const next: Sidecar = {
        ...current,
        sidecarVersion: 2,
        assetId: current.assetId ?? readOnlyIdentityMemo.get(sidecarPath) ?? randomUUID(),
      };
      delete next.localRemovedAt;
      try {
        await this.writeMetaLocked(id, next);
        readOnlyIdentityMemo.delete(sidecarPath);
      } catch {
        // Read-only vault: keep the in-memory identity; nothing else could persist either.
        readOnlyIdentityMemo.set(sidecarPath, next.assetId!);
      }
      return next as Sidecar & { assetId: string };
    });
  }

  /**
   * Merge fields into the sidecar (used by rename, finalize and tags). Serialized per
   * sidecar and atomic (unique temp + fsync + rename): concurrent writers never lose a
   * field, and a crash mid-write never leaves a truncated sidecar. Throws
   * {@link SidecarUnavailableError} without writing when the existing sidecar cannot be
   * read or parsed: merging into `{}` would erase it.
   */
  async writeMeta(id: string, meta: Sidecar): Promise<void> {
    await withLock(this.sidecarPath(id), () => this.writeMetaLocked(id, meta));
  }

  /** Read-merge-write; the caller must hold the sidecar lock. */
  private async writeMetaLocked(id: string, meta: Sidecar): Promise<void> {
    const current = await this.sidecar(id);
    await mkdir(this.metaDirectory(), { recursive: true });
    await atomicWriteFile(
      this.sidecarPath(id),
      JSON.stringify({ ...current, ...meta, sidecarVersion: 2 }, null, 2),
    );
  }

  /** Whether `id` names a media file in the vault right now (not deleted, not unknown). */
  async hasMedia(id: string): Promise<boolean> {
    if (!isPlainItemId(id)) return false;
    for (const ext of ALL_EXTS) {
      if (await exists(join(this.directory, `${id}${ext}`))) return true;
    }
    return false;
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
    await atomicWriteFile(this.thumbnailPath(id), jpg);
  }

  /** Atomic (unique temp + rename): a crash mid-write never leaves a truncated track. */
  async writeCursorTrack(id: string, json: string): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    await atomicWriteFile(this.cursorTrackPath(id), json);
  }

  /** The raw track JSON, or null when this recording has none. */
  async readCursorTrack(id: string): Promise<string | null> {
    try {
      return await readFile(this.cursorTrackPath(id), "utf-8");
    } catch {
      return null;
    }
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

  /**
   * Writes a GIF export as `<id>.gif`, atomically: `<id>.gif.part` → fsync → rename. A
   * failure removes the `.part`, so no partial file is ever listed (`.part` is not a known
   * extension) or left behind.
   */
  async writeGif(id: string, bytes: Uint8Array): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${id}${GIF_EXTS[0]}`);
    const part = `${target}.part`;
    try {
      const handle = await open(part, "w");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(part, target);
    } catch (error) {
      await rm(part, { force: true }).catch(() => {});
      throw error;
    }
    return target;
  }

  /** Writes a screenshot PNG as `<id>.png` in the vault root. */
  async writeImage(id: string, png: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    // `.part` is not a known extension, so `list()` never shows a half-written shot,
    // and a failed write leaves the previous PNG untouched.
    await atomicWriteFile(join(this.directory, `${id}.png`), png, "part");
  }

  /** Updates the user-facing title without touching the video file. */
  async rename(id: string, title: string): Promise<void> {
    await this.writeMeta(id, { title });
  }

  /** Stamp "opened in an editor now" — what the Editor home's Continue list orders by. */
  async markOpenedInEditor(id: string, at = Date.now()): Promise<void> {
    await this.writeMeta(id, { editorOpenedAt: at });
  }

  /**
   * Removes the video plus its sidecar and thumbnail. The sidecar/thumbnail are
   * best-effort (they may not exist), but a failure to delete the actual
   * recording propagates so the UI can report it — `Promise.allSettled` over all
   * three previously swallowed even a permission/locked-file error on the video.
   */
  async remove(id: string): Promise<void> {
    // Under the sidecar lock so a racing writeMeta cannot recreate the sidecar just after it is deleted.
    await withLock(this.sidecarPath(id), () =>
      Promise.allSettled([
        rm(this.sidecarPath(id), { force: true }),
        rm(this.thumbnailPath(id), { force: true }),
        rm(this.cursorTrackPath(id), { force: true }),
        // An interrupted writeCursorTrack can leave the temp file behind.
        rm(`${this.cursorTrackPath(id)}.tmp`, { force: true }),
      ]),
    );
    await rm(await this.filePath(id), { force: true });
  }

  /**
   * Free disk space while keeping the item: deletes ONLY the media file. The
   * sidecar (identity, provenance, hash), thumbnail, edit session and assets stay,
   * so the item survives as a cloud-only entry and can be downloaded back under
   * the same assetId. Not `remove()`: that one is the destructive delete.
   */
  async removeLocalCopy(id: string): Promise<void> {
    // Before deleting anything: the marker below cannot be written over an unreadable
    // sidecar, and the media must not go without it.
    await this.sidecar(id);
    const target = await this.filePath(id);
    if (!(await exists(target))) throw new Error(`No local media file for "${id}"`);
    await rm(target);
    await this.writeMeta(id, { localRemovedAt: Date.now() });
  }
}

/** An MP4 export's preset + fingerprint (NIW2-218), or null for anything that isn't one. */
function describeExport(meta: Sidecar): LocalRecording["export"] {
  const preset = normalizeExportPresetId(meta.exportPreset);
  if (!preset) return null;
  return {
    preset,
    fingerprint: typeof meta.exportFingerprint === "string" ? meta.exportFingerprint : null,
  };
}

function humanizeId(id: string): string {
  const cleaned = id.replace(/[-_]+/g, " ").trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : "Recording";
}

/**
 * An item id is a bare file stem: no path separators, no leading dot. Anything
 * else could address a file outside the vault when joined into a path.
 */
export function isPlainItemId(id: string): boolean {
  return id.length > 0 && !id.startsWith(".") && !/[\\/]/.test(id) && basename(id) === id;
}
