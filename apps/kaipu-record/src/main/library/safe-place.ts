/**
 * The one way bytes are put at a vault media path (NIW2-561, ADR 0033 "Placing a file").
 *
 * Finder, a sync tool or another process can create a file at any path at any time; nothing
 * the app holds stops them. So no placement here ever replaces a file at its destination,
 * whenever that file arrived, except `replaceConfirmed`, which the save dialog's "Replace"
 * answer authorizes. A name is removed only while it still holds a file whose identity
 * (device + inode, read as bigints) this operation captured from its own handle or link —
 * never on an identity merely observed at a path, and never when the path cannot be read.
 *
 * Threat model (ADR 0033): no data loss against our own concurrency, a crash at any point, an
 * I/O error at any call, or a file that is at the destination before the no-replace step. Node
 * has no rename-without-replace nor unlink-by-handle, so an external process that swaps a
 * path in the instant between our identity check and the `unlink` that follows it is not
 * covered; everywhere else, uncertain ownership keeps the bytes.
 */
import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { link, lstat, open, readFile, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { atomicWriteFile, syncDir } from "./atomic-write";

/** "taken": a file already exists at the destination; nothing was replaced or moved. */
export type Placement = "placed" | "taken";

/** What happens when the bytes are placed but the source cannot be removed. */
export type StuckSource =
  /** Set the source aside (or mark it placed) and report the placement: for staging files. */
  | "set-aside"
  /** Undo the placement and fail with the removal error: for a vault file being renamed. */
  | "rollback";

/** Which file a name holds: device + inode as bigints (Windows file ids overflow a double). */
export interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

/** The file a placement created at its destination, and its size. */
export interface PlacedFile extends FileIdentity {
  size: bigint;
}

/** `link` errors that mean "this volume (or pair of volumes) has no hard links": copy instead. */
const NO_HARD_LINK = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EMLINK"]);

const COPY_CHUNK = 1 << 20;

/** Suffix a placed source gets when it cannot be removed: the stranded sweep's pattern skips it. */
export const PLACED_SUFFIX = ".placed";
/** `<source>.placed.json`: written when a placed source can be neither removed nor renamed. */
export const PLACED_MARKER_SUFFIX = ".placed.json";

export interface PlacementMarker {
  version: 1;
  /** Absolute path the source's bytes were placed at. */
  destination: string;
  /** Size of the placed file, in bytes. */
  size: number;
}

/** An EEXIST error for a caller that reports "taken" as a failure. */
export function takenError(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`"${path}" already exists`), { code: "EEXIST", path });
}

/** A placement found a file at its destination (it never replaces one). */
export function isFileExists(error: unknown): boolean {
  return codeOf(error) === "EEXIST";
}

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function identityOf(stats: BigIntStats): PlacedFile {
  return { dev: stats.dev, ino: stats.ino, size: stats.size };
}

/** The identity `path` holds now, or null when nothing is there. Other errors propagate. */
export async function identityAt(path: string): Promise<PlacedFile | null> {
  try {
    return identityOf(await lstat(path, { bigint: true }));
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  }
}

/**
 * Unlink `path` only while it still holds `identity`, a file this operation created or owns.
 * Best effort: an unreadable path or another file there is left alone. Resolves whether it
 * was removed.
 */
export async function removeIfSame(path: string, identity: FileIdentity): Promise<boolean> {
  try {
    const now = await identityAt(path);
    if (!now || !sameFile(now, identity)) return false;
    await unlink(path);
    return true;
  } catch {
    return false; // left in place: never guess
  }
}

/** A unique sibling name for a temporary file next to `path` (hidden, not a known extension). */
export function siblingTemp(path: string, tag: string): string {
  return join(dirname(path), `.${basename(path)}.${tag}-${randomUUID().slice(0, 8)}`);
}

function notTheFile(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`"${path}" is no longer the file being placed`), {
    code: "ESTALE",
    path,
  });
}

