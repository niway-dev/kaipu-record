import { basename, extname, join } from "node:path";
import { constants } from "node:fs";
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
  stat,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  AMBIGUOUS_IDENTITY_MARKER,
  ITEM_NOT_FOUND_MARKER,
  UNREADABLE_RECORD_MARKER,
  type LocalRecording,
  type RenameResult,
} from "@shared/types/library-storage";
import { sanitizeRecordingCapture, type RecordingCapture } from "@shared/recording-capture";
import { normalizeExportPresetId, type StoredExportPresetId } from "@shared/types/export-preset";
import { defaultCaptureName, type CaptureKind } from "@shared/default-capture-name";
import { atomicWriteFile, withLock } from "./atomic-write";
import { sha256FileBase64 } from "./content-hash";
import { fileStemFromTitle, fsFold, isReservedStem } from "./file-stem";
import { mediaUrl } from "@shared/media-url";

export const META_DIR = ".kaipu";
/** Known video containers, in preference order — `.mp4` is what we now write. */
const VIDEO_EXTS = [".mp4", ".webm"] as const;
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

/**
 * Module-level `withLock` key that serializes every operation choosing or changing an
 * item's stem (ADR 0032): `allocateId` and `renameItem`, across every `LibraryVault`
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

/**
 * A write to an item whose sidecar is unreadable, corrupt or invalid. Merging over it would
 * replace the item's title, identity and tags with whatever the caller had, so every
 * mutation refuses before touching the record, the media or any companion.
 */
export class UnreadableRecordError extends Error {
  constructor(
    readonly id: string,
    readonly status: SidecarReadStatus,
  ) {
    super(`${UNREADABLE_RECORD_MARKER}: the record of "${id}" is ${status}; nothing was written`);
    this.name = "UnreadableRecordError";
  }
}

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
export async function readSidecarStrict(path: string): Promise<SidecarRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
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
   * (ADR 0032): the file then keeps its name ("editing").
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
  assetsDir: string;
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
 * it (ADR 0032): the id is valid until the next rename, `assetId` is the identity.
 * Pure: no Electron — the directory is injected so it's testable against a temp folder.
 */
