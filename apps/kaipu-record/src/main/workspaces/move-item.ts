import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  statfs,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { nextTagColor, type TagColor } from "@kaipu/domain/constants";
import type { MoveKeptOriginal, MoveRefusal } from "@shared/types/workspaces";
import { atomicWriteFile } from "../library/atomic-write";
import { sha256FileBase64 } from "../library/content-hash";
import { stampFields, stampMatches, type StatLike } from "../library/hash-stamp";
import type { DragLedger } from "../library/drag-ledger";
import { withItemLock } from "../library/item-lock";
import {
  isPlainItemId,
  LibraryVault,
  META_DIR,
  type CompanionPaths,
  type Sidecar,
} from "../library/library-vault";
import { probeDataless } from "../library/dataless";
import {
  copyExclusive,
  placeByRename,
  placeNew,
  placeNoReplace,
  removeIfSame,
  sameFile,
  type FileIdentity,
} from "../library/safe-place";
import { TagRegistryError, VaultTagRepository } from "../library/tag-repository";
import type { SessionMeta } from "../library/video-edit-session";

/**
 * The workspace mover (ADR 0033): one finished item, with every file it owns, from the
 * active workspace to another, keeping its identity, and never leaving zero copies.
 *
 * Order, with the media as the commit point:
 *   1. item lock; re-check the item inside it; refusals (nothing is touched yet)
 *   2. journal entry in userData, phase `copying`
 *   3. the target's tags (registry first), then the target sidecar reserves the stem
 *   4. the small files (and the webcam track), copied or linked
 *   5. the media: a hard link on the same volume; otherwise a copy into the target's
 *      `.kaipu/tmp/move-<moveId>/`, its sha256 compared, then placed. **The commit.**
 *      A synced side (Google Drive, OneDrive, iCloud: `MoveSide.scratch`) is never linked,
 *      even on one device (decision 15): a hard link renames the cloud item or leaves it
 *      unsynced. A synced TARGET copies into the scratch folder in userData, places by rename
 *      and verifies the sha256 again at the final path. A synced source with a plain target
 *      copies into the target's `.kaipu/tmp/move-<id>/` and places with `placeNew`. Either
 *      way the copy is never a link and its sha256 is checked again where it ends up.
 *   6. journal `committed`, then the source media, then the source's small files
 *   7. the journal entry goes
 *
 * The journal is only a hint: `healMoves` decides from what is on both disks.
 */

/** Where the mover may stop in a test (`hooks.after`), in order. */
export type MoveStep =
  | "journal-written"
  | "target-reserved"
  | "companions-copied"
  | "media-copied"
  | "media-verified"
  | "media-placed"
  | "committed"
  | "source-media-deleted"
  | "source-companions-deleted";

export const MOVE_STEPS: readonly MoveStep[] = [
  "journal-written",
  "target-reserved",
  "companions-copied",
  "media-copied",
  "media-verified",
  "media-placed",
  "committed",
  "source-media-deleted",
  "source-companions-deleted",
];

/** Thrown by a test hook to stop the mover where a crash would: no cleanup runs after it. */
export class SimulatedCrash extends Error {
  constructor(readonly step: MoveStep) {
    super(`simulated crash after ${step}`);
    this.name = "SimulatedCrash";
  }
}

export interface MoveSide {
  workspaceId: string;
  directory: string;
  /**
   * Set for a synced workspace: its scratch folder in userData
   * (`workspace-scratch/<workspaceId>`), where the move stages instead of `.kaipu/tmp/`. Its
   * presence is what marks the side as synced, so the journal carries it to healing.
   */
  scratch?: string;
}

export interface MoveRequest {
  source: MoveSide;
  target: MoveSide;
  id: string;
  /** The identity the caller saw; another item now under `id` is refused (`not-found`). */
  expectedAssetId?: string;
}

export type MoveOutcome =
  | {
      ok: true;
      id: string;
      newId: string;
      mode: "linked" | "copied";
      /** The copy arrived but the original, or part of it, stayed: the item is now in both workspaces. */
      keptOriginal?: MoveKeptOriginal;
    }
  | { ok: false; id: string; reason: MoveRefusal };

/** File operations the mover goes through; a test injects EXDEV or a wrong checksum here. */
export interface MoverFs {
  link(existing: string, target: string): Promise<void>;
  sha256(path: string): Promise<string>;
  /** Free bytes on the volume that holds `directory`. */
  freeBytes(directory: string): Promise<number>;
  /**
   * Which of these files a provider has offloaded (`SF_DATALESS`). Asked only when the source
   * is synced, before any byte of it is read: reading an evicted file downloads it.
   */
  evicted(paths: string[]): Promise<ReadonlySet<string>>;
}

export interface MoverDeps {
  /** `userData/workspace-moves`. */
  journalDir: string;
  deviceId(): string;
  dragLedger?: DragLedger;
  fs?: Partial<MoverFs>;
  hooks?: { after?(step: MoveStep): void | Promise<void> };
  now?(): number;
}

/** Room a copy leaves free on the target volume, on top of the media itself. */
export const MOVE_SPACE_MARGIN_BYTES = 256 * 1024 * 1024;

const defaultFs: MoverFs = {
  evicted: probeDataless,
  link,
  sha256: sha256FileBase64,
  freeBytes: async (directory) => {
    // A scratch folder is created by its first staged copy: ask the nearest folder that exists.
    let at = directory;
    for (;;) {
      try {
        const info = await statfs(at);
        return Number(info.bavail) * Number(info.bsize);
      } catch (error) {
        const parent = dirname(at);
        if (codeOf(error) !== "ENOENT" || parent === at) throw error;
        at = parent;
      }
    }
  },
};

/** The item's files besides the media and the sidecar, in the order they are copied. */
const COMPANION_FILES = [
  "thumbnail",
  "cursorTrack",
  "editSession",
  "editMeta",
  "canvasDoc",
  "textCache",
  "transcript",
  "webcam",
] as const;

export interface MoveJournal {
  version: 1;
  moveId: string;
  phase: "copying" | "committed";
  source: MoveSide;
  target: MoveSide;
  sourceId: string;
  /** Null until the target stem is reserved (a crash before that left at most a sidecar). */
  targetId: string | null;
  assetId: string;
  /** The media's extension, with its dot. */
  ext: string;
  media: { size: number; mtimeMs: number; sha256: string | null };
  /**
   * The source media as the move read it, before the first byte was copied (dev, inode, size and
   * mtime to the nanosecond). Healing deletes the source only against THIS stamp, never against a
   * fresh snapshot: a file swapped in between a crash and the recovery is not the copy. A journal
   * without it (written before this field existed) never deletes anything.
   */
  sourceStamp?: StampRecord;
  /**
   * Every small file the source item owned at the same moment, with paths relative to
   * `source.directory`. Healing compares each companion against these stamps: one that changed,
   * or one that was added, is kept. Absent: the source's small files are never deleted.
   */
  companions?: CompanionRecord;
  createdAt: number;
  /** Set by healing when neither side can be proven complete: kept and surfaced, never deleted. */
  quarantined?: string;
}

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

async function existsStrict(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

async function statOrNull(path: string): Promise<StatLike | null> {
  try {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, ino: info.ino };
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  }
}

// ── What the move compares before it deletes ──────────────────────────────────────

