import { basename, extname, join, relative } from "node:path";
import { constants, type Stats } from "node:fs";
import {
  access,
  copyFile,
  cp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  AMBIGUOUS_IDENTITY_MARKER,
  ITEM_NOT_FOUND_MARKER,
  UNREADABLE_RECORD_MARKER,
  type LocalRecording,
  type MetadataIssue,
  type RenameResult,
} from "@shared/types/library-storage";
import { sanitizeRecordingCapture, type RecordingCapture } from "@shared/recording-capture";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import {
  isExportDestinationId,
  normalizeExportPresetId,
  type StoredExportPresetId,
} from "@shared/types/export-preset";
import { defaultCaptureName, type CaptureKind } from "@shared/default-capture-name";
import { atomicWriteFile, uniqueTempPath, volumeStagingDir, withLock } from "./atomic-write";
import {
  type PlacedFile,
  placeByRename,
  placeNew,
  placeNoReplace,
  removeIfSame,
  renameCaseOnly,
  renameCaseOnlyByRename,
  takenError,
} from "./safe-place";
import { sha256FileBase64 } from "./content-hash";
import { legacyStampMatches, sameStat, stampFields, stampMatches } from "./hash-stamp";
import { EvictedFileError, type EvictionProbe } from "./dataless";
import { webcamTrackState } from "./webcam-track-state";
import { mapLimit } from "./map-limit";
import { fileStemFromTitle, fsFold, isReservedStem, isVaultOwnedStem } from "./file-stem";
import { mediaUrl } from "@shared/media-url";

export const META_DIR = ".kaipu";
/**
 * Known video containers, in preference order — `.mp4` is what we now write. `.mov` and
 * `.m4v` arrive only through an import (NIW2-579), which keeps the source's container.
 */
const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".m4v"] as const;
const IMAGE_EXTS = [".png"] as const;
/** Animated GIF exports (NIW2-217). Local-only; thumbnail in `.kaipu/<id>.jpg` like videos. */
const GIF_EXTS = [".gif"] as const;
const ALL_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS, ...GIF_EXTS] as const;
/** Every media extension the vault lists, lowercase and exact (`Demo.MP4` is not one, F4). */
export const MEDIA_EXTS: readonly string[] = ALL_EXTS;

/** Version 2 adds identity + provenance + hash cache. Every field stays optional so a v1 file reads fine. */
export interface Sidecar {
  sidecarVersion?: 1 | 2;
  title?: string;
  durationSeconds?: number;
  createdAt?: number;
  assetId?: string;
  derivedFromAssetId?: string | null;
  /** A frame capture: the video it was taken from and the second on screen. Not an export. */
  sourceVideoAssetId?: string | null;
  sourceTimeSeconds?: number | null;
  /**
   * The `SceneSource.id` of the joined copy the frame came from (null = the opened recording).
   * Absent in a sidecar written before joined recordings (ADR 0058).
   */
  sourceSceneSourceId?: string | null;
  /**
   * base64 sha256 + the stamp of the file it was computed for (size, mtime, ctime, inode, see
   * `hash-stamp.ts`); stale when any differs. A sidecar from before ctime and inode were
   * recorded lacks the last two and re-hashes once.
   */
  contentSha256?: string;
  hashedSizeBytes?: number;
  hashedMtimeMs?: number;
  hashedCtimeMs?: number;
  hashedIno?: number;
  /**
   * The content hash this item was last re-transcribed automatically for (NIW2-891). One
   * automatic attempt per media content: a failed or cancelled run does not restart on every open.
   */
  autoRetranscribedSha256?: string;
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
  /** Copies for a destination: where it is going. Read back only when it is a known id. */
  exportDestination?: string;
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
  /** New recordings with the webcam on: the webcam file's offset and size (ADR 0037). */
  webcam?: WebcamTrackMeta;
  /**
   * The revision of the webcam composite the thumbnail carries (NIW2-845): set with the
   * composite JPEG, cleared when a plain screen frame replaces it. Absent = the bare screen
   * frame. A future change to the composite bumps {@link WEBCAM_THUMBNAIL_REVISION}.
   */
  thumbnailWebcam?: number;
}

/**
 * What a thumbnail with the webcam bubble composited in is stamped with (`Sidecar.thumbnailWebcam`).
 * Bumping it re-composites every webcam recording, and the composer draws on the JPEG on disk:
 * after a bump that JPEG already carries the old bubble, so a bump must also make the composer
 * start from the recording's own screen frame.
 */
export const WEBCAM_THUMBNAIL_REVISION = 1;

/**
 * Module-level `withLock` key that serializes every operation choosing or changing an
 * item's stem (ADR 0035): `allocateId` and `renameItem`, across every `LibraryVault`
 * instance. Always taken before a sidecar lock, never inside one, so there is no
 * lock-order cycle.
 */
export const NAMES_LOCK = "vault:names";

/** Error codes a locked file raises on rename (Windows sharing violations, mostly). */
const LOCKED_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ETXTBSY"]);

/** How a rename retries a media file another app holds: one try, then one per delay. */
export interface RetryPolicy {
  delaysMs: number[];
  sleep?: (ms: number) => Promise<void>;
}
/** ≈1.5 s worst case: the user pressed Enter and is waiting. */
export const DEFAULT_RENAME_RETRY: RetryPolicy = { delaysMs: [150, 400, 900] };

/** The id names no media file (deleted, or already renamed). Its message carries the IPC marker. */
export class ItemNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`${ITEM_NOT_FOUND_MARKER}: no media file for "${id}"`);
    this.name = "ItemNotFoundError";
  }
}

/**
 * Two or more local items carry the identity a caller named by a stale id (a copied item
 * with its sidecar, or media restored under a leftover's stem). Picking one would move or
 * overwrite the wrong file, so the operation refuses before changing anything.
 */
export class AmbiguousIdentityError extends Error {
  constructor(
    readonly assetId: string,
    readonly ids: string[],
  ) {
    super(`${AMBIGUOUS_IDENTITY_MARKER}: ${ids.length} local items claim "${assetId}"`);
    this.name = "AmbiguousIdentityError";
  }
}

/** The file kept changing while it was hashed, so no hash describes it (NIW2-891: verdict unknown). */
export class FileChangedWhileHashingError extends Error {
  constructor(readonly id: string) {
    super(`File "${id}" changed while hashing`);
    this.name = "FileChangedWhileHashingError";
  }
}

/** `removeLocalCopy` on a synced workspace's vault: it frees nothing there and never deletes. */
export class SyncedLocalCopyError extends Error {
  constructor(readonly id: string) {
    super(`"${id}" is in a synced folder: its local copy is not deleted from here`);
    this.name = "SyncedLocalCopyError";
  }
}

/** A sidecar write for an id with neither a sidecar nor a media file (it was renamed or removed). */
export class ItemGoneError extends Error {
  constructor(readonly id: string) {
    super(`Library item "${id}" is gone (renamed or removed)`);
    this.name = "ItemGoneError";
  }
}

/** How a strict sidecar read ended (F9). Only `ok` and `missing` may be written over. */
export type SidecarReadStatus = "ok" | "missing" | "unreadable" | "corrupt-json" | "invalid-schema";

export type SidecarRead =
  | { status: "ok"; sidecar: Sidecar }
  | { status: "missing" }
  | { status: "unreadable" | "corrupt-json" | "invalid-schema"; error: string };

const isOptional = (value: unknown, type: "string" | "number"): boolean =>
  value === undefined || typeof value === type;

/** The fields every reader relies on, checked so a wrong type is never merged over. */
function isSidecarShape(value: unknown): value is Sidecar {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    isOptional(v.title, "string") &&
    isOptional(v.createdAt, "number") &&
    isOptional(v.localRemovedAt, "number") &&
    (v.assetId === undefined || (typeof v.assetId === "string" && v.assetId.length > 0)) &&
    (v.tagIds === undefined || Array.isArray(v.tagIds))
  );
}

/**
 * Read a sidecar without turning a failure into `{}` (which `sidecar()` does for readers):
 * ENOENT is `missing`; any other read error is `unreadable`; then `corrupt-json` and
 * `invalid-schema`. Never writes.
 */