export class LibraryVault {
  constructor(readonly directory: string) {}

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
      assetsDir: join(meta, `${id}.assets`),
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
   * would merge two identities.
   */
  async isStemFree(stem: string): Promise<boolean> {
    // A reserved stem's companions are another stem's (or the vault's own) files.
    if (isReservedStem(stem)) return false;
    const { cursorTrackTemp: _temp, ...companions } = this.companionPaths(stem);
    const paths = [
      ...ALL_EXTS.map((ext) => join(this.directory, `${stem}${ext}`)),
      ...Object.values(companions),
    ];
    // Strict: a path that cannot be checked is not free (the caller would write onto it).
    const found = await Promise.all(paths.map(existsStrict));
    return !found.includes(true);
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

  /**
   * Reserve a stem for a new item: derive it from `title` (or sanitize `stem`), resolve
   * collisions with ` (2)`, ` (3)` …, and write a stub sidecar — all under NAMES_LOCK.
   * From this moment the stem is taken; the caller writes the media next and calls
   * `remove(id)` if that fails.
   */
  async allocateId(input: AllocateInput): Promise<string> {
    const fallback = defaultCaptureName(input.kind, new Date(input.createdAt));
    const stem = fileStemFromTitle(input.stem ?? input.title) ?? fallback;
    return withLock(NAMES_LOCK, async () => {
      const { id } = await this.firstCandidate(stem, async (candidate) =>
        (await this.isStemFree(candidate)) ? { id: candidate, mode: "free" } : null,
      );
      await mkdir(this.metaDirectory(), { recursive: true });
      const stub: Sidecar = {
        sidecarVersion: 2,
        assetId: randomUUID(),
        createdAt: input.createdAt,
        title: input.title,
      };
      await atomicWriteFile(this.sidecarPath(id), JSON.stringify(stub, null, 2));
      return id;
    });
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
   */
  async adoptMedia(id: string, fields: { title: string; createdAt: number }): Promise<boolean> {
    const path = this.sidecarPath(id);
    return withLock(path, async () => {
      if ((await readSidecarStrict(path)).status !== "missing") return false;
      if (!(await this.hasMedia(id))) return false;
      await mkdir(this.metaDirectory(), { recursive: true });
      const record: Sidecar = { sidecarVersion: 2, assetId: randomUUID(), ...fields };
      await atomicWriteFile(path, JSON.stringify(record, null, 2));
      return true;
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
   * title derives (ADR 0032). Holds NAMES_LOCK and the old sidecar's lock throughout.
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
        await atomicWriteFile(oldSidecar, JSON.stringify(meta, null, 2));
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
        const from = this.companionPaths(id);
        const to = this.companionPaths(newId);
        const retry = options.retry ?? DEFAULT_RENAME_RETRY;

        if (target.mode === "case") {
          const reason = await this.moveInPlace(from, to, oldMedia, newMedia, retry, id);
          if (reason) return { recording: await describeOld(), file: "kept-old-name", reason };
        } else {
          // 4. Companions to the new stem. A leftover of this item is cleared first.
          if (target.mode === "leftover") await this.removeCompanions(to);
          const created: string[] = [];
          try {
            await atomicWriteFile(to.sidecar, JSON.stringify(meta, null, 2));
            created.push(to.sidecar);
            for (const key of ["thumbnail", "cursorTrack", "editSession", "editMeta"] as const) {
              // Strict: a companion that cannot be checked is not skipped, since the
              // old companions are deleted after the commit.
              if (!(await existsStrict(from[key]))) continue;
              await copyFile(from[key], to[key], constants.COPYFILE_EXCL);
              created.push(to[key]);
            }
            if (await existsStrict(from.assetsDir)) {
              created.push(to.assetsDir);
              await cp(from.assetsDir, to.assetsDir, {
                recursive: true,
                force: false,
                errorOnExist: true,
              });
            }
          } catch {
            await this.removePaths(created);
            return { recording: await describeOld(), file: "kept-old-name", reason: "io" };
          }

          // 5. The commit point.
          const failure = await this.renameWithRetry(oldMedia, newMedia, retry);
          if (failure) {
            await this.removePaths(created);
            if (failure === "gone") throw new ItemNotFoundError(id);
            return { recording: await describeOld(), file: "kept-old-name", reason: failure };
          }

          // 6. Old companions last, best effort: a leftover is invisible to `list()`.
          await this.removeCompanions(from);
        }

        readOnlyIdentityMemo.delete(oldSidecar);
        const recording = await this.describe(newId);
        if (!recording) throw new ItemNotFoundError(newId);
        return { recording, file: "renamed" };
      });
    });
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
    if (media !== null && (await this.sidecar(id!)).assetId === assetId) {
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
   * `fs.rename` of the media, retried while the file is locked. Resolves null on success,
   * else why it failed: "locked" (still held after every retry), "gone" (ENOENT), "io".
   */
  private async renameWithRetry(
    from: string,
    to: string,
    retry: RetryPolicy,
  ): Promise<"locked" | "gone" | "io" | null> {
    const sleep = retry.sleep ?? sleepFor;
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(from, to);
        return null;
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
  ): Promise<"locked" | "io" | null> {
    const moved: (keyof CompanionPaths)[] = [];
    const undo = async (): Promise<void> => {
      for (const key of moved.reverse()) await rename(to[key], from[key]).catch(() => {});
    };
    const keys = ["sidecar", "thumbnail", "cursorTrack", "editSession", "editMeta", "assetsDir"];
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
    const failure = await this.renameWithRetry(oldMedia, newMedia, retry);
    if (failure) {
      await undo();
      if (failure === "gone") throw new ItemNotFoundError(id);
      return failure;
    }
    await rm(from.cursorTrackTemp, { force: true }).catch(() => {});
    return null;
  }

  private async removePaths(paths: string[]): Promise<void> {
    await Promise.allSettled(paths.map((path) => rm(path, { recursive: true, force: true })));
  }

  private async removeCompanions(paths: CompanionPaths): Promise<void> {
    await this.removePaths(Object.values(paths));
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
    const isGif = GIF_EXTS.some((ext) => filePath.endsWith(ext));
    let meta: Sidecar & { assetId: string };
    try {
      meta = await this.ensureIdentity(id);
    } catch (error) {
      // The file moved (a rename) between the stat above and the sidecar read.
      if (error instanceof ItemGoneError) return null;
      // Listed read-only: one bad record never fails the whole list, and is never healed.
      if (error instanceof UnreadableRecordError) {
        return this.describeUnreadable(
          id,
          filePath,
          info,
          isImage ? "screenshot" : isGif ? "gif" : "recording",
        );
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
          mediaUrl("screenshot", id, Math.round(info.mtimeMs))
        : (await exists(this.thumbnailPath(id)))
          ? mediaUrl("thumb", id)
          : null,
    };
  }

  /** A read-only listing of an item whose record cannot be read (F9). */
  private describeUnreadable(
    id: string,
    filePath: string,
    info: { size: number; birthtimeMs: number; mtimeMs: number },
    kind: LocalRecording["kind"],
  ): LocalRecording {
    return {
      id,
      // Never persisted: no write accepts this item, so the placeholder cannot leak.
      assetId: `unreadable:${id}`,
      kind,
      title: humanizeId(id),
      filePath,
      createdAt: captureDate({}, id, info),
      sizeBytes: info.size,
      durationSeconds: 0,
      derivedFromAssetId: null,
      contentSha256: null,
      tagIds: [],
      readable: false,
      thumbnailUrl:
        kind === "screenshot" ? mediaUrl("screenshot", id, Math.round(info.mtimeMs)) : null,
    };
  }

  /**
   * The sidecar a mutation may merge over: `{}` when there is none yet, else the strictly
   * read record. Throws `UnreadableRecordError` for anything else (F9).
   */
  private async writableSidecar(id: string): Promise<Sidecar> {
    const read = await readSidecarStrict(this.sidecarPath(id));
    if (read.status === "ok") return read.sidecar;
    if (read.status === "missing") return {};
    throw new UnreadableRecordError(id, read.status);
  }

  /**
   * For writers outside this class (edit-session saves): refuse before touching any file
   * when the item's record is unreadable.
   */
  async assertWritableRecord(id: string): Promise<void> {
    await this.writableSidecar(id);
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
      const current = await this.writableSidecar(id);
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
   * field, and a crash mid-write never leaves a truncated sidecar, which would read
   * back as `{}` and lose the item's title, identity and tags.
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
    const read = await readSidecarStrict(this.sidecarPath(id));
    if (read.status === "missing" && !(await this.hasMedia(id))) throw new ItemGoneError(id);
    if (read.status !== "ok" && read.status !== "missing") {
      throw new UnreadableRecordError(id, read.status);
    }
    const current = read.status === "ok" ? read.sidecar : {};
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
      // Strict: "no media" lets a rename take the stem as a leftover and clear it.
      if (await existsStrict(join(this.directory, `${id}${ext}`))) return true;
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
    const meta = await this.writableSidecar(id);
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
        await this.writeImage(resolved, png);
        await this.writeMetaLocked(resolved, meta);
      });
      return resolved;
    });
  }

  /** Writes a screenshot PNG as `<id>.png` in the vault root. */
  async writeImage(id: string, png: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    // `.part` is not a known extension, so `list()` never shows a half-written shot,
    // and a failed write leaves the previous PNG untouched.
    await atomicWriteFile(join(this.directory, `${id}.png`), png, "part");
  }

  /** Stamp "opened in an editor now" — what the Editor home's Continue list orders by. */
  async markOpenedInEditor(id: string, at = Date.now()): Promise<void> {
    await this.writeMeta(id, { editorOpenedAt: at });
  }

  /**
   * Removes the media file plus every companion (`companionPaths`). The companions are
   * best-effort (they may not exist), but a failure to delete the media itself
   * propagates so the UI can report it.
   */
  async remove(id: string): Promise<void> {
    // Under the sidecar lock so a racing writeMeta cannot recreate the sidecar just after it is deleted.
    await withLock(this.sidecarPath(id), () => this.removeCompanions(this.companionPaths(id)));
    await rm(await this.filePath(id), { force: true });
  }

  /**
   * Free disk space while keeping the item: deletes ONLY the media file. The
   * sidecar (identity, provenance, hash), thumbnail, edit session and assets stay,
   * so the item survives as a cloud-only entry and can be downloaded back under
   * the same assetId. Not `remove()`: that one is the destructive delete.
   */
  async removeLocalCopy(id: string): Promise<void> {
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
 * (ADR 0032); a legacy writer stem (`recording-2026-10-29-13-51-00`,
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