/**
 * What a file looked like when the move read it: which file it is (device + inode, bigints so a
 * Windows file id does not lose digits), its size and its mtime to the nanosecond. A provider that
 * replaces a file with another of the same size and mtime still changes the inode, so identity is
 * compared first and never overruled by an equal size and mtime.
 */
interface FileStamp {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
}

/** The stamp of `path` (a link is its own file, never followed), or null when nothing is there. */
async function stampAt(path: string): Promise<FileStamp | null> {
  try {
    const info = await lstat(path, { bigint: true });
    return { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs };
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

function sameStamp(a: FileStamp | null, b: FileStamp | null): boolean {
  if (a === null || b === null) return a === b;
  return sameFile(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs;
}

/** A `FileStamp` as the journal stores it: bigints do not survive JSON, so they are strings. */
interface StampRecord {
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
}

/** The persisted form of a `CompanionSnapshot`, relative to the source folder. */
interface CompanionRecord {
  files: [string, StampRecord | null][];
  dirs: string[];
  sidecar: string;
}

function stampToRecord(stamp: FileStamp): StampRecord {
  return {
    dev: stamp.dev.toString(),
    ino: stamp.ino.toString(),
    size: stamp.size.toString(),
    mtimeNs: stamp.mtimeNs.toString(),
  };
}

/** The stamp a record holds, or undefined when it is not a well-formed one (never guessed). */
function stampFromRecord(record: unknown): FileStamp | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  const { dev, ino, size, mtimeNs } = record as Record<string, unknown>;
  try {
    if (
      typeof dev !== "string" ||
      typeof ino !== "string" ||
      typeof size !== "string" ||
      typeof mtimeNs !== "string"
    ) {
      return undefined;
    }
    return { dev: BigInt(dev), ino: BigInt(ino), size: BigInt(size), mtimeNs: BigInt(mtimeNs) };
  } catch {
    return undefined;
  }
}

function snapshotToRecord(snapshot: CompanionSnapshot, directory: string): CompanionRecord {
  return {
    files: [...snapshot.files].map(([path, stamp]) => [
      relative(directory, path),
      stamp === null ? null : stampToRecord(stamp),
    ]),
    dirs: snapshot.dirs.map((dir) => relative(directory, dir)),
    sidecar: relative(directory, snapshot.sidecar),
  };
}

/**
 * The snapshot a journal persisted, rebased on the folder the workspace lives in now; undefined
 * when the journal has none or it is malformed, and a path that climbs out of the folder is
 * refused whole (a journal is a file on disk: nothing it says may point a delete elsewhere).
 */
function snapshotFromRecord(
  record: CompanionRecord | undefined,
  directory: string,
): CompanionSnapshot | undefined {
  if (!record || !Array.isArray(record.files) || !Array.isArray(record.dirs)) return undefined;
  const inside = (rel: unknown): string | undefined => {
    if (typeof rel !== "string" || rel === "" || isAbsolute(rel)) return undefined;
    const path = join(directory, rel);
    const back = relative(directory, path);
    return back === "" || back.startsWith("..") || isAbsolute(back) ? undefined : path;
  };
  const files = new Map<string, FileStamp | null>();
  for (const entry of record.files) {
    if (!Array.isArray(entry)) return undefined;
    const path = inside(entry[0]);
    if (path === undefined) return undefined;
    if (entry[1] === null) files.set(path, null);
    else {
      const stamp = stampFromRecord(entry[1]);
      if (stamp === undefined) return undefined;
      files.set(path, stamp);
    }
  }
  const dirs: string[] = [];
  for (const dir of record.dirs) {
    const path = inside(dir);
    if (path === undefined) return undefined;
    dirs.push(path);
  }
  const sidecar = inside(record.sidecar);
  if (sidecar === undefined) return undefined;
  return { files, dirs, sidecar };
}

/** Every file the source's item owns, as the move found it before it copied a byte. */
interface CompanionSnapshot {
  /** Each companion path (and each file under the assets folder); null where nothing was there. */
  files: Map<string, FileStamp | null>;
  /** The assets folder and its sub-folders, deepest first: removed only while empty. */
  dirs: string[];
  /** The record: removed last, so a move that stops halfway leaves the item's identity in place. */
  sidecar: string;
}

async function snapshotCompanions(paths: CompanionPaths): Promise<CompanionSnapshot> {
  const files = new Map<string, FileStamp | null>();
  const dirs: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }
    dirs.unshift(dir);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.set(path, await stampAt(path));
    }
  };
  for (const [key, path] of Object.entries(paths)) {
    if (key === "assetsDir") await walk(path);
    else files.set(path, await stampAt(path));
  }
  // Deepest first: a folder is only ever removed after the ones inside it.
  dirs.sort((a, b) => b.length - a.length);
  return { files, dirs, sidecar: paths.sidecar };
}

/** The target media the source may be deleted against: the copy the move placed and verified. */
interface Destination {
  path: string;
  stamp: FileStamp;
}

/**
 * The destination as it is now, when it is the file `expected` names; null when nothing is there,
 * another file is, or it cannot be read. Never throws: a caller that has just created a link must
 * reach its own bookkeeping whatever the file system says (null keeps the source later).
 */
async function destinationOf(path: string, expected: FileIdentity): Promise<Destination | null> {
  try {
    const stamp = await stampAt(path);
    if (stamp === null || !sameFile(stamp, expected)) return null;
    return { path, stamp };
  } catch {
    return null;
  }
}

/** The destination as it is now, whichever file that is; null when nothing is there or it cannot be read. */
async function destinationAt(path: string): Promise<Destination | null> {
  try {
    const stamp = await stampAt(path);
    return stamp === null ? null : { path, stamp };
  } catch {
    return null;
  }
}

function sameDestination(a: Destination | null, b: Destination | null): boolean {
  return a !== null && b !== null && sameStamp(a.stamp, b.stamp);
}

/**
 * Remove `path` only while it is still the file `expected` describes (null: nothing was there,
 * so anything now present is new) and the destination is still the verified copy. Both are read
 * in one step and the `rm` follows with no other await in between: the checks cannot go stale
 * behind a freshness write, a journal write or a read of another file.
 *
 * Irreducible window: Node has no compare-and-delete, so a provider that swaps `path` in the
 * instant between the stat and the unlink is not seen (the same residual window as `removeSource`
 * in `safe-place.ts`). Everything before that instant keeps the file. A stat that fails keeps it.
 */
async function removeGuarded(
  path: string,
  expected: FileStamp | null,
  destination: Destination,
): Promise<"removed" | "kept"> {
  let now: FileStamp | null;
  let there: FileStamp | null;
  try {
    [now, there] = await Promise.all([stampAt(path), stampAt(destination.path)]);
  } catch (error) {
    console.error(`move: could not check "${path}" before removing it; kept`, error);
    return "kept";
  }
  if (!sameStamp(there, destination.stamp)) return "kept";
  if (now === null) return "removed"; // already gone: nothing is left to protect
  if (!sameStamp(now, expected)) return "kept";
  await rm(path, { force: true });
  return "removed";
}

/**
 * The first file that is not what the snapshot saw (changed, replaced, added or removed since,
 * or unreadable now), as a short name, or null when every one is the same. It decides before
 * anything is deleted, so one changed file keeps the whole source.
 */
