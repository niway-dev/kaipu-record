import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  cp,
  link,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  unlink,
} from "node:fs/promises";
import { extname, join } from "node:path";
import { nextTagColor, type TagColor } from "@kaipu/domain/constants";
import type { MoveRefusal } from "@shared/types/workspaces";
import { atomicWriteFile } from "../library/atomic-write";
import { sha256FileBase64 } from "../library/content-hash";
import type { DragLedger } from "../library/drag-ledger";
import { withItemLock } from "../library/item-lock";
import {
  isPlainItemId,
  LibraryVault,
  META_DIR,
  readSidecarStrict,
  type CompanionPaths,
  type Sidecar,
} from "../library/library-vault";
import { probeDataless } from "../library/dataless";
import { copyExclusive, placeByRename, placeNoReplace } from "../library/safe-place";
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
 *      unsynced. It copies into the scratch folder in userData, places by rename and verifies
 *      the sha256 again at the final path.
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
  | { ok: true; id: string; newId: string; mode: "linked" | "copied" }
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
    const info = await statfs(directory);
    return Number(info.bavail) * Number(info.bsize);
  },
};

/** The item's files besides the media and the sidecar, in the order they are copied. */
const COMPANION_FILES = ["thumbnail", "cursorTrack", "editSession", "editMeta", "webcam"] as const;

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