export async function readSidecarStrict(
  path: string,
  readText: (path: string) => Promise<string> = (at) => readFile(at, "utf-8"),
): Promise<SidecarRead> {
  let raw: string;
  try {
    raw = await readText(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" };
    return { status: "unreadable", error: String(error) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "corrupt-json", error: String(error) };
  }
  if (!isSidecarShape(parsed)) return { status: "invalid-schema", error: "unexpected shape" };
  return { status: "ok", sidecar: parsed };
}

/** A stem `reserve` took: its id, and the identity its stub record carries. */
export interface Reservation {
  id: string;
  assetId: string;
}

/** A media file a new item placed: where, and which file (for `discardCreated`). */
export interface NewMedia {
  path: string;
  file: PlacedFile;
}

export interface AllocateInput {
  kind: CaptureKind;
  /** The title the item will carry; the stem is derived from it. */
  title: string;
  createdAt: number;
  /** Explicit stem (stranded recovery: "<default> (recovered)"); still sanitized and collision-resolved. */
  stem?: string;
}

/**
 * What a rename acts on: the id the caller last saw **and** the identity it expects there.
 * A bare id is never enough — a toast's Retry can outlive a move, and another item may
 * have taken that name since.
 */
export interface RenameTarget {
  id: string;
  assetId: string;
}

export interface RenameOptions {
  /** True while an export may be streaming the file: the file then keeps its name ("busy"). */
  isBusy?: () => boolean;
  /**
   * True while the item is open in the video editor, which holds its id for its lifetime
   * (ADR 0035): the file then keeps its name ("editing").
   */
  isEditing?: (id: string, assetId: string) => boolean;
  retry?: RetryPolicy;
  /**
   * Reconcile passes false (NIW2-561): a stem with this identity's sidecar and no media may
   * be a cloud-only record with its own edits, so only vacant stems are taken.
   */
  allowLeftover?: boolean;
  /**
   * Reconcile passes true: refuse (`SharedCompanionError`) a source whose companion paths
   * another live item owns (a legacy `Demo` beside `Demo.edit`, M7), before any write.
   */
  refuseSharedCompanions?: boolean;
}

/** The item's companion paths are also another live item's: moving it would split them. */
export class SharedCompanionError extends Error {
  constructor(
    readonly id: string,
    readonly other: string,
  ) {
    super(`"${id}" shares companion files with "${other}"; left as it is`);
    this.name = "SharedCompanionError";
  }
}

/** Every companion an id owns under `.kaipu/`. */
export interface CompanionPaths {
  sidecar: string;
  thumbnail: string;
  cursorTrack: string;
  /** Left by an interrupted cursor-track write; deleted, never moved. */
  cursorTrackTemp: string;
  editSession: string;
  editMeta: string;
  /** A screenshot's editable canvas document (ADR 0053); its images live in `assetsDir`. */
  canvasDoc: string;
  assetsDir: string;
  /** A screenshot's recognized-text cache (ADR 0055): moved and removed with the item. */
  textCache: string;
  /** The take's webcam file (ADR 0037): moved and removed with the item like the others. */
  webcam: string;
  /**
   * The recording's local transcript (derived data, like a thumbnail): moved and removed with
   * the item, kept when only the local copy is removed.
   */
  transcript: string;
}

/** How a rename reaches its target stem. */
type StemResolution =
  | { id: string; mode: "same" }
  /** No file of any item uses the stem. */
  | { id: string; mode: "free" }
  /** The same item under a different case or normalization: a real move, done in place. */
  | { id: string; mode: "case" }
  /** Companions an earlier interrupted rename of this item left behind; overwritten. */
  | { id: string; mode: "leftover" };

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Names a case-insensitive filesystem may treat as one (see `fsFold`). */
const foldName = fsFold;

export function kindFromExt(ext: string): CaptureKind {
  if ((IMAGE_EXTS as readonly string[]).includes(ext)) return "screenshot";
  if ((GIF_EXTS as readonly string[]).includes(ext)) return "gif";
  return "recording";
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
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

/**
 * A write to an item whose sidecar is unreadable, corrupt or invalid. Merging over it would
 * replace the item's title, identity and tags with whatever the caller had, so every
 * mutation refuses before touching the record, the media or any companion. It is a
 * {@link SidecarUnavailableError} (the listing shows the item read-only either way), and its
 * message carries `UNREADABLE_RECORD_MARKER` for the renderer.
 */
export class UnreadableRecordError extends SidecarUnavailableError {
  constructor(
    readonly id: string,
    /** `vault-owned`: the record path is a file the vault owns (`tags` → the tag registry). */
    readonly status: SidecarReadStatus | "vault-owned",
    path: string,
    options?: { cause?: unknown },
  ) {
    super(status === "unreadable" ? "unreadable" : "corrupt", path, options);
    this.message = `${UNREADABLE_RECORD_MARKER}: the record of "${id}" is ${status} (${this.message}); nothing was written`;
    this.name = "UnreadableRecordError";
  }
}

/** File access the vault reads sidecars through; injected so tests can fail a read on demand. */
export interface VaultReader {
  readText(path: string): Promise<string>;
}

const fsReader: VaultReader = { readText: (path) => readFile(path, "utf-8") };

/**
 * The longest a synced vault waits for one sidecar. A provider can offload that small file too,
 * and reading it downloads it: a stalled or offline provider would hang a Library listing, so
 * the read gives up and the item is listed read-only (spec AC13, ADR 0069 decision 5).
 */
export const SYNCED_SIDECAR_READ_TIMEOUT_MS = 5_000;

/** How many items a synced vault describes (reads a sidecar of) at once in `list()`. */
export const SYNCED_LIST_CONCURRENCY = 8;

/**
 * Sidecar reads that may time out in one synced listing before the rest of the items are listed
 * without a read (read-only, "unreadable"). With the concurrency cap, a provider that has
 * stopped answering would otherwise cost the whole folder `5 s x items / concurrency`.
 *
 * The limit counts timeouts, and reads already in flight cannot be recalled: the
 * `SYNCED_LIST_CONCURRENCY` reads that start together wait their 5 s together, so a provider that
 * stopped answering costs one 5 s wave (up to `SYNCED_LIST_CONCURRENCY - 1` more timeouts than the
 * limit). When the stall begins only after the first wave, the listing takes two waves, 10 s.
 */
export const SYNCED_LIST_STALL_LIMIT = 4;

/**
 * The longest one synced listing or reconcile scan keeps starting sidecar reads. The stall limit
 * above only counts reads that time out; a provider that answers every read just under the 5 s
 * bound never trips it, and a thousand items would take `5 s x 1000 / concurrency`. Past this
 * budget no new read starts: the rest of the items are listed read-only ("unreadable"), and a
 * scan reports their records unreadable (fixable: false), the same placeholders a stall gives.
 * The budget is checked when an item starts, not between the several bounded reads one item may
 * chain (a sidecar with no identity reads it more than once), so a provider that answers slowly
 * can overrun it by a few 5 s bounds; one that stalls trips the limit above instead.
 */
export const SYNCED_READS_BUDGET_MS = 30_000;

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

/** The file's mtime in ms, or null when it is not there. */
async function mtimeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** The sidecar says the thumbnail carries today's webcam composite. */
function hasWebcamThumbnail(meta: Sidecar): boolean {
  return (
    typeof meta.thumbnailWebcam === "number" && meta.thumbnailWebcam >= WEBCAM_THUMBNAIL_REVISION
  );
}

/**
 * `exists` for checks whose "absent" answer leads to a write, a copy-then-delete or a
 * move onto the path: only ENOENT (or ENOTDIR) means absent; any other error (EIO, EACCES,
 * a dropped network drive) is thrown, never read as absence.
 */
async function existsStrict(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/**
 * Local recordings vault. An item lives as `<id><ext>` (ext ∈ ALL_EXTS) with
 * optional companions under `.kaipu/` (`<id>.json` sidecar, `<id>.jpg` thumbnail,
 * cursor track, edit session, assets). The filename *is* the id, and a rename moves
 * it (ADR 0035): the id is valid until the next rename, `assetId` is the identity.
 * Pure: no Electron — the directory is injected so it's testable against a temp folder.
 */
export class LibraryVault {
  /**
   * `workspaceId` goes into the `kaipu-media://` URLs `describe()` hands out, so a URL cached
   * before a switch never shows another workspace's item with the same id (ADR 0032).
   * `reader` is how sidecars are read (a test fails a read on demand).
   * `evictionProbe` is set for a synced workspace (spec, Synced folders): it says which files
   * the provider has offloaded, so `describe()` never hands out a URL that would download one.
   * `stagingDir` is set for a synced workspace too: where this vault stages a file it writes
   * (a GIF, a screenshot, a sidecar, a poster), so no temp file ever appears inside the folder the provider syncs.
   */
  constructor(
    readonly directory: string,
    readonly workspaceId: string | null = null,
    private readonly reader: VaultReader = fsReader,
    private readonly evictionProbe: EvictionProbe | null = null,
    private readonly stagingDir: string | null = null,
  ) {}

  /** Sidecar reads of this vault that gave up (see `readSidecarText`); only ever goes up. */
  private sidecarTimeouts = 0;

  /**
   * One sidecar read through the vault's reader. A synced vault bounds it: an offloaded sidecar
   * is downloaded by the read, and a stalled provider must not hang the Library. A read that
   * times out fails like any unreadable file (`ETIMEDOUT`).
   */
  private async readSidecarText(path: string): Promise<string> {
    if (!this.synced) return this.reader.readText(path);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.sidecarTimeouts += 1;
        reject(Object.assign(new Error(`reading "${path}" timed out`), { code: "ETIMEDOUT" }));
      }, SYNCED_SIDECAR_READ_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.reader.readText(path), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * `readSidecarStrict` through this vault's reader: a synced vault bounds the read like every
   * other sidecar read (a timeout is `unreadable`), so a reconcile scan cannot hang on one
   * offloaded record.
   */
  readRecordStrict(path: string, options: { deadline?: number } = {}): Promise<SidecarRead> {
    // Past a scan's budget no new read starts in a synced vault (`SYNCED_READS_BUDGET_MS`).
    if (this.synced && options.deadline !== undefined && Date.now() >= options.deadline) {
      return Promise.resolve({
        status: "unreadable",
        error: `reading "${path}" skipped: the provider was too slow`,
      });
    }
    return readSidecarStrict(path, (at) => this.readSidecarText(at));
  }

  /**
   * The workspace folder is synced by a provider (spec, Synced folders). A synced vault stages
   * outside the folder, places by `rename` (never a hard link) and never reads an evicted file.
   */
  get synced(): boolean {
    return this.evictionProbe !== null || this.stagingDir !== null;
  }

  /**
   * Every file this vault keeps beside or under its folder (sidecars, posters, cursor tracks,
   * tags, canvas documents, text caches): written through a temp file, then renamed over the
   * target. A synced vault keeps that temp file in its scratch folder, so the provider never
   * uploads and deletes it. A rename the volumes refuse (EXDEV) is redone through a hidden folder
   * that is provably outside the provider's root, or fails with EXDEV: it never falls back to a
   * file beside the target in a synced folder. A vault
   * built without a staging folder asks `atomicWriteFile`, which looks the folder up from the
   * path, so one built for a synced workspace by mistake still stages outside it.
   */
  writeAtomic(target: string, data: string | Uint8Array): Promise<void> {
    return atomicWriteFile(target, data, "tmp", this.stagingDir ?? undefined);
  }

  /** Where a synced vault stages what it writes (its scratch folder), or null for `.kaipu/tmp`. */
  get stagingDirectory(): string | null {
    return this.stagingDir;
  }

  /** Which of `paths` the provider has offloaded; always empty for a vault that is not synced. */
  async evictedAmong(paths: string[]): Promise<ReadonlySet<string>> {
    return this.evictionProbe ? this.evictionProbe(paths) : new Set();
  }

  /**
   * Throws `EvictedFileError` when any of `paths` is offloaded: the guard in front of every
   * whole-file read, because reading an evicted file downloads it. A vault that is not synced
   * never asks.
   */
  async assertLocal(paths: string[]): Promise<void> {
    const offloaded = await this.evictedAmong(paths);
    const first = paths.find((path) => offloaded.has(path));
    if (first !== undefined) throw new EvictedFileError(first);
  }

  /**
   * The bytes of a file in this vault, read whole (a clipboard copy, a saved screenshot's
   * bytes). An offloaded file throws `EvictedFileError` instead of being read: the read
   * would download it.
   */
  async readLocalFile(path: string): Promise<Buffer<ArrayBuffer>> {
    await this.assertLocal([path]);
    return readFile(path);
  }

  /**
   * The text of a small file in this vault (an edit-project meta, a sidecar-like record), read
   * the way a synced vault reads every sidecar: an offloaded file throws `EvictedFileError`
   * without being read, and a read that stalls gives up after `SYNCED_SIDECAR_READ_TIMEOUT_MS`
   * (`ETIMEDOUT`). A vault that is not synced just reads it.
   */
  async readTextBounded(path: string): Promise<string> {
    await this.assertLocal([path]);
    return this.readSidecarText(path);
  }

  /** The query a media URL this vault hands out carries: the caller's, plus the workspace. */
  private mediaParams(params: Record<string, string>): Record<string, string> {
    return this.workspaceId ? { ...params, w: this.workspaceId } : params;
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

  /** The take's webcam, recorded as its own file beside the screen (ADR 0037). */
  webcamFilePath(id: string): string {
    return join(this.metaDirectory(), `${id}.webcam.mp4`);
  }

  /** Every companion path `id` owns. `remove()` and `renameItem()` go through this, so they cannot drift. */
  companionPaths(id: string): CompanionPaths {
    const meta = this.metaDirectory();
    return {
      sidecar: this.sidecarPath(id),
      thumbnail: this.thumbnailPath(id),
      cursorTrack: this.cursorTrackPath(id),
      cursorTrackTemp: `${this.cursorTrackPath(id)}.tmp`,
      editSession: join(meta, `${id}.edit.json`),
      editMeta: join(meta, `${id}.edit.meta.json`),
      canvasDoc: join(meta, `${id}.canvas.json`),
      assetsDir: join(meta, `${id}.assets`),
      textCache: join(meta, `${id}.text.json`),
      webcam: this.webcamFilePath(id),
      transcript: join(meta, `${id}.transcript.json`),
    };
  }

  /** The media file `id` names right now, or null. */
  private async mediaPath(id: string): Promise<string | null> {
    if (!isPlainItemId(id)) return null;
    for (const ext of ALL_EXTS) {
      const candidate = join(this.directory, `${id}${ext}`);
      if (await exists(candidate)) return candidate;
    }
    return null;
  }

  /**
   * True when no media file and no companion exists for `stem`. Asked of the file
   * system, so on APFS/NTFS a differently-cased name counts as taken too. An orphan
   * sidecar (a cloud-only item after `removeLocalCopy`) takes its stem: renaming onto it
   * would merge two identities. A stem with a path that cannot be checked is not free.
   */
  async isStemFree(stem: string): Promise<boolean> {
    return (await this.stemState(stem)) === "free";
  }

  /**
   * `taken` as soon as any path of `stem` is proven to exist (a probe that failed elsewhere
   * changes nothing); `unknown` when none does but some probe failed (EIO, EACCES); `free`
   * only when every path is proven absent. Only a `free` stem is ever written onto.
   */
  private async stemState(stem: string): Promise<"free" | "taken" | "unknown"> {
    // A reserved stem's companions are another stem's (or the vault's own) files.
    if (isReservedStem(stem)) return "taken";
    const { cursorTrackTemp: _temp, ...companions } = this.companionPaths(stem);
    const paths = [
      ...ALL_EXTS.map((ext) => join(this.directory, `${stem}${ext}`)),
      ...Object.values(companions),
    ];
    const probes = await Promise.allSettled(paths.map(existsStrict));
    if (probes.some((probe) => probe.status === "fulfilled" && probe.value)) return "taken";
    return probes.some((probe) => probe.status === "rejected") ? "unknown" : "free";
  }

  /** `stem`, `stem (2)` … `stem (99)`, then random tails until one is accepted. */
  private async firstCandidate(
    stem: string,
    accept: (candidate: string) => Promise<StemResolution | null>,
  ): Promise<StemResolution> {
    for (let n = 1; n <= 99; n++) {
      const resolved = await accept(n === 1 ? stem : `${stem} (${n})`);
      if (resolved) return resolved;
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const resolved = await accept(`${stem} (${randomUUID().slice(0, 4)})`);
      if (resolved) return resolved;
    }
    throw new Error(`No free file name for "${stem}"`);
  }

  /** `reserve`, for a caller that never gives the stem back. */
  async allocateId(input: AllocateInput): Promise<string> {
    return (await this.reserve(input)).id;
  }

  /**
   * Reserve a stem for a new item: derive it from `title` (or sanitize `stem`), resolve
   * collisions with ` (2)`, ` (3)` …, and write a stub sidecar — all under NAMES_LOCK.
   * From this moment the stem is taken; the caller places the media next and, if that fails,
   * gives back only what it made: `releaseReservation`, or `discardCreated` once its media is
   * placed. Never `remove(id)`: a file that took the media's name meanwhile is not this item's.
   */
  async reserve(input: AllocateInput): Promise<Reservation> {
    const fallback = defaultCaptureName(input.kind, new Date(input.createdAt));
    const stem = fileStemFromTitle(input.stem ?? input.title) ?? fallback;
    return withLock(NAMES_LOCK, async () => {
      const { id } = await this.firstCandidate(stem, async (candidate) =>
        (await this.isStemFree(candidate)) ? { id: candidate, mode: "free" } : null,
      );
      await mkdir(this.metaDirectory(), { recursive: true });
      const assetId = randomUUID();
      const stub: Sidecar = {
        sidecarVersion: 2,
        assetId,
        createdAt: input.createdAt,
        title: input.title,
      };
      await this.writeAtomic(this.sidecarPath(id), JSON.stringify(stub, null, 2));
      return { id, assetId };
    });
  }

  /**
   * Reserve a stem for an item that arrives whole from another workspace (ADR 0033): `stem`,
   * else `stem (2)`, `stem (3)` … (the collision tail ADR 0035 recognizes), and write `record`
   * as its sidecar, all under NAMES_LOCK. From this moment the stem is taken and the record is
   * durable before any media can land, so `describe()` never mints a new identity for it.
   */
  async reserveIncoming(stem: string, record: Sidecar): Promise<string> {
    return withLock(NAMES_LOCK, async () => {
      const { id } = await this.firstCandidate(stem, async (candidate) =>
        (await this.stemState(candidate)) === "free" ? { id: candidate, mode: "free" } : null,
      );
      await mkdir(this.metaDirectory(), { recursive: true });
      await this.writeAtomic(
        this.sidecarPath(id),
        JSON.stringify({ ...record, sidecarVersion: 2 }, null, 2),
      );
      return id;
    });
  }

  /**
   * Give back a stem `reserve` took: its companions go, only while its record still carries
   * the reservation's identity. Never touches a media file.
   */
  async releaseReservation(reservation: Reservation): Promise<void> {
    const { id, assetId } = reservation;
    await withLock(this.sidecarPath(id), async () => {
      const read = await this.readRecordStrict(this.sidecarPath(id));
      if (read.status !== "ok" || read.sidecar.assetId !== assetId) return;
      await this.removeCompanions(this.companionPaths(id));
    });
  }

  /**
   * Undo a new item after its media was placed: the media goes only while `media.path` still
   * holds the file the placement created (`media.file`), then the reservation is released.
   */
  async discardCreated(
    reservation: Reservation,
    media: { path: string; file: PlacedFile },
  ): Promise<void> {
    if (!(await removeIfSame(media.path, media.file))) {
      console.error(`could not remove the new item's media "${media.path}"; kept`);
    }
    await this.releaseReservation(reservation);
  }

  /** Where a rename of `self` (owner of `assetId`, media at `selfMedia`) lands for `stem`. */
  private resolveRenameTarget(
    stem: string,
    self: string,
    selfMedia: string,
    assetId: string,
    allowLeftover: boolean,
  ): Promise<StemResolution> {
    return this.firstCandidate(stem, async (candidate) => {
      if (candidate === self) return { id: candidate, mode: "same" };
      // Copy-then-delete would delete the copy if any path is shared with the source.
      if (this.pathsOverlap(candidate, self)) return null;
      if (await this.isStemFree(candidate)) return { id: candidate, mode: "free" };
      if (foldName(candidate) === foldName(self) && (await this.isSameFile(candidate, selfMedia))) {
        return { id: candidate, mode: "case" };
      }
      if (
        allowLeftover &&
        !(await this.hasMedia(candidate)) &&
        (await this.sidecar(candidate)).assetId === assetId
      ) {
        return { id: candidate, mode: "leftover" };
      }
      return null;
    });
  }

  /**
   * Whether two different stems share a path (case-folded, as on APFS/NTFS): e.g. a legacy
   * `Demo.edit` item, whose sidecar `Demo.edit.json` is `Demo`'s edit session. A case-only
   * variant of the same stem is not an overlap; `moveInPlace` handles it.
   */
  private pathsOverlap(a: string, b: string): boolean {
    if (foldName(a) === foldName(b)) return false;
    const owned = (id: string): string[] => [
      ...ALL_EXTS.map((ext) => join(this.directory, `${id}${ext}`)),
      ...Object.values(this.companionPaths(id)),
    ];
    const theirs = new Set(owned(b).map(foldName));
    return owned(a).some((path) => theirs.has(foldName(path)));
  }

  /** Another stem with media whose companion paths overlap `id`'s, or null. */
  private async sharesCompanionsWith(id: string): Promise<string | null> {
    for (const name of await readdir(this.directory)) {
      const ext = ALL_EXTS.find((e) => name.endsWith(e));
      if (!ext || name.startsWith(".")) continue;
      const stem = name.slice(0, -ext.length);
      if (stem !== id && this.pathsOverlap(id, stem)) return stem;
    }
    return null;
  }

  /**
   * Give media without a record its first sidecar (reconcile adoption, NIW2-561): a new
   * identity, `title` and `createdAt`, in one atomic write. Does nothing (false) when a
   * record exists by now, of any readability, or the media is gone.
   *
   * In a synced workspace the missing sidecar may be on its way down from the provider, and a
   * second one written here would conflict with it. It is minted only when the user asked for
   * it (`explicit`: "Check and fix files"); otherwise this returns false.
   */
  async adoptMedia(
    id: string,
    fields: { title: string; createdAt: number },
    options: { explicit?: boolean } = {},
  ): Promise<boolean> {
    if (isVaultOwnedStem(id)) return false;
    if (this.synced && options.explicit !== true) return false;
    const path = this.sidecarPath(id);
    return withLock(path, async () => {
      if ((await this.readRecordStrict(path)).status !== "missing") return false;
      if (!(await this.hasMedia(id))) return false;
      await mkdir(this.metaDirectory(), { recursive: true });
      const record: Sidecar = { sidecarVersion: 2, assetId: randomUUID(), ...fields };
      await this.writeAtomic(path, JSON.stringify(record, null, 2));
      return true;
    });
  }

  /**
   * The identity of an item whose record is readable, minting one into that record when it has
   * none (a sidecar from before identities). Only for an explicit "Check and fix files": a
   * synced workspace never mints on its own (`ensureIdentity`), and `adoptMedia` serves only a
   * missing sidecar, so without this a pre-identity record in a synced folder stays read-only.
   * Every other field is kept. Null when the record is missing or unreadable (nothing is
   * written: a missing one may still be on its way down) or the media is gone. `minted` is false
   * when the record already had an identity, at the first read or when the sidecar is read again
   * just before the write (a newer version may have arrived meanwhile): then nothing was changed.
   */
  async mintIdentity(id: string): Promise<{ assetId: string; minted: boolean } | null> {
    if (isVaultOwnedStem(id) || !isPlainItemId(id)) return null;
    const path = this.sidecarPath(id);
    return withLock(path, async () => {
      const read = await this.readRecordStrict(path);
      if (read.status !== "ok") return null;
      if (read.sidecar.assetId) return { assetId: read.sidecar.assetId, minted: false };
      if (!(await this.hasMedia(id))) return null;
      // The folder is shared: a version with an identity may have arrived since the read above.
      // Minting over it would give the item a second identity that conflicts with that one.
      const again = await this.readRecordStrict(path);
      if (again.status !== "ok") return null;
      if (again.sidecar.assetId) return { assetId: again.sidecar.assetId, minted: false };
      const assetId = readOnlyIdentityMemo.get(path) ?? randomUUID();
      await this.writeAtomic(
        path,
        JSON.stringify({ ...again.sidecar, sidecarVersion: 2, assetId }, null, 2),
      );
      readOnlyIdentityMemo.delete(path);
      return { assetId, minted: true };
    });
  }

  /** Whether `candidate` with `media`'s extension is the very same file (case-insensitive FS). */
  private async isSameFile(candidate: string, media: string): Promise<boolean> {
    try {
      const [a, b] = await Promise.all([
        stat(join(this.directory, `${candidate}${extname(media)}`)),
        stat(media),
      ]);
      return a.ino === b.ino && a.dev === b.dev;
    } catch {
      return false;
    }
  }

  /**
   * Save the title and move the item — media and every companion — to the stem the
   * title derives (ADR 0035). Holds NAMES_LOCK and the old sidecar's lock throughout.
   *
   * Order: title into the old sidecar → companions copied to the new stem → media
   * `rename` (the commit point) → old companions deleted. Every crash point leaves the
   * old item or the new item whole, and the title is never lost.
   *
   * Throws `ItemNotFoundError` when no item carries `target.assetId`, and
   * `AmbiguousIdentityError` when two do; a failed title write rethrows the underlying fs
   * error (EACCES, EPERM …). Every failure after the title is saved resolves with
   * `file: "kept-old-name"`.
   */
  async renameItem(
    target: RenameTarget,
    title: string,
    options: RenameOptions = {},
  ): Promise<RenameResult> {
    if (!isPlainItemId(target.id) || !target.assetId) throw new ItemNotFoundError(target.id);
    return withLock(NAMES_LOCK, async () => {
      // The item by identity, under the names lock: `target.id` when it still holds
      // `target.assetId`, else wherever that identity lives now (it moved since the caller
      // looked). Never whatever item holds the name now.
      const id = await this.resolveTarget(target);
      const oldSidecar = this.sidecarPath(id);
      return withLock(oldSidecar, async () => {
        const oldMedia = await this.mediaPath(id);
        if (!oldMedia) throw new ItemNotFoundError(id);
        if (options.refuseSharedCompanions) {
          const other = await this.sharesCompanionsWith(id);
          if (other !== null) throw new SharedCompanionError(id, other);
        }

        // 1. The title first: whatever happens to the file, the user's name is saved.
        // The identity is settled here too, so `describe()` below never needs this lock.
        const current = await this.writableSidecar(id);
        const meta: Sidecar = {
          ...current,
          sidecarVersion: 2,
          title,
          assetId: current.assetId ?? readOnlyIdentityMemo.get(oldSidecar) ?? randomUUID(),
        };
        delete meta.localRemovedAt;
        await mkdir(this.metaDirectory(), { recursive: true });
        await this.writeAtomic(oldSidecar, JSON.stringify(meta, null, 2));
        const describeOld = async (): Promise<LocalRecording> => {
          const recording = await this.describe(id);
          if (!recording) throw new ItemNotFoundError(id);
          return recording;
        };

        // 2. The target stem.
        const ext = extname(oldMedia);
        const createdAt = captureDate(meta, id, await stat(oldMedia));
        const stem = alignedBase(title, kindFromExt(ext), new Date(createdAt));
        let target: StemResolution;
        try {
          target = await this.resolveRenameTarget(
            stem,
            id,
            oldMedia,
            meta.assetId!,
            options.allowLeftover ?? true,
          );
        } catch {
          // A candidate that could not be checked (EIO, EACCES): never treated as free.
          return { recording: await describeOld(), file: "kept-old-name", reason: "io" };
        }
        if (target.mode === "same") return { recording: await describeOld(), file: "unchanged" };

        // 3. The video editor holds this id (session saves, cursor track, source URL):
        // moving the file under it would send its next save to the old paths.
        if (options.isEditing?.(id, meta.assetId!)) {
          return { recording: await describeOld(), file: "kept-old-name", reason: "editing" };
        }
        // An export may be streaming the file: moving it would fail the export.
        if (options.isBusy?.()) {
          return { recording: await describeOld(), file: "kept-old-name", reason: "busy" };
        }

        const newId = target.id;
        const newMedia = join(this.directory, `${newId}${ext}`);
        // A rename moves the file's ctime but not its content, so a hash that matched before
        // it is stamped again for the new name; without this every rename would cost a re-hash.
        const hashStampBefore = await this.freshHashStat(current, oldMedia);
        const from = this.companionPaths(id);
        const to = this.companionPaths(newId);
        const retry = options.retry ?? DEFAULT_RENAME_RETRY;
        let keptCompanions: string[] = [];

        if (target.mode === "case") {
          const reason = await this.moveInPlace(from, to, oldMedia, newMedia, retry, id);
          if (reason) return { recording: await describeOld(), file: "kept-old-name", reason };
        } else {
          // 4. Companions to the new stem. A leftover of this item is cleared first.
          if (target.mode === "leftover") await this.removeCompanions(to);
          const created: string[] = [];
          const copies: CompanionCopy[] = [];
          try {
            // The old sidecar was just written (step 1) with the same content: stamped like any
            // companion, so a later edit of it by another device keeps it.
            if (this.synced) {
              copies.push({
                from: from.sidecar,
                to: to.sidecar,
                stamp: await fileStamp(from.sidecar),
              });
            }
            await this.writeAtomic(to.sidecar, JSON.stringify(meta, null, 2));
            created.push(to.sidecar);
            const copied = [
              "thumbnail",
              "cursorTrack",
              "editSession",
              "editMeta",
              "canvasDoc",
              "textCache",
              "transcript",
              "webcam",
            ] as const;
            for (const key of copied) {
              // Strict: a companion that cannot be checked is not skipped, since the
              // old companions are deleted after the commit.
              if (!(await existsStrict(from[key]))) continue;
              // A synced folder: copying an offloaded companion would download it, so the
              // rename stops (the title is saved) rather than start that download.
              await this.assertLocal([from[key]]);
              // Stamped before the copy: the old file is deleted only if it is still this one.
              if (this.synced)
                copies.push({ from: from[key], to: to[key], stamp: await fileStamp(from[key]) });
              // A clone where the volume has them: the webcam file is as large as a take.
              await this.copyCompanion(from[key], to[key]);
              created.push(to[key]);
            }
            if (await existsStrict(from.assetsDir)) {
              if (this.synced) {
                const files = await filesUnder(from.assetsDir);
                await this.assertLocal(files);
                for (const file of files) {
                  copies.push({
                    from: file,
                    to: join(to.assetsDir, relative(from.assetsDir, file)),
                    stamp: await fileStamp(file),
                  });
                }
              }
              created.push(to.assetsDir);
              if (this.synced) {
                await this.copyCompanionTree(from.assetsDir, to.assetsDir);
              } else {
                await cp(from.assetsDir, to.assetsDir, {
                  recursive: true,
                  force: false,
                  errorOnExist: true,
                });
              }
            }
            // A synced folder: every copy is proven equal to an unchanged source before the
            // commit, or the rename stops with both kept.
            await verifyCopies(copies);
          } catch (error) {
            await this.removePaths(created);
            // An offloaded companion is not an I/O failure: the user can fix it (download it).
            const reason = error instanceof EvictedFileError ? "evicted" : "io";
            return { recording: await describeOld(), file: "kept-old-name", reason };
          }

          // 5. The commit point.
          const failure = await this.renameWithRetry(oldMedia, newMedia, retry);
          if (failure) {
            await this.removePaths(created);
            if (failure === "gone") throw new ItemNotFoundError(id);
            return { recording: await describeOld(), file: "kept-old-name", reason: failure };
          }

          // 6. Old companions last, best effort: a leftover is invisible to `list()`. In a
          // synced folder one that changed since its stamp (another device edited it) is kept.
          if (this.synced) keptCompanions = await this.removeUnchangedCompanions(from, copies);
          else await this.removeCompanions(from);
        }

        readOnlyIdentityMemo.delete(oldSidecar);
        if (hashStampBefore) await this.restampAfterRename(newId, newMedia, hashStampBefore);
        const recording = await this.describe(newId);
        if (!recording) throw new ItemNotFoundError(newId);
        return keptCompanions.length > 0
          ? { recording, file: "renamed", keptCompanions }
          : { recording, file: "renamed" };
      });
    });
  }

  /** The file's stat when the sidecar's cached hash still matches it, else null. */
  private async freshHashStat(meta: Sidecar, path: string): Promise<Stats | null> {
    if (!meta.contentSha256) return null;
    try {
      const info = await stat(path);
      return stampMatches(meta, info) ? info : null;
    } catch {
      return null;
    }
  }

  /**
   * Writes the renamed file's new stamp into its sidecar when it is the same file as before
   * (same size, mtime and inode: a rename only moves the ctime). Best effort: a failure leaves
   * the old stamp, which fails to match and costs one re-hash.
   */
  private async restampAfterRename(newId: string, newMedia: string, before: Stats): Promise<void> {
    try {
      const after = await stat(newMedia);
      if (
        after.size === before.size &&
        after.mtimeMs === before.mtimeMs &&
        after.ino === before.ino
      ) {
        await this.writeMeta(newId, stampFields(after));
      }
    } catch {
      // The next hash request recomputes.
    }
  }

  /** The id `target.assetId` lives under now, or ItemNotFoundError. Caller holds NAMES_LOCK. */
  private async resolveTarget(target: RenameTarget): Promise<string> {
    const id = await this.resolveIdentity(target.id, target.assetId);
    if (id === null) throw new ItemNotFoundError(target.id);
    return id;
  }

  /**
   * Hold an item for the video editor, serialized with renames through NAMES_LOCK: an
   * acquisition issued while a rename is moving the file waits for it, and a rename that
   * starts after it sees the hold (`isEditing`) and keeps the file's name. Resolves the
   * item's **current** id — the one the editor must load and write under — once `hold(id)`,
   * called inside the lock, accepted it; null (nothing held) when no local item has
   * `assetId` or `hold` refused (the requesting window went away while the request waited).
   */
  async acquireForEditor(assetId: string, hold: (id: string) => boolean): Promise<string | null> {
    return withLock(NAMES_LOCK, async () => {
      const id = await this.resolveIdentity(null, assetId);
      if (id === null) return null;
      return hold(id) ? id : null;
    });
  }

  /**
   * The one local item holding `assetId`, for every operation that acts on an identity
   * (rename, editor hold, screenshot overwrite). Caller holds NAMES_LOCK.
   *
   * Fast path: `id` still holds that identity → `id`; the caller's own item is never
   * ambiguous to it. Otherwise exactly one media-bearing item, of any kind, must carry it:
   * more than one → `AmbiguousIdentityError`, thrown before any mutation or hold. With
   * `kind`, the resolved item must be of that kind; none, or the wrong kind → null (each
   * caller maps that to its own "gone" outcome).
   */
  private async resolveIdentity(
    id: string | null,
    assetId: string,
    kind?: LocalRecording["kind"],
  ): Promise<string | null> {
    const media = id === null ? null : await this.mediaPath(id);
    if (media !== null && (await this.writableSidecar(id!)).assetId === assetId) {
      // The caller's own item — but only as the kind it expects: a screenshot overwrite
      // must never write `<id>.png` beside the recording `<id>.mp4` that holds the identity.
      return kind === undefined || kindFromExt(extname(media)) === kind ? id : null;
    }
    // Ambiguity is counted across every media kind first: a screenshot and a recording
    // claiming one identity are as ambiguous as two screenshots.
    const matches = (await this.list()).filter((item) => item.assetId === assetId);
    const ids = [...new Set(matches.map((item) => item.id))];
    if (ids.length > 1) throw new AmbiguousIdentityError(assetId, ids);
    const [sole] = matches;
    if (!sole) {
      // Nowhere else either: when the caller's own id names media under an unreadable
      // record, say so rather than "not found" (its identity cannot be read, F9).
      if (media !== null) await this.writableSidecar(id!);
      return null;
    }
    return kind === undefined || sole.kind === kind ? sole.id : null;
  }

  /**
   * Move the media to `to` through `safe-place`, never replacing a file there, retried while
   * the file is locked. Resolves null on success, else why it failed: "taken" (a file is at
   * `to`, however it arrived), "locked" (still held after every retry), "gone" (ENOENT),
   * "io". `caseOnly`: `to` names the same file in another case or normalization.
   */
  private async renameWithRetry(
    from: string,
    to: string,
    retry: RetryPolicy,
    caseOnly = false,
  ): Promise<"taken" | "locked" | "gone" | "io" | null> {
    const sleep = retry.sleep ?? sleepFor;
    for (let attempt = 0; ; attempt++) {
      try {
        const placed = this.synced
          ? caseOnly
            ? await renameCaseOnlyByRename(from, to)
            : await placeByRename(from, to, { intoSynced: true })
          : caseOnly
            ? await renameCaseOnly(from, to)
            : await placeNoReplace(from, to, { stuck: "rollback" });
        return placed === "taken" ? "taken" : null;
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") return "gone";
        if (!code || !LOCKED_CODES.has(code)) return "io";
        if (attempt >= retry.delaysMs.length) return "locked";
        await sleep(retry.delaysMs[attempt]!);
      }
    }
  }

  /**
   * A case- or normalization-only rename of the same item. On APFS/NTFS the old and new
   * names are the same files, so copy-then-delete would delete the copy: each companion
   * is renamed in place, then the media. A failed media move puts the companions back.
   */
  private async moveInPlace(
    from: CompanionPaths,
    to: CompanionPaths,
    oldMedia: string,
    newMedia: string,
    retry: RetryPolicy,
    id: string,
  ): Promise<"taken" | "locked" | "io" | null> {
    const moved: (keyof CompanionPaths)[] = [];
    const undo = async (): Promise<void> => {
      for (const key of moved.reverse()) await rename(to[key], from[key]).catch(() => {});
    };
    const keys = [
      "sidecar",
      "thumbnail",
      "cursorTrack",
      "editSession",
      "editMeta",
      "canvasDoc",
      "textCache",
      "transcript",
      "assetsDir",
      "webcam",
    ];
    try {
      for (const key of keys as (keyof CompanionPaths)[]) {
        if (!(await existsStrict(from[key]))) continue;
        await rename(from[key], to[key]);
        moved.push(key);
      }
    } catch {
      await undo();
      return "io";
    }
    const failure = await this.renameWithRetry(oldMedia, newMedia, retry, true);
    if (failure) {
      await undo();
      if (failure === "gone") throw new ItemNotFoundError(id);
      return failure;
    }
    await rm(from.cursorTrackTemp, { force: true }).catch(() => {});
    return null;
  }

  /**
   * Where a synced vault stages a file bound for `target`: its scratch folder, or a hidden folder
   * on the target's volume, created. Never beside the target: a half-written file there is
   * uploaded as it stands. Throws EXDEV when there is no folder outside the provider.
   */
  private async stagingFolderFor(target: string): Promise<string> {
    const folder = this.stagingDir ?? (await volumeStagingDir(target, { assumeSynced: true }));
    if (folder === null) {
      throw Object.assign(new Error(`no folder outside the provider to stage "${target}"`), {
        code: "EXDEV",
      });
    }
    await mkdir(folder, { recursive: true });
    return folder;
  }

  /**
   * Copies one companion to `target`, never replacing a file there. In a synced folder the copy
   * is never written under a name the provider can see: a half-written file there is uploaded
   * as it stands. It is staged outside the folder (the scratch folder, or a hidden folder on the
   * destination's volume) and arrives by rename, whole. A clone where the volume has them: the
   * webcam file is as large as a take.
   */
  private async copyCompanion(source: string, target: string): Promise<void> {
    if (!this.synced) {
      await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      return;
    }
    const folder = await this.stagingFolderFor(target);
    const staged = join(folder, basename(uniqueTempPath(target, "part")));
    try {
      await copyFile(source, staged, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      const placed = await placeByRename(staged, target, { intoSynced: true });
      if (placed === "taken") throw takenError(target);
    } catch (error) {
      await rm(staged, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** `copyCompanion` for a folder: the folder is made empty, each file arrives whole by rename. */
  private async copyCompanionTree(source: string, target: string): Promise<void> {
    await mkdir(target);
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = join(source, entry.name);
      const to = join(target, entry.name);
      if (entry.isDirectory()) await this.copyCompanionTree(from, to);
      else await this.copyCompanion(from, to);
    }
  }

  private async removePaths(paths: string[]): Promise<void> {
    await Promise.allSettled(paths.map((path) => rm(path, { recursive: true, force: true })));
  }

  private async removeCompanions(paths: CompanionPaths): Promise<void> {
    await this.removePaths(Object.values(paths));
  }

  /**
   * Deletes the old name's companions after a synced rename, but only a file that has a stamp
   * and is still the one that was copied (same size, mtime and inode as when it was stamped).
   * Everything else is kept and returned (relative to the `.kaipu` folder): a file that changed,
   * one that appeared after the copy (it has no stamp, and was never copied under the new name),
   * and the interrupted-write leftover.
   */
  private async removeUnchangedCompanions(
    from: CompanionPaths,
    copies: CompanionCopy[],
  ): Promise<string[]> {
    const kept: string[] = [];
    const stamps = new Map(copies.map((copy) => [copy.from, copy]));
    const meta = this.metaDirectory();
    const removeIfUnchanged = async (path: string): Promise<void> => {
      const copy = stamps.get(path);
      try {
        // The stamp is a cheap first check; the digest the copy was verified against is the
        // proof, taken again from the file right before it goes (a rewrite in place can keep the
        // size, mtime and inode).
        if (
          copy?.digest !== undefined &&
          sameStamp(copy.stamp, await fileStamp(path)) &&
          (await sha256FileBase64(path)) === copy.digest
        ) {
          await rm(path);
        } else kept.push(relative(meta, path));
      } catch (error) {
        // Already gone: nothing to keep. Anything else could not be proven unchanged.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") kept.push(relative(meta, path));
      }
    };
    const { assetsDir, ...others } = from;
    for (const path of Object.values(others)) {
      if (stamps.has(path)) await removeIfUnchanged(path);
      // Never copied: it arrived after the copy, or it is the interrupted-write leftover.
      else if (await existsStrict(path).catch(() => true)) kept.push(relative(meta, path));
    }
    const files = await filesUnder(assetsDir).catch(() => [] as string[]);
    for (const file of files) await removeIfUnchanged(file);
    await removeEmptyFolders(assetsDir);
    return kept;
  }

  async list(): Promise<LocalRecording[]> {
    // The root is never created here: a missing folder is a workspace that is not
    // connected (an unplugged drive), and recreating it would list it as empty.
    // Let a readdir failure propagate (unreadable folder, unreachable network
    // drive) instead of returning [] — an empty array is indistinguishable from
    // "vault is empty" and gets rendered as the first-run empty state, which
    // reads as data loss. The caller surfaces the real error.
    const entries = await readdir(this.directory);
    const media = entries.filter((f) => ALL_EXTS.some((ext) => f.endsWith(ext)));
    const ids = media.map((f) => basename(f, ALL_EXTS.find((ext) => f.endsWith(ext))!));
    // A synced workspace asks the provider once for the whole folder: every media file and
    // every thumbnail, in one batched `stat` (never a read).
    // Only posters that exist are asked about (one `readdir`, never a download): a path that is
    // not there makes `stat` fail, which sends the whole batch to the slow per-path fallback,
    // and a probe that runs out of time reports every unanswered path evicted (a local file
    // would then read "Not downloaded"). A screenshot has no poster at all.
    let evicted: ReadonlySet<string> | undefined;
    if (this.evictionProbe) {
      const posters = new Set(await readdir(this.metaDirectory()).catch(() => [] as string[]));
      evicted = await this.evictionProbe([
        ...media.map((f) => join(this.directory, f)),
        ...ids.flatMap((id, index) =>
          IMAGE_EXTS.some((ext) => media[index]!.endsWith(ext)) || !posters.has(`${id}.jpg`)
            ? []
            : [this.thumbnailPath(id)],
        ),
      ]);
    }
    // Each item reads its sidecar, and in a synced folder a read can download it: at most
    // `SYNCED_LIST_CONCURRENCY` at a time (a thousand starting at once is a download storm that
    // also makes every read wait behind the rest and time out). A plain vault reads side by side.
    const stalls = { since: this.sidecarTimeouts, deadline: Date.now() + SYNCED_READS_BUDGET_MS };
    const described = await mapLimit(
      ids,
      this.synced ? SYNCED_LIST_CONCURRENCY : Math.max(1, ids.length),
      (id) => this.describe(id, evicted, stalls),
    );
    return described
      .filter((r): r is LocalRecording => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** How many media files the root holds, without describing them (the switcher's counts). */
  async countMedia(): Promise<number> {
    const entries = await readdir(this.directory);
    return entries.filter((f) => ALL_EXTS.some((ext) => f.endsWith(ext))).length;
  }

  /**
   * The item, or null when its media is gone. `evicted` is the answer of this vault's eviction
   * probe for a whole listing; a single call asks for this item's two files itself.
   */
  async describe(
    id: string,
    evicted?: ReadonlySet<string>,
    stalls?: { since: number; deadline: number },
  ): Promise<LocalRecording | null> {
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
    // This listing already saw the provider stall on several sidecars, or spent its whole time
    // budget on slow ones: stop asking it.
    if (
      stalls &&
      (this.sidecarTimeouts - stalls.since >= SYNCED_LIST_STALL_LIMIT ||
        (this.synced && Date.now() >= stalls.deadline))
    ) {
      return this.describeUnreadable(id, filePath, info, "unreadable", evicted);
    }
    try {
      meta = await this.ensureIdentity(id);
    } catch (error) {
      // The file moved (a rename) between the stat above and the sidecar read.
      if (error instanceof ItemGoneError) return null;
      // Still listed, so the user sees the file exists; read-only until the sidecar reads again.
      if (error instanceof SidecarUnavailableError) {
        return this.describeUnreadable(id, filePath, info, error.issue, evicted);
      }
      throw error;
    }
    // An evicted media file (or a video's evicted poster) gets no image URL: the protocol would
    // read it, and reading downloads it (decision 15, Things the code contradicted, 18).
    const { mediaEvicted, thumbEvicted } = await this.evictionOf(id, filePath, isImage, evicted);
    // A legacy stamp (no ctime, no inode) still counts here, as before: describe never hashes,
    // so refusing it would leave cloud-linked items "pending" until something else re-hashes.
    const hashIsFresh =
      meta.contentSha256 !== undefined &&
      (stampMatches(meta, info) || legacyStampMatches(meta, info));
    // Only while the file is there (`webcamTrackState`, the rule `probeWebcam` shares): a
    // sidecar field without its file is a missing track. No field, no file check.
    const webcam =
      isImage || isGif || !meta.webcam
        ? null
        : webcamTrackState(await exists(this.webcamFilePath(id)), meta.webcam).meta;
    const thumbnailMtime = isImage ? null : await mtimeOf(this.thumbnailPath(id));
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
      sourceVideoAssetId:
        typeof meta.sourceVideoAssetId === "string" && meta.sourceVideoAssetId
          ? meta.sourceVideoAssetId
          : null,
      sourceTimeSeconds:
        typeof meta.sourceTimeSeconds === "number" && Number.isFinite(meta.sourceTimeSeconds)
          ? meta.sourceTimeSeconds
          : null,
      ...(meta.sourceSceneSourceId === null ||
      (typeof meta.sourceSceneSourceId === "string" && meta.sourceSceneSourceId.trim() !== "")
        ? { sourceSceneSourceId: meta.sourceSceneSourceId }
        : {}),
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
      webcam,
      thumbnailUrl:
        mediaEvicted || thumbEvicted
          ? null
          : isImage
            ? // `?v=<mtime>` busts the renderer image cache when a screenshot is
              // overwritten in place (same id/URL) — only the changed item, so the
              // rest stay cacheable.
              mediaUrl("screenshot", id, this.mediaParams({ v: String(Math.round(info.mtimeMs)) }))
            : thumbnailMtime === null
              ? null
              : // Same for a poster: the webcam composite rewrites it in place (NIW2-845).
                mediaUrl("thumb", id, this.mediaParams({ v: String(Math.round(thumbnailMtime)) })),
      // Only a webcam recording (`webcam` is null without its file) whose poster is not yet
      // the composite. Absent for everything else, so older callers see no field.
      ...(webcam ? { thumbnailNeedsWebcam: !hasWebcamThumbnail(meta) } : {}),
      ...(mediaEvicted
        ? { evicted: "media" as const }
        : thumbEvicted
          ? { evicted: "thumbnail" as const }
          : {}),
    };
  }

  /**
   * What the file alone can tell: the item, with the sidecar's fields unknown. It carries a
   * stand-in assetId (derived from the file id, never written anywhere) so the Library can
   * still key and list it; `metadataIssue` is what tells every consumer not to trust or
   * write it.
   */
  private async describeUnreadable(
    id: string,
    filePath: string,
    info: { size: number; birthtimeMs: number },
    issue: MetadataIssue,
    evicted?: ReadonlySet<string>,
  ): Promise<LocalRecording> {
    const isImage = IMAGE_EXTS.some((ext) => filePath.endsWith(ext));
    const isGif = GIF_EXTS.some((ext) => filePath.endsWith(ext));
    const { mediaEvicted, thumbEvicted } = await this.evictionOf(id, filePath, isImage, evicted);
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
      sourceVideoAssetId: null,
      sourceTimeSeconds: null,
      contentSha256: null,
      tagIds: [],
      gif: null,
      export: null,
      editorOpenedAt: null,
      editorSavedAt: null,
      capture: null,
      thumbnailUrl: null,
      metadataIssue: issue,
      ...(mediaEvicted
        ? { evicted: "media" as const }
        : thumbEvicted
          ? { evicted: "thumbnail" as const }
          : {}),
    };
  }

  /**
   * Which of an item's two files the provider has offloaded: its media and, for a video or a
   * GIF, its poster. A listing passes its one batched answer (`evicted`); a single call asks for
   * this item. Only a poster that is there is asked about (a missing path makes `stat` slow).
   */
  private async evictionOf(
    id: string,
    filePath: string,
    isImage: boolean,
    evicted?: ReadonlySet<string>,
  ): Promise<{ mediaEvicted: boolean; thumbEvicted: boolean }> {
    if (!this.evictionProbe) return { mediaEvicted: false, thumbEvicted: false };
    const poster = this.thumbnailPath(id);
    const hasPoster = !isImage && (evicted !== undefined || (await exists(poster)));
    const offloaded =
      evicted ?? (await this.evictionProbe(hasPoster ? [filePath, poster] : [filePath]));
    return {
      mediaEvicted: offloaded.has(filePath),
      thumbEvicted: hasPoster && offloaded.has(poster),
    };
  }

  /**
   * The item's record, read strictly through the vault's reader (so a test can fail it):
   * missing, the parsed record, or why it cannot be trusted. A record that is not a valid
   * sidecar object is copied aside once per session (`quarantine`); the original is untouched.
   */
  private async readRecord(id: string): Promise<SidecarRead> {
    const path = this.sidecarPath(id);
    let raw: string;
    try {
      raw = await this.readSidecarText(path);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return { status: "missing" };
      return { status: "unreadable", error: String(error) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      await this.quarantine(path);
      return { status: "corrupt-json", error: String(error) };
    }
    if (!isSidecarShape(parsed)) {
      await this.quarantine(path);
      return { status: "invalid-schema", error: "unexpected shape" };
    }
    quarantinedSidecars.delete(path);
    return { status: "ok", sidecar: parsed };
  }

  /**
   * The sidecar a mutation may merge over: `{}` when there is none yet, else the strictly
   * read record. Throws `UnreadableRecordError` for anything else (F9, NIW2-568).
   */
  private async writableSidecar(id: string): Promise<Sidecar> {
    const path = this.sidecarPath(id);
    if (isVaultOwnedStem(id)) throw new UnreadableRecordError(id, "vault-owned", path);
    const read = await this.readRecord(id);
    if (read.status === "ok") return read.sidecar;
    if (read.status === "missing") return {};
    throw new UnreadableRecordError(id, read.status, path);
  }

  /**
   * For writers outside this class (edit-session saves): refuse before touching any file
   * when the item's record is unreadable.
   */
  async assertWritableRecord(id: string): Promise<void> {
    await this.writableSidecar(id);
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
      raw = await this.readSidecarText(path);
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

  /**
   * Keep a copy of a corrupt sidecar, once per path per session. Never touches the original.
   * The copy is a file under a final name, so it arrives through `writeAtomic` (staged outside a
   * synced folder, then renamed): the provider never uploads a half-written copy.
   */
  private async quarantine(path: string): Promise<void> {
    if (quarantinedSidecars.has(path)) return;
    quarantinedSidecars.add(path);
    await readFile(path)
      .then((bytes) => this.writeAtomic(`${path}.corrupt-${Date.now()}`, bytes))
      .catch(() => undefined);
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
    const quick = await this.writableSidecar(id);
    if (quick.assetId && quick.localRemovedAt === undefined) {
      return quick as Sidecar & { assetId: string };
    }
    const sidecarPath = this.sidecarPath(id);
    // Module-level lock keyed by path: a second caller (even from another
    // LibraryVault instance) waits, then re-reads and finds the first one's id.
    return withLock(sidecarPath, async () => {
      let current = await this.writableSidecar(id);
      // A synced folder can deliver the media before its sidecar, and the sidecar can arrive
      // between two reads. Minting an identity then would write a second, different sidecar
      // over the one that arrived: the item loses its title, tags and identity. So a synced
      // vault never mints here: it reads the sidecar once more and uses the identity it has. A
      // missing sidecar, or a readable one without an identity, leaves the item read-only for
      // as long as it takes; the user can mint one on purpose through "Check and fix files"
      // (`adoptMedia` for a missing sidecar, `mintIdentity` for a readable one without it).
      if (this.synced && current.assetId === undefined) {
        const again = await this.readRecord(id);
        if (again.status !== "ok" || again.sidecar.assetId === undefined) {
          throw new SidecarUnavailableError("unreadable", sidecarPath);
        }
        current = again.sidecar;
      }
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
      } catch (error) {
        // Renamed or removed while we read it: there is no item to give an identity to.
        if (error instanceof ItemGoneError || error instanceof UnreadableRecordError) throw error;
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

  /**
   * Read-merge-write; the caller must hold the sidecar lock. Never creates a sidecar for
   * an id with neither a sidecar nor media: a hash, tag or heal write queued behind a
   * rename would otherwise resurrect the old stem as an orphan (`ItemGoneError`).
   */
  private async writeMetaLocked(id: string, meta: Sidecar): Promise<void> {
    const path = this.sidecarPath(id);
    if (isVaultOwnedStem(id)) throw new UnreadableRecordError(id, "vault-owned", path);
    const read = await this.readRecord(id);
    if (read.status === "missing" && !(await this.hasMedia(id))) throw new ItemGoneError(id);
    if (read.status !== "ok" && read.status !== "missing") {
      throw new UnreadableRecordError(id, read.status, path);
    }
    // A synced folder may still be delivering the sidecar: a partial one written here would
    // conflict with it, and would then read as a record with no identity. Every creator
    // reserves its stub first (`reserve`, `reserveIncoming`, `adoptMedia`), so nothing legit
    // gets here without a sidecar.
    if (read.status === "missing" && this.synced) {
      throw new UnreadableRecordError(id, "unreadable", path);
    }
    const current = read.status === "ok" ? read.sidecar : {};
    await mkdir(this.metaDirectory(), { recursive: true });
    await this.writeAtomic(
      this.sidecarPath(id),
      JSON.stringify({ ...current, ...meta, sidecarVersion: 2 }, null, 2),
    );
  }

  /** Whether `id` names a media file in the vault right now (not deleted, not unknown). */
  async hasMedia(id: string): Promise<boolean> {
    if (!isPlainItemId(id)) return false;
    for (const ext of ALL_EXTS) {
      // Strict: "no media" lets a rename take the stem as a leftover and clear it.
      if (await existsStrict(join(this.directory, `${id}${ext}`))) return true;
    }
    return false;
  }

  /**
   * The cached sha256 of the item's media, without reading the media: `hit` when the sidecar's
   * stamp still matches the file, `miss` when there is no hash or the stamp moved, `missing`
   * when the item has no media file (ENOENT); any other stat error throws. An unreadable sidecar
   * is a `miss`.
   */
  async cachedContentHash(
    id: string,
  ): Promise<
    { status: "hit"; contentSha256: string } | { status: "miss" } | { status: "missing" }
  > {
    let info;
    try {
      info = await stat(await this.filePath(id));
    } catch (error) {
      // Only an absent file is "missing"; EACCES or EIO must not read as "no transcript".
      if (errorCode(error) === "ENOENT") return { status: "missing" };
      throw error;
    }
    let meta: Sidecar;
    try {
      meta = await this.sidecar(id);
    } catch {
      return { status: "miss" };
    }
    return meta.contentSha256 && stampMatches(meta, info)
      ? { status: "hit", contentSha256: meta.contentSha256 }
      : { status: "miss" };
  }

  /**
   * The file's sha256, from the sidecar cache when its stamp (size, mtime, ctime, inode) still
   * matches the file, otherwise recomputed and cached. Never called by `list()`. Retries up to 3
   * times if the file changes during hashing; throws `FileChangedWhileHashingError` if it keeps
   * changing after the third attempt.
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
    const meta = await this.writableSidecar(id);
    if (meta.contentSha256 && stampMatches(meta, info)) {
      return { contentSha256: meta.contentSha256, sizeBytes: info.size };
    }

    // Hashing reads every byte: an offloaded file would be downloaded to answer. A cache hit
    // above read nothing, so it is still served.
    await this.assertLocal([filePath]);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const contentSha256 = await sha256FileBase64(filePath);
      // Re-stat after hashing: if the file changed underneath, don't cache a lie.
      const after = await stat(filePath);
      if (sameStat(after, info)) {
        await this.writeMeta(id, { contentSha256, ...stampFields(info) });
        return { contentSha256, sizeBytes: info.size };
      }
      if (attempt < 3) {
        info = after;
      }
    }

    throw new FileChangedWhileHashingError(id);
  }

  /**
   * A plain screen frame as the poster (recorder, backfill, GIF export). It replaces any
   * webcam composite, so a marker left by one is cleared and the Library composites again.
   */
  async writeThumbnail(id: string, jpg: Buffer): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    await withLock(this.sidecarPath(id), async () => {
      await this.writeAtomic(this.thumbnailPath(id), jpg);
      await this.clearWebcamThumbnailMarker(id);
    });
  }

  /**
   * Drops `thumbnailWebcam` from a readable sidecar that has it; anything else (no sidecar,
   * no marker, an unreadable record) is left exactly as it is. Caller holds the sidecar lock.
   */
  private async clearWebcamThumbnailMarker(id: string): Promise<void> {
    const read = await this.readRecord(id);
    if (read.status !== "ok" || read.sidecar.thumbnailWebcam === undefined) return;
    await this.writeMetaLocked(id, { thumbnailWebcam: undefined });
  }

  /**
   * NIW2-845: replaces a webcam recording's poster with the composite the Library drew (the
   * screen frame plus the bubble) and stamps it done, under one sidecar lock so the picture
   * and its marker are never apart for another writer. Refuses (null, nothing written) a
   * recording without a webcam track or whose webcam file is gone, and one that vanished.
   * An unreadable record throws, like every other write.
   */
  async writeWebcamThumbnail(
    id: string,
    assetId: string,
    jpg: Buffer,
  ): Promise<LocalRecording | null> {
    const written = await withLock(this.sidecarPath(id), async () => {
      const sidecar = await this.writableSidecar(id);
      // The compose ran for a while: the id may name another recording now (another
      // workspace, or a file put back under the same name). Only the one it was drawn for.
      if (sidecar.assetId !== assetId) return false;
      const webcam = webcamTrackState(await exists(this.webcamFilePath(id)), sidecar.webcam);
      if (!webcam.meta || !(await this.hasMedia(id))) return false;
      await mkdir(this.metaDirectory(), { recursive: true });
      await this.writeAtomic(this.thumbnailPath(id), jpg);
      await this.writeMetaLocked(id, { thumbnailWebcam: WEBCAM_THUMBNAIL_REVISION });
      return true;
    });
    return written ? this.describe(id) : null;
  }

  /** Atomic (unique temp + rename): a crash mid-write never leaves a truncated track. */
  async writeCursorTrack(id: string, json: string): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    await this.writeAtomic(this.cursorTrackPath(id), json);
  }

  /**
   * The raw track JSON, or null only when this recording has none (`ENOENT`). Read like every
   * other companion of a synced vault: an offloaded track is never downloaded by the read
   * (`EvictedFileError`) and a stalled provider gives up after `SYNCED_SIDECAR_READ_TIMEOUT_MS`
   * (`ETIMEDOUT`). In a synced vault those and every other failure (EIO, EACCES, a folder in
   * its place) THROW instead of reading as "no track": a track that exists but cannot be read
   * now is not a recording without one. The thrown error says which: `EvictedFileError` for an
   * offloaded track, the original error otherwise. A plain vault reads any failure as none.
   * Nothing is remembered: the next call reads again.
   */
  async readCursorTrack(id: string): Promise<string | null> {
    try {
      return await this.readTextBounded(this.cursorTrackPath(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return null;
      // Only a synced workspace has a provider that can hold the track back (offloaded, or a
      // stalled read), so only there is "cannot read it" not the same as "there is none". A
      // plain workspace keeps the behaviour from before synced folders: no usable track, no
      // auto zooms, and the editor stays editable.
      if (!this.synced) return null;
      throw error;
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
   * Writes a GIF export as `<id>.gif`: a unique `.part` file, fsync, then placed through
   * `safe-place`, so a file that arrived at `<id>.gif` meanwhile is never replaced (EEXIST). A
   * failure removes the `.part`, so no partial file is ever listed (`.part` is not a known
   * extension) or left behind.
   */
  async writeGif(id: string, bytes: Uint8Array): Promise<NewMedia> {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${id}${GIF_EXTS[0]}`);
    return { path: target, file: await this.placeNewFile(target, bytes) };
  }

  /**
   * Write `bytes` to a new file at `target`, never replacing one there: EEXIST if taken.
   * Resolves the identity of the file placed, for a later undo (`discardCreated`).
   */
  private async placeNewFile(target: string, bytes: Uint8Array): Promise<PlacedFile> {
    // A synced workspace stages outside its folder (no `.part` for the provider to upload) and
    // places by rename: a hard link inside a synced folder renames the cloud item (ADR 0069).
    const folder = this.synced ? await this.stagingFolderFor(target) : null;
    const part = uniqueTempPath(folder ? join(folder, basename(target)) : target, "part");
    try {
      const handle = await open(part, "wx");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const placed = this.synced
        ? await placeByRename(part, target, { intoSynced: true })
        : await placeNew(part, target);
      if (placed === "taken") throw takenError(target);
      return placed;
    } catch (error) {
      await rm(part, { force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Overwrite a saved screenshot's PNG and merge `meta` into its sidecar, serialized
   * against renames (NAMES_LOCK) so a rename can never land between the check and the
   * write and leave the PNG resurrected under the old name. `expectedAssetId` is
   * required: if `id` no longer holds that identity (renamed meanwhile, and maybe taken
   * by another shot), the write follows the item to the id that does — never onto
   * whoever holds the name now. Resolves the id written; throws `ItemGoneError` when the
   * item is nowhere.
   */
  async overwriteImage(
    id: string,
    png: Buffer,
    meta: Sidecar,
    expectedAssetId: string,
  ): Promise<string> {
    if (!expectedAssetId) throw new Error("overwriteImage: the expected assetId is required");
    return withLock(NAMES_LOCK, async () => {
      const target = await this.resolveIdentity(id, expectedAssetId, "screenshot");
      if (target === null) throw new ItemGoneError(id);
      const resolved = target;
      await withLock(this.sidecarPath(resolved), async () => {
        // Before the PNG: a refused record must not leave new pixels under the old record.
        await this.writableSidecar(resolved);
        await this.writeImage(resolved, png, { replace: true });
        await this.writeMetaLocked(resolved, meta);
      });
      return resolved;
    });
  }

  /**
   * Writes a screenshot PNG as `<id>.png` in the vault root. `replace` is for the item's own
   * PNG, its identity verified under NAMES_LOCK (`overwriteImage`); a new shot never replaces
   * a file at its path (EEXIST). Either way `.part` is not a known extension, so `list()` never
   * shows a half-written shot, and a failed write leaves the previous PNG untouched.
   */
  async writeImage(id: string, png: Buffer, options: { replace: true }): Promise<void>;
  async writeImage(id: string, png: Buffer): Promise<NewMedia>;
  async writeImage(
    id: string,
    png: Buffer,
    options: { replace?: boolean } = {},
  ): Promise<NewMedia | void> {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, `${id}.png`);
    if (options.replace) return atomicWriteFile(target, png, "part", this.stagingDir ?? undefined);
    return { path: target, file: await this.placeNewFile(target, png) };
  }

  /** Stamp "opened in an editor now" — what the Editor home's Continue list orders by. */
  async markOpenedInEditor(id: string, at = Date.now()): Promise<void> {
    await this.writeMeta(id, { editorOpenedAt: at });
  }

  /**
   * Removes the media file plus every companion (`companionPaths`). The companions are
   * best-effort (they may not exist), but a failure to delete the media itself
   * propagates so the UI can report it. An item whose record is unreadable (or whose record
   * path the vault owns) is refused before anything is deleted: `UnreadableRecordError`.
   */
  async remove(id: string): Promise<void> {
    // Under the sidecar lock so a racing writeMeta cannot recreate the sidecar just after it is deleted.
    await withLock(this.sidecarPath(id), async () => {
      await this.writableSidecar(id);
      await this.removeCompanions(this.companionPaths(id));
    });
    await rm(await this.filePath(id), { force: true });
  }

  /**
   * Free disk space while keeping the item: deletes ONLY the media file. The
   * sidecar (identity, provenance, hash), thumbnail, edit session and assets stay,
   * so the item survives as a cloud-only entry and can be downloaded back under
   * the same assetId. Not `remove()`: that one is the destructive delete.
   */
  async removeLocalCopy(id: string): Promise<void> {
    // A synced workspace never deletes through this (spec decision 4): the file lives in the
    // provider's folder, and deleting it there deletes it in the cloud and on every device.
    // The service reveals the file in Finder instead; this is the guard behind it.
    if (this.synced) throw new SyncedLocalCopyError(id);
    // Before deleting anything: the marker below cannot be written over an unreadable
    // sidecar, and the media must not go without it.
    await this.writableSidecar(id);
    const target = await this.filePath(id);
    if (!(await exists(target))) throw new Error(`No local media file for "${id}"`);
    // A legacy item may have no sidecar yet; once the media is gone, writeMeta could not create one.
    await this.ensureIdentity(id);
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
    destination: isExportDestinationId(meta.exportDestination) ? meta.exportDestination : null,
  };
}

export const LEGACY_STEM =
  /^(recording|screenshot)-(\d{4})-(\d{2})-(\d{2})[-T](\d{2})-(\d{2})-(\d{2})/;

/** The UTC instant a legacy writer stem encodes, or null for any other stem. */
function legacyStemDate(stem: string): number | null {
  const legacy = LEGACY_STEM.exec(stem);
  if (!legacy) return null;
  const [, , y, mo, d, h, mi, s] = legacy;
  return Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
}

/**
 * When an item was captured (N4): the sidecar's `createdAt`, then the date in a legacy
 * stem (UTC), then the file's birthtime, then its mtime (filesystems that report no
 * birthtime give 0). The one rule `renameItem` and reconcile both name defaults with.
 */
export function captureDate(
  meta: Pick<Sidecar, "createdAt">,
  stem: string,
  stats: { birthtimeMs: number; mtimeMs: number },
): number {
  if (typeof meta.createdAt === "number" && Number.isFinite(meta.createdAt)) return meta.createdAt;
  return legacyStemDate(stem) ?? (stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.mtimeMs);
}

/** The stem a title projects to, or the default capture name when nothing survives (N3). */
export function alignedBase(title: string, kind: CaptureKind, date: Date): string {
  return fileStemFromTitle(title) ?? defaultCaptureName(kind, date);
}

/** A collision tail the resolver may have added: ` (2)` … ` (99)`, or a 4-hex random tail. */
const COLLISION_TAIL = / \((?:[2-9]|[1-9]\d|[0-9a-f]{4})\)$/;

/**
 * Whether `stem` already follows `title` (N2): after NFC, it is the title's base, or the
 * base plus a collision tail. Never "what the resolver would pick now", which re-rolls
 * random tails; a case-only difference is not aligned (N8).
 */
export function isAligned(stem: string, title: string, kind: CaptureKind, date: Date): boolean {
  const base = alignedBase(title, kind, date).normalize("NFC");
  const name = stem.normalize("NFC");
  return name === base || (COLLISION_TAIL.test(name) && name.replace(COLLISION_TAIL, "") === base);
}

/**
 * The title an item without a sidecar title shows. New stems are already readable
 * (ADR 0035); a legacy writer stem (`recording-2026-10-29-13-51-00`,
 * `screenshot-2026-10-29T13-51-00-800Z`) reads as the new default name, so untitled
 * legacy items look like new ones. Legacy stems were UTC; the default name is local time.
 */
export function humanizeId(id: string): string {
  const utc = legacyStemDate(id);
  if (utc !== null) {
    const kind = id.startsWith("screenshot") ? "screenshot" : "recording";
    return defaultCaptureName(kind, new Date(utc));
  }
  return id.trim() || "Recording";
}

/**
 * An item id is a bare file stem: no path separators, no leading dot. Anything
 * else could address a file outside the vault when joined into a path.
 */
export function isPlainItemId(id: string): boolean {
  return id.length > 0 && !id.startsWith(".") && !/[\\/]/.test(id) && basename(id) === id;
}

/** What a file looked like when it was stamped; a rewrite in place changes size or mtime. */
interface FileStamp {
  size: number;
  mtimeMs: number;
  ino: number;
}

/** A companion about to be copied to its new name, with the source's stamp from before. */
interface CompanionCopy {
  from: string;
  to: string;
  stamp: FileStamp;
  /** sha256 the copy was verified against (set by `verifyCopies`): the proof before a delete. */
  digest?: string;
}

async function fileStamp(path: string): Promise<FileStamp> {
  const info = await stat(path);
  return { size: info.size, mtimeMs: info.mtimeMs, ino: info.ino };
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}

/**
 * Proves each copy equals its source: the source is unchanged since it was stamped (before the
 * copy and again after hashing it) and both hash the same. Throws EIO otherwise, so the rename
 * keeps the old name and the old files.
 *
 * Cost, on purpose: each companion is read three times in all (source and copy here, the source
 * again right before it is deleted in `removeUnchangedCompanions`), under the names lock. The
 * webcam track is as large as a take, so renaming an item that has one takes a while. Each read
 * is a proof before a delete; a stamp cannot stand in for any of them.
 */
async function verifyCopies(copies: CompanionCopy[]): Promise<void> {
  const mismatch = (path: string): Error =>
    Object.assign(new Error(`"${path}" changed or did not copy faithfully; both are kept`), {
      code: "EIO",
    });
  for (const copy of copies) {
    if (!sameStamp(copy.stamp, await fileStamp(copy.from))) throw mismatch(copy.from);
    const [source, copied] = await Promise.all([
      sha256FileBase64(copy.from),
      sha256FileBase64(copy.to),
    ]);
    if (source !== copied) throw mismatch(copy.from);
    copy.digest = source;
    if (!sameStamp(copy.stamp, await fileStamp(copy.from))) throw mismatch(copy.from);
  }
}

/** Removes `folder` and its subfolders that hold nothing; one with a file in it stays. */
async function removeEmptyFolders(folder: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyFolders(join(folder, entry.name));
  }
  // `rmdir` refuses a folder that still holds anything, which is what keeps a kept file safe.
  await rmdir(folder).catch(() => {});
}

/** Every file below `folder`, at any depth. */
async function filesUnder(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else found.push(path);
  }
  return found;
}