async function snapshotChangedFile(
  snapshot: CompanionSnapshot,
  paths: CompanionPaths,
): Promise<string | null> {
  let now: CompanionSnapshot;
  try {
    now = await snapshotCompanions(paths);
  } catch {
    return "files";
  }
  for (const [path, expected] of snapshot.files) {
    if (!now.files.has(path) || !sameStamp(now.files.get(path)!, expected)) {
      return `file ${basename(path)}`;
    }
  }
  for (const path of now.files.keys()) {
    if (!snapshot.files.has(path)) return `file ${basename(path)}`;
  }
  return null;
}

/**
 * Remove the source's small files, each one only while it is still what the snapshot saw and the
 * destination is still the verified copy (`removeGuarded`). Stops at the FIRST file that changed
 * or that could not be removed and says why; the record goes last, so a source that stopped
 * halfway keeps its identity, and the caller keeps the journal. Resolves null when everything
 * went: an error is never swallowed into a success.
 */
async function removeCompanionsGuarded(
  snapshot: CompanionSnapshot,
  destination: Destination,
): Promise<string | null> {
  const ordered = [...snapshot.files.entries()].sort(
    ([a], [b]) => Number(a === snapshot.sidecar) - Number(b === snapshot.sidecar),
  );
  for (const [path, expected] of ordered) {
    try {
      if ((await removeGuarded(path, expected, destination)) === "kept") {
        return `source file ${basename(path)} changed after the move committed`;
      }
    } catch (error) {
      console.error(`move: could not remove "${path}"`, error);
      return `source file ${basename(path)} could not be removed after the move committed`;
    }
  }
  for (const dir of snapshot.dirs) {
    try {
      await rmdir(dir);
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOTEMPTY" || code === "EEXIST") {
        return `source folder ${basename(dir)} changed after the move committed`;
      }
      if (code !== "ENOENT") {
        console.error(`move: could not remove "${dir}"`, error);
        return `source folder ${basename(dir)} could not be removed after the move committed`;
      }
    }
  }
  return null;
}

/**
 * The first file of the source that is not what the JOURNAL recorded before the copy (changed,
 * replaced or added since), as a short name, or null. A file that is gone now is not a change: an
 * interrupted move may have removed it, and removing less is never a risk. Unreadable counts as
 * changed.
 */
async function changedSinceJournal(
  recorded: CompanionSnapshot,
  paths: CompanionPaths,
): Promise<string | null> {
  let now: CompanionSnapshot;
  try {
    now = await snapshotCompanions(paths);
  } catch {
    return "files";
  }
  for (const [path, stamp] of now.files) {
    if (stamp === null) continue;
    const before = recorded.files.get(path);
    if (before === undefined || before === null || !sameStamp(stamp, before)) {
      return `file ${basename(path)}`;
    }
  }
  return null;
}

function journalPath(dir: string, moveId: string): string {
  return join(dir, `${moveId}.json`);
}

async function writeJournal(dir: string, journal: MoveJournal): Promise<void> {
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(journalPath(dir, journal.moveId), JSON.stringify(journal, null, 2));
}

function stagingDir(targetDir: string, moveId: string, scratch?: string): string {
  return scratch
    ? join(scratch, "tmp", `move-${moveId}`)
    : join(targetDir, META_DIR, "tmp", `move-${moveId}`);
}

/**
 * A vault on one side of a move, built the way the library builds the active workspace's vault:
 * a synced side (`scratch` set) gets the eviction probe and its staging folder, so its sidecar
 * reads are bounded, its writes stage outside the folder and `describe` never hands out an
 * offloaded file. Without it `synced` is false and `describe`, `list` and the strict sidecar read
 * would read the folder's files whole, evicted or not, before the move's own eviction check.
 */
function vaultOf(side: MoveSide, directory: string, fs: MoverFs): LibraryVault {
  if (side.scratch === undefined) return new LibraryVault(directory, side.workspaceId);
  return new LibraryVault(
    directory,
    side.workspaceId,
    undefined,
    (paths) => fs.evicted(paths),
    join(side.scratch, "tmp"),
  );
}

/** `link` errors that mean "no hard link here": the file is copied instead. */
const NO_HARD_LINK = new Set(["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK"]);

/**
 * Move one item. Resolves a refusal (nothing changed in either workspace) or the new id.
 * Never throws for an expected failure; an unexpected one rolls back what this move made in
 * the target before it rethrows, while the source is untouched.
 */
export async function moveItem(request: MoveRequest, deps: MoverDeps): Promise<MoveOutcome> {
  const { source, target, id } = request;
  const refuse = (reason: MoveRefusal): MoveOutcome => ({ ok: false, id, reason });
  // The id comes from the renderer and is joined into paths on both sides (and `rm` follows).
  if (!isPlainItemId(id)) return refuse("not-found");
  if (source.workspaceId === target.workspaceId) return refuse("same-workspace");
  return withItemLock(source.workspaceId, id, async () => {
    try {
      return await moveLocked(request, deps);
    } catch (error) {
      if (error instanceof SimulatedCrash) throw error;
      console.error(`move of "${id}" failed`, error);
      return refuse("io");
    }
  });
}