async function statOrNull(path: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  }
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
  const from = new LibraryVault(source.directory, source.workspaceId);
  const to = new LibraryVault(target.directory, target.workspaceId);

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
  const read = await readSidecarStrict(from.sidecarPath(id));
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
    const offloaded = await fs.evicted([media, from.webcamFilePath(id)]);
    if (offloaded.size > 0) return refuse("evicted");
  }
  const mediaInfo = await stat(media);
  const sameDevice = (await stat(source.directory)).dev === targetInfo.dev;
  // A synced side always copies: never a second name for a file a provider syncs.
  const synced = source.scratch !== undefined || target.scratch !== undefined;
  const linkable = sameDevice && !synced;
  const webcamInfo = await statOrNull(from.webcamFilePath(id));
  const spaceNeeded = mediaInfo.size + (webcamInfo?.size ?? 0) + MOVE_SPACE_MARGIN_BYTES;
  if (!linkable && (await fs.freeBytes(target.directory)) < spaceNeeded) return refuse("no-room");

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

  // The media's identity, for healing. A copy always hashes; a link keeps size and mtime.
  const cached =
    record.contentSha256 &&
    record.hashedSizeBytes === mediaInfo.size &&
    record.hashedMtimeMs === mediaInfo.mtimeMs
      ? record.contentSha256
      : null;
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
    createdAt: now(),
  };
  await writeJournal(deps.journalDir, journal);
  await after("journal-written");

  const finalMedia = (newId: string): string => join(target.directory, `${newId}${ext}`);
  let mediaPlaced = false;
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

    // ── 4. The small files and the webcam track.
    const fromPaths = from.companionPaths(id);
    const toPaths = to.companionPaths(newId);
    for (const key of COMPANION_FILES) {
      if (!(await existsStrict(fromPaths[key]))) continue;
      await transfer(fromPaths[key], toPaths[key], {
        sameDevice: linkable,
        verify: key === "webcam",
        fs,
      });
    }
    if (await existsStrict(fromPaths.assetsDir)) {
      await cp(fromPaths.assetsDir, toPaths.assetsDir, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }
    await after("companions-copied");

    // ── 5. The media. This is the commit.
    let mode: "linked" | "copied" = "copied";
    const staging = stagingDir(target.directory, journal.moveId, target.scratch);
    if (linkable) {
      try {
        await fs.link(media, finalMedia(newId));
        mode = "linked";
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
          ? await placeByRename(staged, finalMedia(newId))
          : await placeNoReplace(staged, finalMedia(newId), { stuck: "rollback" });
      if (placed === "taken") throw new Error(`target media taken: ${finalMedia(newId)}`);
      // With a synced side, the bytes are checked again where they now live, before the
      // source may go: a provider may have touched the file in between.
      if (synced && (await fs.sha256(finalMedia(newId))) !== journal.media.sha256) {
        await rollBackTarget(to, newId, assetId, staging, finalMedia(newId));
        await rm(journalPath(deps.journalDir, journal.moveId), { force: true });
        return refuse("checksum-mismatch");
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
    await rm(media, { force: true });
    await after("source-media-deleted");
    await removeCompanions(from.companionPaths(id));
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
      // The item is in the target whatever happens next: a failing heal leaves the journal for
      // the next run (startup, or before the next group) and must not turn this into "io".
      await healEntry(journal, {
        journalDir: deps.journalDir,
        fs,
        resolve: async (w) => w.directory,
      }).catch((healError: unknown) =>
        console.error(`healing move ${journal.moveId} failed; it is retried later`, healError),
      );
      return { ok: true, id, newId: journal.targetId!, mode: committedMode };
    }
    if (journal.targetId) {
      await rollBackTarget(
        to,
        journal.targetId,
        assetId,
        stagingDir(target.directory, journal.moveId, target.scratch),
        null,
      );
    }
    await rm(journalPath(deps.journalDir, journal.moveId), { force: true });
    throw error;
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
 * exclusive copy (verified by sha256 when asked, by size otherwise).
 */
async function transfer(
  from: string,
  to: string,
  options: { sameDevice: boolean; verify: boolean; fs: MoverFs },
): Promise<void> {
  if (options.sameDevice) {
    try {
      await options.fs.link(from, to);
      return;
    } catch (error) {
      if (!NO_HARD_LINK.has(codeOf(error) ?? "")) throw error;
    }
  }
  if (!options.verify) {
    await copyFile(from, to, constants.COPYFILE_EXCL);
    const [a, b] = await Promise.all([stat(from), stat(to)]);
    if (a.size !== b.size) throw Object.assign(new Error(`short copy: ${to}`), { code: "EIO" });
    return;
  }
  const copied = await copyExclusive(from, to);
  if (copied === "taken") throw Object.assign(new Error(`"${to}" exists`), { code: "EEXIST" });
  if ((await options.fs.sha256(from)) !== (await options.fs.sha256(to))) {
    await rm(to, { force: true });
    throw Object.assign(new Error(`checksum mismatch: ${to}`), { code: "EIO" });
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
 * is `media` (a file this move placed and verified to be its own).
 */
async function rollBackTarget(
  to: LibraryVault,
  newId: string,
  assetId: string,
  staging: string,
  media: string | null,
): Promise<void> {
  await rm(staging, { recursive: true, force: true }).catch(() => {});
  const read = await readSidecarStrict(to.sidecarPath(newId));
  if (read.status === "ok" && read.sidecar.assetId !== assetId) return;
  if (read.status !== "ok" && read.status !== "missing") return;
  if (media) await rm(media, { force: true });
  await removeCompanions(to.companionPaths(newId));
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
  const now = await statOrNull(join(to.directory, `${newId}${journal.ext}`));
  if (!now) return;
  if (now.mtimeMs === journal.media.mtimeMs && now.size === journal.media.size) return;
  if (journal.media.sha256 && now.size === journal.media.size) {
    await to.writeMeta(newId, {
      contentSha256: journal.media.sha256,
      hashedSizeBytes: now.size,
      hashedMtimeMs: now.mtimeMs,
    });
  }
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
      healEntry(journal, { ...deps, fs }),
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
  const sourceDir = await deps.resolve(journal.source);
  const targetDir = await deps.resolve(journal.target);
  // A workspace that is not connected waits: its side cannot be inspected.
  if (sourceDir === null || targetDir === null) return "waiting";
  const from = new LibraryVault(sourceDir);
  const to = new LibraryVault(targetDir);
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
  const sourcePresent = sourceStat !== null;
  const sourceMatches =
    sourceStat !== null &&
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
  const targetMatches = await mediaMatches(targetMedia, journal, deps.fs);
  const targetPresent = (await statOrNull(targetMedia)) !== null;
  const targetRecord = await readSidecarStrict(to.sidecarPath(targetId));
  const recordIsOurs =
    targetRecord.status === "missing" ||
    (targetRecord.status === "ok" && targetRecord.sidecar.assetId === journal.assetId);

  if (targetPresent && targetMatches && recordIsOurs) {
    // Committed, whatever the phase says: roll forward.
    if (targetRecord.status === "missing") {
      const read = await readSidecarStrict(from.sidecarPath(journal.sourceId));
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
    const sourceRecord = await readSidecarStrict(from.sidecarPath(journal.sourceId));
    if (sourceRecord.status !== "ok" && sourceRecord.status !== "missing") {
      return quarantine("source record unreadable");
    }
    const sourceIsOurs =
      sourceRecord.status === "missing" || sourceRecord.sidecar.assetId === journal.assetId;
    if (sourceIsOurs) {
      if (sourcePresent) {
        if (!sourceMatches) return quarantine("source media changed after the move committed");
        if (await editProjectChanged(from, to, journal.sourceId, targetId)) {
          return quarantine("source edit project changed after the move committed");
        }
        try {
          await unlink(sourceMedia);
        } catch (error) {
          if (codeOf(error) !== "ENOENT") {
            // Still there (open elsewhere, read-only): the record stays with it and the
            // journal stays for a later run, so the file is never listed under a new identity.
            console.error(`move ${journal.moveId}: cannot remove "${sourceMedia}"`, error);
            return "waiting";
          }
        }
      }
      await removeCompanions(from.companionPaths(journal.sourceId));
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
        ? (await placeByRename(staged, targetMedia)) === "taken"
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
    const [mine, theirs] = await Promise.all([
      readFile(sourcePath),
      readFile(to.companionPaths(targetId).editSession),
    ]);
    return !mine.equals(theirs);
  } catch {
    return true;
  }
}

/** The file at `path` is the journal's media: same size, and the same mtime or sha256. */
async function mediaMatches(path: string, journal: MoveJournal, fs: MoverFs): Promise<boolean> {
  const info = await statOrNull(path);
  if (!info || info.size !== journal.media.size) return false;
  if (info.mtimeMs === journal.media.mtimeMs) return true;
  if (!journal.media.sha256) return false;
  try {
    return (await fs.sha256(path)) === journal.media.sha256;
  } catch {
    return false;
  }
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
    const stem = name.slice(0, -".json".length);
    const read = await readSidecarStrict(to.sidecarPath(stem));
    if (read.status !== "ok" || read.sidecar.assetId !== assetId) continue;
    if (await to.hasMedia(stem)) continue;
    await removeCompanions(to.companionPaths(stem));
  }
}