/**
 * Put a second name `to` on the file open as `source` (identity `sourceId`, read at `from`),
 * never replacing a file at `to`; `from` stays. A hard link where the volume has them; else an
 * exclusive-create copy, flushed to disk. Resolves the file created at `to`, or "taken".
 */
async function duplicateAt(
  source: FileHandle,
  sourceId: PlacedFile,
  from: string,
  to: string,
): Promise<PlacedFile | "taken"> {
  try {
    await link(from, to);
    return sourceId; // a link names the very file the handle holds (verified by the caller)
  } catch (error) {
    const code = codeOf(error);
    if (code === "EEXIST") return "taken";
    if (!code || !NO_HARD_LINK.has(code)) throw error;
  }
  return copyFromHandle(source, to);
}

/**
 * Copy `from` into a file this call creates with `wx` (EEXIST → "taken"). Every byte read is
 * written: a short write is continued, a write that makes no progress fails. Flushed and closed
 * before it counts. Any failure removes the created file (only while it is still that file,
 * known from its own handle) and keeps `from`.
 */
export async function copyExclusive(from: string, to: string): Promise<PlacedFile | "taken"> {
  const source = await open(from, "r");
  try {
    return await copyFromHandle(source, to);
  } finally {
    await source.close().catch(() => {});
  }
}

async function copyFromHandle(source: FileHandle, to: string): Promise<PlacedFile | "taken"> {
  let target: FileHandle;
  try {
    target = await open(to, "wx");
  } catch (error) {
    if (codeOf(error) === "EEXIST") return "taken";
    throw error;
  }
  let created: FileIdentity | null = null;
  let closed = false;
  try {
    created = identityOf(await target.stat({ bigint: true }));
    const buffer = Buffer.allocUnsafe(COPY_CHUNK);
    let position = 0;
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, COPY_CHUNK, position);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        const { bytesWritten } = await target.write(
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        if (!(bytesWritten > 0)) {
          throw Object.assign(new Error(`No progress writing "${to}"`), { code: "EIO" });
        }
        written += bytesWritten;
      }
      position += bytesRead;
    }
    await target.sync();
    const copied = identityOf(await target.stat({ bigint: true })); // plus the final size
    await target.close(); // a failed close may have lost bytes: the copy does not count
    closed = true;
    return copied;
  } catch (error) {
    if (!closed) {
      // The handle still names the file this call created, even when the first stat failed.
      created ??= await target
        .stat({ bigint: true })
        .then(identityOf)
        .catch(() => null);
      await target.close().catch(() => {});
    }
    if (created) await removeIfSame(to, created);
    else console.error(`could not identify the partial copy at "${to}"; left in place`);
    throw error;
  }
}

export interface PlaceOptions {
  stuck?: StuckSource;
  /** The file `from` must hold; any other file there fails the placement (ESTALE), untouched. */
  expect?: FileIdentity;
}

/**
 * Atomically put `from` at `to` only if nothing is at `to`; never replace. Resolves "taken"
 * (nothing changed) when a file is there, however it arrived. Once the bytes are at `to` and
 * its folder is flushed, the source is removed — only while it is still the file placed; when
 * that fails, `stuck` decides (see `StuckSource`).
 */
export async function placeNoReplace(
  from: string,
  to: string,
  options: PlaceOptions = {},
): Promise<Placement> {
  return (await placeNew(from, to, options)) === "taken" ? "taken" : "placed";
}