async function moveLocked(request: MoveRequest, deps: MoverDeps): Promise<MoveOutcome> {
  const { source, target, id } = request;
  const fs: MoverFs = { ...defaultFs, ...deps.fs };
  const now = deps.now ?? Date.now;
  const after = async (step: MoveStep): Promise<void> => {
    await deps.hooks?.after?.(step);
  };
  const refuse = (reason: MoveRefusal): MoveOutcome => ({ ok: false, id, reason });
  const from = vaultOf(source, source.directory, fs);
  const to = vaultOf(target, target.directory, fs);

  // ── 1. Preconditions, inside the item lock: nothing is written before they all pass.
  let targetInfo;
  try {
    targetInfo = await stat(target.directory);
    await access(target.directory, constants.W_OK);
  } catch {
    return refuse("target-unavailable");
  }
  if (!targetInfo.isDirectory()) return refuse("target-unavailable");

  const item = await from.describe(id);
  if (!item) return refuse("not-found");
  if (request.expectedAssetId && item.assetId !== request.expectedAssetId) {
    return refuse("not-found");
  }
  if (item.metadataIssue) return refuse("metadata-issue");
  const read = await from.readRecordStrict(from.sidecarPath(id));
  if (read.status !== "ok" || !read.sidecar.assetId) return refuse("metadata-issue");
  const record = read.sidecar;
  const assetId = record.assetId!;
  if (deps.dragLedger?.draggedJustNow(source.workspaceId, id)) return refuse("dragged-just-now");

  let targetItems;
  try {
    targetItems = await to.list();
  } catch {
    return refuse("target-unavailable");
  }
  if (targetItems.some((other) => other.assetId === assetId)) return refuse("already-there");

  const media = item.filePath;
  const ext = extname(media);
  // The renderer refuses an evicted item too, but its list may be older than the eviction: main
  // checks again before the hash or the copy reads the file (decision 15).
  if (source.scratch !== undefined) {
    // Every file the move reads: the media and each companion that exists (a missing path is
    // never evicted), and what is inside the assets folder. Copying any of them downloads it.
    const companions = from.companionPaths(id);
    const reads = [media, ...COMPANION_FILES.map((key) => companions[key])];
    try {
      // Every file at any depth: `transferTree` copies each of them, so each must be local.
      reads.push(...(await filesBelow(companions.assetsDir)));
    } catch (error) {
      // Unreadable (EACCES, EIO, ENOTDIR): never copy blind. It is an I/O refusal, not an
      // eviction: "download it in Finder" would send the user to wait for nothing.
      if (codeOf(error) !== "ENOENT") return refuse("io");
    }
    const offloaded = await fs.evicted(reads);
    if (offloaded.size > 0) return refuse("evicted");
  }
  const mediaInfo = await stat(media);
  const mediaStamp = await stampAt(media);
  if (mediaStamp === null) return refuse("not-found");
  const sameDevice = (await stat(source.directory)).dev === targetInfo.dev;
  // A synced side always copies: never a second name for a file a provider syncs.
  const synced = source.scratch !== undefined || target.scratch !== undefined;
  const linkable = sameDevice && !synced;
  const webcamInfo = await statOrNull(from.webcamFilePath(id));
  const spaceNeeded = mediaInfo.size + (webcamInfo?.size ?? 0) + MOVE_SPACE_MARGIN_BYTES;
  if (!linkable && (await fs.freeBytes(target.directory)) < spaceNeeded) return refuse("no-room");
  // A synced target stages its copy in userData first, then renames it into the folder (a second
  // copy when the volumes differ): the staging volume needs room as well, or the move would fail
  // partway through as `io`.
  if (target.scratch !== undefined && (await fs.freeBytes(target.scratch)) < spaceNeeded) {
    return refuse("no-room");
  }

  // Tags: resolved by name in the target's registry. One that cannot be trusted refuses the
  // move before anything is copied (decision 7).
  const targetTags = new VaultTagRepository(() => to, deps.deviceId, now);
  let wanted: { name: string; color: TagColor }[];
  try {
    wanted = await sourceTags(from, record, deps, now);
    await targetTags.liveTags();
  } catch (error) {
    if (error instanceof TagRegistryError) return refuse("tags-unreadable");
    throw error;
  }

  // The drag folders of this item go before the move starts (decision 11).
  await deps.dragLedger?.clear(source.workspaceId, id);

  // What the source's small files are now, before the first byte is copied: the delete step
  // compares against it, so a change during the copy is a change too.
  const companionSnapshot = await snapshotCompanions(from.companionPaths(id));

  // The media's identity, for healing. A copy always hashes; a link keeps size and mtime.
  const cached =
    record.contentSha256 && stampMatches(record, mediaInfo) ? record.contentSha256 : null;
  const sha256 = linkable ? cached : (cached ?? (await fs.sha256(media)));

  // ── 2. The journal.
  const journal: MoveJournal = {
    version: 1,
    moveId: randomUUID(),
    phase: "copying",
    source,
    target,
    sourceId: id,
    targetId: null,
    assetId,
    ext,
    media: { size: mediaInfo.size, mtimeMs: mediaInfo.mtimeMs, sha256 },
    // What the source was before the first byte was copied: healing deletes against this.
    sourceStamp: stampToRecord(mediaStamp),
    companions: snapshotToRecord(companionSnapshot, source.directory),
    createdAt: now(),
  };
  await writeJournal(deps.journalDir, journal);
  await after("journal-written");

  const finalMedia = (newId: string): string => join(target.directory, `${newId}${ext}`);
  let mediaPlaced = false;
  // The file this move put at its final name in the target: the one a rollback may remove,
  // and only while that name still holds this very file (`removeIfSame`).
  let placedAt: { path: string; identity: FileIdentity } | null = null;
  let committedMode: "linked" | "copied" = "copied";
  try {
    // ── 3. Tags, then the target record: the stem is taken from here on.
    const tags = await targetTags.ensureByName(wanted);
    const incoming: Sidecar = {
      ...record,
      ...(tags.length > 0 || record.tagIds
        ? { tagIds: tags.map((t) => t.id), tagNames: tags.map((t) => t.name) }
        : {}),
    };
    delete incoming.localRemovedAt;
    const newId = await to.reserveIncoming(id, incoming);
    journal.targetId = newId;
    await writeJournal(deps.journalDir, journal);
    await after("target-reserved");

    // ── 4. The small files and the webcam track. Into a synced target each one is copied to the
    // scratch folder first and renamed in (the webcam track can be hundreds of MB: a provider
    // would otherwise upload it as it grows, under its final name).
    const staging = stagingDir(target.directory, journal.moveId, target.scratch);
    const stageCompanions = target.scratch !== undefined ? join(staging, "companions") : null;
    const fromPaths = from.companionPaths(id);
    const toPaths = to.companionPaths(newId);
    for (const key of COMPANION_FILES) {
      if (!(await existsStrict(fromPaths[key]))) continue;
      await transfer(fromPaths[key], toPaths[key], {
        sameDevice: linkable,
        fs,
        stage: stageCompanions === null ? null : join(stageCompanions, basename(toPaths[key])),
      });
    }
    if (await existsStrict(fromPaths.assetsDir)) {
      await transferTree(
        fromPaths.assetsDir,
        toPaths.assetsDir,
        stageCompanions === null ? null : join(stageCompanions, basename(toPaths.assetsDir)),
        fs,
      );
    }
    await after("companions-copied");

    // ── 5. The media. This is the commit.
    let mode: "linked" | "copied" = "copied";
    // The target media as the move verified it: what the source is deleted against.
    let destination: Destination | null = null;
    if (linkable) {
      try {
        await fs.link(media, finalMedia(newId));
        mode = "linked";
        destination = await destinationOf(finalMedia(newId), mediaStamp);
      } catch (error) {
        if (!NO_HARD_LINK.has(codeOf(error) ?? "")) throw error;
      }
    }
    if (mode === "copied") {
      // The link was refused (another volume after all, or no hard links there): a copy
      // needs room, checked before a byte is written.
      if (linkable && (await fs.freeBytes(target.directory)) < spaceNeeded) {
        await rollBackTarget(to, newId, assetId, staging, null);
        await rm(journalPath(deps.journalDir, journal.moveId), { force: true });
        return refuse("no-room");
      }
      // Healing recognizes a copy by its sha256 (its mtime is new): record it first.
      if (journal.media.sha256 === null) {
        journal.media.sha256 = await fs.sha256(media);
        await writeJournal(deps.journalDir, journal);
      }
      await mkdir(staging, { recursive: true });
      const staged = join(staging, `${newId}${ext}`);
      const copied = await copyExclusive(media, staged);
      if (copied === "taken") throw new Error(`staging path taken: ${staged}`);
      await after("media-copied");
      if ((await fs.sha256(staged)) !== journal.media.sha256) {
        await rollBackTarget(to, newId, assetId, staging, null);
        await rm(journalPath(deps.journalDir, journal.moveId), { force: true });
        return refuse("checksum-mismatch");
      }
      await after("media-verified");
      // Into a synced folder: one rename, never a hard link (decision 15).
      const placed =
        target.scratch !== undefined
          ? await placeByRename(staged, finalMedia(newId), { intoSynced: true })
          : await placeNew(staged, finalMedia(newId), { stuck: "rollback" });
      if (placed === "taken") throw new Error(`target media taken: ${finalMedia(newId)}`);
      placedAt = { path: finalMedia(newId), identity: placed };
      // With a synced side, the bytes are checked again where they now live, before the
      // source may go: a provider may have touched the file in between. The file is stamped
      // before and after the read, and both stamps must be the same file: a provider that
      // rewrote it while it was read has not been verified. It need not be the inode the
      // placement returned: a provider may give the placed file a new one right after the
      // rename (`safe-place`), and the bytes it holds are what the hash proves.
      if (synced) {
        const beforeRead = await destinationAt(finalMedia(newId));
        const hash = await fs.sha256(finalMedia(newId));
        const afterRead = await destinationAt(finalMedia(newId));
        if (hash !== journal.media.sha256 || !sameDestination(beforeRead, afterRead)) {
          await rollBackTarget(to, newId, assetId, staging, placedAt, {
            sha256: journal.media.sha256,
            hash: fs.sha256,
          });
          await rm(journalPath(deps.journalDir, journal.moveId), { force: true });
          return refuse("checksum-mismatch");
        }
        destination = afterRead;
      } else {
        destination = await destinationOf(finalMedia(newId), placed);
      }
    }
    mediaPlaced = true;
    committedMode = mode;
    await after("media-placed");

    // Freshness caches follow the new file (decision 8). Best effort: a cache, not the item.
    await refreshFreshness(to, newId, journal).catch((error: unknown) =>
      console.error("move: could not refresh the moved item's caches", error),
    );

    // ── 6. Committed: the source goes.
    journal.phase = "committed";
    await writeJournal(deps.journalDir, journal);
    await after("committed");
    // The copy of a synced file can take long, and the provider may bring a newer version of the
    // source in meanwhile: only the file that was copied goes. Otherwise the journal is left
    // for review, the same way healing keeps the source (`healEntry`), and the outcome says so.
    // The small files go with the media, so they get the same check the healing path makes: the
    // record is still this item's, and the edit project is the one that was copied.
    const keepOriginal = async (reason: string): Promise<MoveOutcome> => {
      await writeJournal(deps.journalDir, { ...journal, quarantined: reason });
      console.error(`move ${journal.moveId} of "${id}" kept for review: ${reason}`);
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      return { ok: true, id, newId, mode, keptOriginal: "source-changed" };
    };
    // The slow checks first (they read, and may hash): they decide, but they do not delete.
    const sourceNow = await checkSourceMedia(media, mediaStamp, journal, synced, fs);
    if (sourceNow.changed) return keepOriginal("source media changed after the move committed");
    const companionsReason = await sourceCompanionsChanged(from, to, id, newId, journal.assetId);
    if (companionsReason) return keepOriginal(companionsReason);
    const changedFile = await snapshotChangedFile(companionSnapshot, from.companionPaths(id));
    if (changedFile) return keepOriginal(`source ${changedFile} changed after the move committed`);
    if (destination === null) {
      return keepOriginal("the target media could not be verified as the copy that was placed");
    }
    // The deleting checks are made again, immediately before each removal, with nothing else
    // awaited in between (`removeGuarded`): the destination is still the verified copy, and the
    // source is still the file that was copied. A mismatch keeps both.
    if ((await removeGuarded(media, sourceNow.stamp, destination)) === "kept") {
      return keepOriginal("source or target media changed just before the source was removed");
    }
    // A hard link shares the inode, and removing the source name moves its ctime: the hash
    // stamp is written only now, or the first transcript open would hash the file again.
    await stampMovedMedia(to, newId, journal).catch((error: unknown) =>
      console.error("move: could not stamp the moved item's media", error),
    );
    await after("source-media-deleted");
    const incomplete = await removeCompanionsGuarded(companionSnapshot, destination);
    if (incomplete) return keepOriginal(incomplete);
    await after("source-companions-deleted");

    // ── 7. Done.
    await rm(staging, { recursive: true, force: true });
    await rm(journalPath(deps.journalDir, journal.moveId), { force: true });
    return { ok: true, id, newId, mode };
  } catch (error) {
    if (error instanceof SimulatedCrash) throw error;
    if (mediaPlaced) {
      // Past the commit: the target holds the item. Healing finishes the source side.
      console.error(`move of "${id}" failed after its commit; healing finishes it`, error);
      // The item is in the target whatever happens next, but the move is finished only when the
      // heal finished it: a heal that waits (the source could not be removed, a file is still
      // offloaded) or keeps the entry for review leaves the journal for a later run, and the
      // outcome says the original stayed, as every other incomplete ending does.
      const healed = await healEntry(journal, {
        journalDir: deps.journalDir,
        fs,
        resolve: async (w) => w.directory,
      }).catch((healError: unknown) => {
        console.error(`healing move ${journal.moveId} failed; it is retried later`, healError);
        return "waiting" as const;
      });
      return {
        ok: true,
        id,
        newId: journal.targetId!,
        mode: committedMode,
        ...(healed === "healed" ? {} : { keptOriginal: "source-changed" as const }),
      };
    }
    if (journal.targetId) {
      await rollBackTarget(
        to,
        journal.targetId,
        assetId,
        stagingDir(target.directory, journal.moveId, target.scratch),
        placedAt,
        { sha256: journal.media.sha256, hash: fs.sha256 },
      );
    }
    await rm(journalPath(deps.journalDir, journal.moveId), { force: true });
    throw error;
  }
}

/**
 * Whether the source is no longer the file that was copied, and the stamp the delete step then
 * holds it to. Identity (device + inode) is compared first and nothing overrules it: a provider
 * that replaces the file with another of the same size and mtime is still a different file. A
 * different size is a change. With the same file and size but a new mtime (Google Drive and
 * OneDrive often touch only that) the bytes are hashed and compared with the copy's hash. An
 * evicted source is never hashed (reading it would download it): it counts as changed, and so
 * does one whose identity or bytes cannot be read.
 */
async function checkSourceMedia(
  media: string,
  copied: FileStamp,
  journal: MoveJournal,
  synced: boolean,
  fs: MoverFs,
): Promise<{ changed: boolean; stamp: FileStamp | null }> {
  let current: FileStamp | null;
  try {
    current = await stampAt(media);
  } catch {
    return { changed: true, stamp: null }; // uncertain identity counts as changed
  }
  if (current === null) return { changed: false, stamp: null }; // already gone: nothing to protect
  if (!sameFile(current, copied) || current.size !== copied.size) {
    return { changed: true, stamp: current };
  }
  if (current.mtimeNs === copied.mtimeNs) return { changed: false, stamp: current };
  if (journal.media.sha256 === null) return { changed: true, stamp: current };
  if (synced && (await fs.evicted([media])).size > 0) return { changed: true, stamp: current };
  try {
    return { changed: (await fs.sha256(media)) !== journal.media.sha256, stamp: current };
  } catch {
    return { changed: true, stamp: current }; // unreadable: keep the original
  }
}