/** `placeNoReplace`, resolving the identity of the file it created at `to`. */
export async function placeNew(
  from: string,
  to: string,
  options: PlaceOptions = {},
): Promise<PlacedFile | "taken"> {
  const source = await open(from, "r");
  let sourceId: PlacedFile;
  let placed: PlacedFile | "taken";
  try {
    sourceId = identityOf(await source.stat({ bigint: true }));
    if (options.expect && !sameFile(sourceId, options.expect)) throw notTheFile(from);
    placed = await duplicateAt(source, sourceId, from, to);
  } finally {
    await source.close().catch(() => {});
  }
  if (placed === "taken") return "taken";

  // The destination must still hold what this call created before the source may go. Another
  // file there means a stranger replaced it: that is theirs, and the source keeps the bytes.
  let atDestination: PlacedFile | null;
  try {
    atDestination = await identityAt(to);
  } catch (error) {
    // Undone only by this call's own identity: a name still unreadable is left alone.
    await removeIfSame(to, placed);
    throw error;
  }
  if (!atDestination || !sameFile(atDestination, placed)) {
    console.error(`"${to}" was replaced right after placing; the source keeps the bytes`);
    return "taken";
  }

  let removal: SourceRemoval;
  try {
    await syncDir(dirname(to));
    removal = await removeSource(from, sourceId);
  } catch (error) {
    if (options.stuck === "rollback") {
      await removeIfSame(to, placed);
      throw error;
    }
    await setAside(from, sourceId, to, placed.size);
    return placed;
  }
  if (removal === "unknown" && options.stuck === "rollback") {
    // A link is undone (the file keeps its source name); a copy is the only sure copy of the
    // bytes while the source cannot be read, so both stay. Either way the caller sees it.
    if (sameFile(placed, sourceId)) await removeIfSame(to, placed);
    throw Object.assign(new Error(`Could not check "${from}" before removing it`), {
      code: "EIO",
      path: from,
    });
  }
  if (removal === "removed") await syncDir(dirname(from)).catch(() => {});
  return placed;
}

/** "kept": another file holds the source's name; "unknown": the name could not be read. */
type SourceRemoval = "removed" | "kept" | "unknown";

/**
 * Remove the placed source, only while its name still holds `identity` (captured from the
 * source's own handle). A different file there, or a name that cannot be read, is kept and
 * logged. Retries a failed unlink once; a second failure propagates.
 */
async function removeSource(path: string, identity: FileIdentity): Promise<SourceRemoval> {
  for (let attempt = 0; ; attempt += 1) {
    let now: FileIdentity | null;
    try {
      now = await identityAt(path);
    } catch (error) {
      console.error(`could not check the placed source "${path}"; kept`, error);
      return "unknown";
    }
    if (now === null) return "removed";
    if (!sameFile(now, identity)) {
      console.error(`another file took the placed source's name "${path}"; kept`);
      return "kept";
    }
    try {
      // Residual window (ADR 0033): a swap between the check above and this call is not seen.
      await unlink(path);
      return "removed";
    } catch (error) {
      if (codeOf(error) === "ENOENT") return "removed";
      if (attempt > 0) throw error;
    }
  }
}

/**
 * A placed source that cannot be removed would be swept up as a second recording. It is set
 * aside under a fresh name the sweep ignores — onto a placeholder this call created exclusively,
 * so no other file is replaced; failing that, a marker beside it (written atomically) records
 * where it was placed. Reported either way.
 */
async function setAside(
  from: string,
  identity: FileIdentity,
  to: string,
  size: bigint,
): Promise<void> {
  if (await renameAside(from, identity)) return;
  const marker: PlacementMarker = { version: 1, destination: to, size: Number(size) };
  try {
    await atomicWriteFile(`${from}${PLACED_MARKER_SUFFIX}`, JSON.stringify(marker));
    console.error(`could not remove the placed source "${from}"; marked as placed at "${to}"`);
  } catch (error) {
    console.error(`could not remove or mark the placed source "${from}"`, error);
  }
}

async function renameAside(from: string, identity: FileIdentity): Promise<boolean> {
  const aside = `${from}-${randomUUID().slice(0, 8)}${PLACED_SUFFIX}`;
  let placeholder: FileIdentity;
  try {
    const handle = await open(aside, "wx");
    try {
      placeholder = identityOf(await handle.stat({ bigint: true }));
    } finally {
      await handle.close().catch(() => {});
    }
  } catch {
    return false;
  }
  try {
    const now = await identityAt(from);
    if (now && sameFile(now, identity)) {
      await rename(from, aside); // onto this call's own empty placeholder, at a fresh name
      console.error(`could not remove the placed source; kept as "${aside}"`);
      return true;
    }
  } catch {
    // Fall through to the marker.
  }
  await removeIfSame(aside, placeholder);
  return false;
}