/** The tags the item carries, by name and color, from the source registry (or the cached names). */
async function sourceTags(
  from: LibraryVault,
  record: Sidecar,
  deps: MoverDeps,
  now: () => number,
): Promise<{ name: string; color: TagColor }[]> {
  const ids = Array.isArray(record.tagIds) ? record.tagIds : [];
  if (ids.length === 0) return [];
  try {
    const live = new Map(
      (await new VaultTagRepository(() => from, deps.deviceId, now).liveTags()).map((t) => [
        t.id,
        t,
      ]),
    );
    return ids.flatMap((tagId) => {
      const tag = live.get(tagId);
      return tag ? [{ name: tag.name, color: tag.color }] : [];
    });
  } catch (error) {
    if (!(error instanceof TagRegistryError)) throw error;
    // The source registry cannot be read: the sidecar's cached names still say what they were.
    const names = Array.isArray(record.tagNames) ? record.tagNames : [];
    const colors: TagColor[] = [];
    return names.flatMap((name) => {
      if (typeof name !== "string") return [];
      const color = nextTagColor(colors);
      colors.push(color);
      return [{ name, color }];
    });
  }
}

/**
 * Put `from` at `to`, never replacing a file there: a hard link on the same volume, else an
 * exclusive copy whose bytes are compared with the source's (sha256) before the source may go:
 * a matching size proves nothing. With `stage` (a synced target) the copy is made at `stage`,
 * outside the synced folder, and renamed to `to` only once it is whole and verified: the
 * provider never sees half of a file under its final name.
 */
async function transfer(
  from: string,
  to: string,
  options: { sameDevice: boolean; fs: MoverFs; stage?: string | null },
): Promise<void> {
  if (options.stage) {
    await mkdir(dirname(options.stage), { recursive: true });
    const copied = await copyExclusive(from, options.stage);
    if (copied === "taken")
      throw Object.assign(new Error(`"${options.stage}" exists`), { code: "EEXIST" });
    if ((await options.fs.sha256(from)) !== (await options.fs.sha256(options.stage))) {
      await rm(options.stage, { force: true });
      throw Object.assign(new Error(`copy mismatch: ${to}`), { code: "EIO" });
    }
    const placed = await placeByRename(options.stage, to, { intoSynced: true });
    if (placed === "taken") throw Object.assign(new Error(`"${to}" exists`), { code: "EEXIST" });
    return;
  }
  if (options.sameDevice) {
    try {
      await options.fs.link(from, to);
      return;
    } catch (error) {
      if (!NO_HARD_LINK.has(codeOf(error) ?? "")) throw error;
    }
  }
  const copied = await copyExclusive(from, to);
  if (copied === "taken") throw Object.assign(new Error(`"${to}" exists`), { code: "EEXIST" });
  if ((await options.fs.sha256(from)) !== (await options.fs.sha256(to))) {
    await rm(to, { force: true });
    throw Object.assign(new Error(`checksum mismatch: ${to}`), { code: "EIO" });
  }
}

/** Every file under `directory` at any depth; a missing folder throws ENOENT, like `readdir`. */
async function filesBelow(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesBelow(path)));
    else found.push(path);
  }
  return found;
}

/**
 * The assets folder into the target: every file is copied (and its bytes verified) one by one
 * (`transfer`). Into a synced target each goes through `stageDir`, outside the synced folder,
 * and is renamed to its final name; folders are created empty in the target; no file there is
 * ever partial, and none is replaced.
 */
async function transferTree(
  from: string,
  to: string,
  stageDir: string | null,
  fs: MoverFs,
): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    if (entry.isDirectory()) {
      await transferTree(
        source,
        join(to, entry.name),
        stageDir === null ? null : join(stageDir, entry.name),
        fs,
      );
    } else {
      await transfer(source, join(to, entry.name), {
        sameDevice: false,
        fs,
        stage: stageDir === null ? null : join(stageDir, entry.name),
      });
    }
  }
}

async function removeCompanions(paths: CompanionPaths): Promise<void> {
  await Promise.allSettled(
    Object.values(paths).map((path) => rm(path, { recursive: true, force: true })),
  );
}

/**
 * Undo what a move made in the target: the record and companions under `newId` (only while
 * the record there is this item's, or gone), its staging folder, and the media only when it
 * is `media`. A live move passes the file it placed with the identity it got then, and the name
 * is removed only while it still holds that file (a provider-rewritten or foreign file there is
 * left alone). Healing passes a bare path: it has just proven the record and the source.
 */
async function rollBackTarget(
  to: LibraryVault,
  newId: string,
  assetId: string,
  staging: string,
  media: string | { path: string; identity: FileIdentity } | null,
  /**
   * The bytes the placed media holds (the journal's hash), for a name a provider re-inoded:
   * `removeIfSame` leaves such a file, which would stay under its final name for the target to
   * adopt as a new item while the source still holds the original.
   */
  proof?: { sha256: string | null; hash: (path: string) => Promise<string> },
): Promise<void> {
  await rm(staging, { recursive: true, force: true }).catch(() => {});
  const read = await to.readRecordStrict(to.sidecarPath(newId));
  if (read.status === "ok" && read.sidecar.assetId !== assetId) return;
  if (read.status !== "ok" && read.status !== "missing") return;
  if (typeof media === "string") await rm(media, { force: true });
  else if (media && !(await removeIfSame(media.path, media.identity)) && proof) {
    await removeIfBytesMatch(media.path, proof);
  }
  await removeCompanions(to.companionPaths(newId));
}

/**
 * Removes `path` only when it holds exactly the bytes `proof.sha256` names, read from one file
 * that is still the same one when the read ends (a hash of a large file takes seconds, and the
 * provider may deliver another file under the name meanwhile). Another file's bytes, an
 * unreadable name or a move that never recorded a hash leave it in place: never guess.
 */
async function removeIfBytesMatch(
  path: string,
  proof: { sha256: string | null; hash: (path: string) => Promise<string> },
): Promise<void> {
  if (proof.sha256 === null) return;
  try {
    const before = await stampAt(path);
    if (before === null || (await proof.hash(path)) !== proof.sha256) return;
    if (!sameStamp(before, await stampAt(path))) return;
    await rm(path);
  } catch {
    // Left in place.
  }
}

/**
 * Stamps the moved media's cached hash from its stat now. A copy is a new file (new inode and
 * ctime) even when its mtime was kept; a link shares the source's inode, whose ctime moves
 * when the source name is removed, so callers stamp again after that. The journal's hash is
 * the one the move verified.
 */
async function stampMovedMedia(
  to: LibraryVault,
  newId: string,
  journal: MoveJournal,
): Promise<void> {
  const now = await statOrNull(join(to.directory, `${newId}${journal.ext}`));
  if (!now) return;
  if (journal.media.sha256 && now.size === journal.media.size) {
    await to.writeMeta(newId, { contentSha256: journal.media.sha256, ...stampFields(now) });
  }
}

/**
 * A copied media file has a new mtime: the sidecar's hash cache and the edit project's
 * freshness stamp are rewritten for it, when they matched the source (decision 8).
 */
async function refreshFreshness(
  to: LibraryVault,
  newId: string,
  journal: MoveJournal,
): Promise<void> {
  await stampMovedMedia(to, newId, journal);
  const now = await statOrNull(join(to.directory, `${newId}${journal.ext}`));
  if (!now) return;
  if (now.mtimeMs === journal.media.mtimeMs && now.size === journal.media.size) return;
  const metaPath = to.companionPaths(newId).editMeta;
  let meta: SessionMeta;
  try {
    meta = JSON.parse(await readFile(metaPath, "utf-8")) as SessionMeta;
  } catch {
    return;
  }
  if (meta.sourceSizeBytes === journal.media.size && meta.sourceMtimeMs === journal.media.mtimeMs) {
    await atomicWriteFile(
      metaPath,
      JSON.stringify({ ...meta, sourceSizeBytes: now.size, sourceMtimeMs: now.mtimeMs }),
    );
  }
}

// ── Healing ───────────────────────────────────────────────────────────────────

export interface HealDeps {
  journalDir: string;
  /** The folder a workspace lives in now, or null while it is not connected. */
  resolve(side: MoveSide): Promise<string | null>;
  fs?: Partial<MoverFs>;
}

export interface HealReport {
  /** Entries finished: rolled forward or back. */
  healed: number;
  /** Entries waiting for an unavailable workspace. */
  waiting: number;
  /** Entries kept and surfaced: neither side could be proven complete. */
  quarantined: MoveJournal[];
}

/**
 * Finish every journal entry from what is on disk (ADR 0033, decision 6). Runs at startup and
 * before each move. One rule covers every case: a side is deleted only when the other side is
 * verified complete, and a phase of `copying` never justifies deleting a target.
 */
export async function healMoves(deps: HealDeps): Promise<HealReport> {
  const fs: MoverFs = { ...defaultFs, ...deps.fs };
  const report: HealReport = { healed: 0, waiting: 0, quarantined: [] };
  let names: string[];
  try {
    names = await readdir(deps.journalDir);
  } catch {
    return report;
  }
  // One run asks each workspace once: a provider that does not answer costs the whole
  // availability bound per ask, and k pending entries must not pay it k times (twice each).
  const answers = new Map<string, Promise<string | null>>();
  const resolve = (side: MoveSide): Promise<string | null> => {
    let answer = answers.get(side.workspaceId);
    if (!answer) {
      answer = deps.resolve(side);
      answers.set(side.workspaceId, answer);
    }
    return answer;
  };
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    let journal: MoveJournal;
    try {
      journal = JSON.parse(await readFile(join(deps.journalDir, name), "utf-8")) as MoveJournal;
    } catch (error) {
      console.error(`move journal ${name} cannot be read; kept`, error);
      continue;
    }
    if (journal.quarantined) {
      report.quarantined.push(journal);
      continue;
    }
    const outcome = await withItemLock(journal.source.workspaceId, journal.sourceId, () =>
      healEntry(journal, { ...deps, resolve, fs }),
    ).catch((error: unknown) => {
      console.error(`healing move ${journal.moveId} failed; it is retried later`, error);
      return "waiting" as const;
    });
    if (outcome === "healed") report.healed += 1;
    else if (outcome === "waiting") report.waiting += 1;
    else report.quarantined.push(outcome);
  }
  return report;
}

async function healEntry(
  journal: MoveJournal,
  deps: { journalDir: string; resolve(side: MoveSide): Promise<string | null>; fs: MoverFs },
): Promise<"healed" | "waiting" | MoveJournal> {
  // A workspace that is not connected waits: its side cannot be inspected. The target is not
  // asked while the source is away (each ask can cost the availability bound).
  const sourceDir = await deps.resolve(journal.source);
  if (sourceDir === null) return "waiting";
  const targetDir = await deps.resolve(journal.target);
  if (targetDir === null) return "waiting";
  const from = vaultOf(journal.source, sourceDir, deps.fs);
  const to = vaultOf(journal.target, targetDir, deps.fs);
  const staging = stagingDir(targetDir, journal.moveId, journal.target.scratch);
  const done = async (): Promise<"healed"> => {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    await rm(journalPath(deps.journalDir, journal.moveId), { force: true });
    return "healed";
  };
  const quarantine = async (reason: string): Promise<MoveJournal> => {
    const kept = { ...journal, quarantined: reason };
    await writeJournal(deps.journalDir, kept);
    console.error(`move ${journal.moveId} of "${journal.sourceId}" kept for review: ${reason}`);
    return kept;
  };

  const sourceMedia = join(sourceDir, `${journal.sourceId}${journal.ext}`);
  const sourceStat = await statOrNull(sourceMedia);
  // The identity the checks below are made against: the delete is held to it (`removeGuarded`).
  const sourceStamp = await stampAt(sourceMedia).catch(() => null);
  const sourcePresent = sourceStat !== null;
  // The identity the move recorded before it copied: the one thing the source may be deleted
  // against. A journal without a well-formed stamp proves nothing about the file there now.
  const recordedSource = stampFromRecord(journal.sourceStamp);
  const sourceProven =
    recordedSource !== undefined && sourceStamp !== null && sameStamp(sourceStamp, recordedSource);
  // Looser, for the branches that remove only the TARGET's partial copy (never the source):
  // the recorded identity when there is one, else what older journals recorded.
  const sourceMatches =
    recordedSource !== undefined
      ? sourceProven
      : sourceStat !== null &&
        sourceStat.size === journal.media.size &&
        sourceStat.mtimeMs === journal.media.mtimeMs;

  if (journal.targetId === null) {
    // Died before the stem was reserved, or in the middle of it: only a record can be there.
    if (sourcePresent) {
      await removeOrphanRecords(to, journal.assetId);
      return done();
    }
    return quarantine("source media missing before the target was reserved");
  }

  const targetId = journal.targetId;
  const targetMedia = join(targetDir, `${targetId}${journal.ext}`);
  // A synced side: the checks below hash the target copy (a copy always has a new mtime) and
  // compare the two edit projects, and reading an offloaded file downloads it (decision 15).
  // The heal runs at startup and before every group, so it waits until they are local instead.
  if (journal.source.scratch !== undefined || journal.target.scratch !== undefined) {
    const reads = [
      targetMedia,
      join(staging, `${targetId}${journal.ext}`),
      to.companionPaths(targetId).editSession,
      from.companionPaths(journal.sourceId).editSession,
    ];
    if ((await deps.fs.evicted(reads)).size > 0) return "waiting";
  }
  const targetStampBefore = await stampAt(targetMedia).catch(() => null);
  const targetMatches = await mediaMatches(targetMedia, journal, deps.fs, recordedSource);
  const targetStamp = await stampAt(targetMedia).catch(() => null);
  const targetPresent = (await statOrNull(targetMedia)) !== null;
  const targetRecord = await to.readRecordStrict(to.sidecarPath(targetId));
  const recordIsOurs =
    targetRecord.status === "missing" ||
    (targetRecord.status === "ok" && targetRecord.sidecar.assetId === journal.assetId);

  if (targetPresent && targetMatches && recordIsOurs) {
    // The target file must be the same file before and after it was read: a provider that
    // rewrote it meanwhile has not been verified, and the source may not go against it.
    if (targetStamp === null || !sameStamp(targetStampBefore, targetStamp)) return "waiting";
    const destination: Destination = { path: targetMedia, stamp: targetStamp };
    // Committed, whatever the phase says: roll forward.
    if (targetRecord.status === "missing") {
      const read = await from.readRecordStrict(from.sidecarPath(journal.sourceId));
      if (read.status !== "ok")
        return quarantine("target record missing and source record unreadable");
      await atomicWriteFile(to.sidecarPath(targetId), JSON.stringify(read.sidecar, null, 2));
    }
    if (journal.phase !== "committed") {
      await writeJournal(deps.journalDir, { ...journal, phase: "committed" });
    }
    await refreshFreshness(to, targetId, journal).catch(() => {});
    // The source goes only while it is still the item this journal moved. Its stem may be
    // someone else's by now (a new recording, a rename), and while the target was unplugged
    // the user may have kept editing the item here: those edits are not ours to delete.
    const sourceRecord = await from.readRecordStrict(from.sidecarPath(journal.sourceId));
    if (sourceRecord.status !== "ok" && sourceRecord.status !== "missing") {
      return quarantine("source record unreadable");
    }
    const sourceIsOurs =
      sourceRecord.status === "missing" || sourceRecord.sidecar.assetId === journal.assetId;
    if (sourceIsOurs) {
      // What the source was BEFORE the copy, as the journal recorded it. Comparing against a fresh
      // snapshot would make whatever is there after a crash the baseline, and delete it.
      const recorded = snapshotFromRecord(journal.companions, sourceDir);
      if (recordedSource === undefined || recorded === undefined) {
        // An older journal, or a damaged one: nothing proves what the source held. If anything
        // of it is still there it stays; a source with nothing left has nothing to protect.
        const left = await snapshotCompanions(from.companionPaths(journal.sourceId)).catch(
          () => null,
        );
        const anything = left === null || [...left.files.values()].some((stamp) => stamp !== null);
        if (sourcePresent || anything) {
          return quarantine(
            "the journal records no identity of the source (written by an older version): source kept",
          );
        }
        return done();
      }
      if (sourcePresent) {
        if (!sourceProven) return quarantine("source media is not the file that was copied");
        if (await editProjectChanged(from, to, journal.sourceId, targetId)) {
          return quarantine("source edit project changed after the move committed");
        }
      }
      const changedFile = await changedSinceJournal(
        recorded,
        from.companionPaths(journal.sourceId),
      );
      if (changedFile) return quarantine(`source ${changedFile} changed after the move committed`);
      if (sourcePresent) {
        // The checks above read, hashed and awaited: the delete re-checks the source and the
        // target together, with nothing awaited between that check and the `rm`.
        try {
          if ((await removeGuarded(sourceMedia, recordedSource, destination)) === "kept") {
            return quarantine("source or target media changed just before the source was removed");
          }
        } catch (error) {
          // Still there (open elsewhere, read-only): the record stays with it and the
          // journal stays for a later run, so the file is never listed under a new identity.
          console.error(`move ${journal.moveId}: cannot remove "${sourceMedia}"`, error);
          return "waiting";
        }
        // The removal moved the shared inode's ctime (a linked move): stamp again.
        await stampMovedMedia(to, targetId, journal).catch(() => {});
      }
      const incomplete = await removeCompanionsGuarded(recorded, destination);
      if (incomplete) return quarantine(incomplete);
    }
    return done();
  }

  if (sourcePresent && !targetPresent) {
    // Not committed: undo the target side. The source was never touched.
    const placedStaged = join(staging, `${targetId}${journal.ext}`);
    await rm(placedStaged, { force: true }).catch(() => {});
    await rollBackTarget(to, targetId, journal.assetId, staging, null);
    return done();
  }

  if (sourcePresent && targetPresent) {
    // A partial or foreign target file.
    if (sourceMatches && recordIsOurs) {
      await rollBackTarget(to, targetId, journal.assetId, staging, targetMedia);
      return done();
    }
    return quarantine("both media files present and neither proven complete");
  }

  if (!sourcePresent && targetPresent) {
    return quarantine("source gone and the target media does not match: the only copy");
  }

  // Neither side has the media: a verified copy may still be in staging.
  const staged = join(staging, `${targetId}${journal.ext}`);
  if (recordIsOurs && (await mediaMatches(staged, journal, deps.fs))) {
    const placed =
      journal.target.scratch !== undefined
        ? (await placeByRename(staged, targetMedia, { intoSynced: true })) === "taken"
          ? "taken"
          : "placed"
        : await placeNoReplace(staged, targetMedia, { stuck: "rollback" });
    if (placed === "placed") return healEntry(journal, deps);
  }
  return quarantine("no media on either side");
}