/** The marker `setAside` wrote for `source`, or null when there is none (or it is unreadable). */
export async function readPlacementMarker(source: string): Promise<PlacementMarker | null> {
  try {
    const value = JSON.parse(
      await readFile(`${source}${PLACED_MARKER_SUFFIX}`, "utf-8"),
    ) as PlacementMarker;
    if (
      value?.version === 1 &&
      typeof value.destination === "string" &&
      typeof value.size === "number"
    ) {
      return value;
    }
  } catch {
    // No marker.
  }
  return null;
}

/**
 * Rename a file to a name that differs from its own only by case or Unicode normalization.
 * On a case-insensitive volume both names are the same file, so neither a hard link nor an
 * exclusive create can target the new name directly: the file goes to a unique temporary
 * sibling, then to the new name, each step a `placeNoReplace` (link, or exclusive copy) with
 * rollback. A different file at `to` → "taken"; on a case-sensitive volume, where `to` is
 * simply free, this is one `placeNoReplace` with rollback.
 */
export async function renameCaseOnly(from: string, to: string): Promise<Placement> {
  const source = await identityAt(from);
  if (source === null) {
    throw Object.assign(new Error(`"${from}" does not exist`), { code: "ENOENT", path: from });
  }
  const existing = await identityAt(to);
  if (existing === null) return placeNoReplace(from, to, { stuck: "rollback" });
  if (!sameFile(existing, source)) return "taken";
  if (from === to) return "placed";

  const temp = siblingTemp(from, "case");
  const first = await placeNoReplace(from, temp, { stuck: "rollback", expect: source });
  if (first === "taken") return "taken";
  let second: Placement;
  try {
    second = await placeNoReplace(temp, to, { stuck: "rollback" });
  } catch (error) {
    await moveBack(temp, from);
    throw error;
  }
  if (second === "placed") return "placed";
  await moveBack(temp, from);
  return "taken";
}

/**
 * Second step failed: the file goes back to its old name. If even that fails (on a
 * case-insensitive volume a file that took the new name also holds the old one) it stays at
 * the temporary name, never removed, and the rename fails with an error naming it.
 */
async function moveBack(temp: string, from: string): Promise<void> {
  const back = await placeNoReplace(temp, from, { stuck: "rollback" }).catch(
    () => "failed" as const,
  );
  if (back !== "placed") {
    console.error(`case-only rename: the file could not return to its name; it is at "${temp}"`);
    throw Object.assign(new Error(`The file could not return to its name; it is at "${temp}"`), {
      code: "EIO",
      path: temp,
    });
  }
}

/**
 * A replacing move, for a destination the user confirmed replacing in the save dialog — the
 * only replacing placement. The bytes go into an exclusively created temporary sibling first
 * (linked, or copied and flushed), which then replaces `to` in one rename. A failure removes
 * only that temporary file: the existing destination and the source are untouched. The source
 * is removed once the destination holds the bytes and its folder is flushed.
 */
export async function replaceConfirmed(from: string, to: string): Promise<void> {
  const temp = siblingTemp(to, "replace");
  const source = await open(from, "r");
  let sourceId: PlacedFile;
  let placed: PlacedFile | "taken";
  try {
    sourceId = identityOf(await source.stat({ bigint: true }));
    placed = await duplicateAt(source, sourceId, from, temp);
  } finally {
    await source.close().catch(() => {});
  }
  if (placed === "taken") throw takenError(temp);
  try {
    await rename(temp, to);
  } catch (error) {
    await removeIfSame(temp, placed);
    throw error;
  }
  try {
    await syncDir(dirname(to));
    if ((await removeSource(from, sourceId)) === "removed") {
      await syncDir(dirname(from)).catch(() => {});
    }
  } catch {
    await setAside(from, sourceId, to, placed.size);
  }
}