/**
 * The source's edit project is not the one that was copied: it was saved again after the
 * move committed (the target was unplugged and the item stayed editable here).
 */
async function editProjectChanged(
  from: LibraryVault,
  to: LibraryVault,
  sourceId: string,
  targetId: string,
): Promise<boolean> {
  const sourcePath = from.companionPaths(sourceId).editSession;
  if (!(await existsStrict(sourcePath).catch(() => true))) return false;
  try {
    // Through each vault's guard: an offloaded project is never read (that would download it);
    // it counts as changed, so the source keeps its copy.
    const [mine, theirs] = await Promise.all([
      from.readLocalFile(sourcePath),
      to.readLocalFile(to.companionPaths(targetId).editSession),
    ]);
    return !mine.equals(theirs);
  } catch {
    return true;
  }
}

/**
 * Why the source's small files must stay, or null: its record now carries another item's
 * identity, or its edit project is not the one that was copied (another Mac saved it into the
 * synced source folder during a long copy). The same two checks `healEntry` makes.
 */
async function sourceCompanionsChanged(
  from: LibraryVault,
  to: LibraryVault,
  sourceId: string,
  targetId: string,
  assetId: string,
): Promise<string | null> {
  const record = await from.readRecordStrict(from.sidecarPath(sourceId));
  if (record.status === "ok" && record.sidecar.assetId !== assetId) {
    return "source record changed after the move committed";
  }
  if (record.status !== "ok" && record.status !== "missing") {
    return "source record unreadable after the move committed";
  }
  return (await editProjectChanged(from, to, sourceId, targetId))
    ? "source edit project changed after the move committed"
    : null;
}

/**
 * The file at `path` is the journal's media. A copy is recognized by its bytes alone: the same
 * size and mtime prove nothing (a provider, or a user, can leave a different file looking
 * identical), so the recorded sha256 is always checked first-hand. A linked move records no
 * hash: its target is the very file that was linked, so it is recognized by the source's
 * recorded device + inode (a hard link cannot hold other bytes), size and mtime.
 */
async function mediaMatches(
  path: string,
  journal: MoveJournal,
  fs: MoverFs,
  linkedFrom?: FileStamp,
): Promise<boolean> {
  const info = await statOrNull(path);
  if (!info || info.size !== journal.media.size) return false;
  if (journal.media.sha256) {
    try {
      return (await fs.sha256(path)) === journal.media.sha256;
    } catch {
      return false;
    }
  }
  if (linkedFrom === undefined) return false;
  const stamp = await stampAt(path).catch(() => null);
  return stamp !== null && sameStamp(stamp, linkedFrom);
}

/** Records carrying `assetId` with no media beside them: what an interrupted reservation left. */
async function removeOrphanRecords(to: LibraryVault, assetId: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(join(to.directory, META_DIR));
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes(".edit") || name.includes(".cursor")) continue;
    // A transcript is a companion, not a record: it can never be an interrupted reservation.
    if (name.endsWith(".transcript.json")) continue;
    const stem = name.slice(0, -".json".length);
    const read = await to.readRecordStrict(to.sidecarPath(stem));
    if (read.status !== "ok" || read.sidecar.assetId !== assetId) continue;
    if (await to.hasMedia(stem)) continue;
    await removeCompanions(to.companionPaths(stem));
  }
}
