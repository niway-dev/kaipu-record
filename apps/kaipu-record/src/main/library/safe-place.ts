/**
 * The one way bytes are put at a vault media path (NIW2-561, ADR 0033 "Placing a file").
 *
 * Finder, a sync tool or another process can create a file at any path at any time; nothing
 * the app holds stops them. So no placement here ever replaces a file at its destination,
 * whenever that file arrived, except `replaceConfirmed`, which the save dialog's "Replace"
 * answer authorizes. Every call that creates a file removes only a file it created itself,
 * checked by identity (device + inode), never by path alone.
 */
import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import { link, lstat, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** "taken": a file already exists at the destination; nothing was replaced or moved. */
export type Placement = "placed" | "taken";

/** What happens when the bytes are placed but the source cannot be removed. */
export type StuckSource =
  /** Set the source aside (or mark it placed) and report the placement: for staging files. */
  | "set-aside"
  /** Undo the placement and fail with the removal error: for a vault file being renamed. */
  | "rollback";

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

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function sameFile(a: Pick<Stats, "dev" | "ino">, b: Pick<Stats, "dev" | "ino">): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** lstat, or null when nothing is there. Other errors propagate. */
async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return null;
    throw error;
  }
}

/** Unlink `path` only while it is still the file `identity` names. Best effort. */
async function unlinkIfSame(path: string, identity: Pick<Stats, "dev" | "ino">): Promise<void> {
  try {
    const now = await lstatOrNull(path);
    if (now && sameFile(now, identity)) await unlink(path);
  } catch {
    // Left in place: never guess.
  }
}

/** A unique sibling name for a temporary file next to `path` (hidden, not a known extension). */
export function siblingTemp(path: string, tag: string): string {
  return join(dirname(path), `.${basename(path)}.${tag}-${randomUUID().slice(0, 8)}`);
}

/**
 * Put a second name `to` on the bytes of `from`, never replacing a file at `to`; `from` stays.
 * A hard link where the volume has them; else an exclusive-create copy, flushed to disk.
 * Resolves the identity of the file created at `to`, or "taken".
 */
async function duplicateAt(from: string, to: string): Promise<Stats | "taken"> {
  try {
    await link(from, to);
    return await lstat(to);
  } catch (error) {
    const code = codeOf(error);
    if (code === "EEXIST") return "taken";
    if (!code || !NO_HARD_LINK.has(code)) throw error;
  }
  return copyExclusive(from, to);
}

/**
 * Copy `from` into a file this call creates with `wx` (EEXIST → "taken"). Every byte read is
 * written: a short write is continued, a write that makes no progress fails. Flushed before it
 * counts. Any failure removes the created file (only while it is still that file) and keeps
 * `from`.
 */
export async function copyExclusive(from: string, to: string): Promise<Stats | "taken"> {
  const source = await open(from, "r");
  try {
    let target;
    try {
      target = await open(to, "wx");
    } catch (error) {
      if (codeOf(error) === "EEXIST") return "taken";
      throw error;
    }
    let created: Stats | null = null;
    let closed = false;
    try {
      created = await target.stat();
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
      const copied = await target.stat(); // identity plus the final size
      closed = true;
      await target.close();
      return copied;
    } catch (error) {
      if (!closed) await target.close().catch(() => {});
      if (created) await unlinkIfSame(to, created);
      throw error;
    }
  } finally {
    await source.close().catch(() => {});
  }
}

/**
 * Atomically put `from` at `to` only if nothing is at `to`; never replace. Resolves "taken"
 * (nothing changed) when a file is there, however it arrived. Once the bytes are at `to`, the
 * source is removed; when that fails, `stuck` decides (see `StuckSource`).
 */
export async function placeNoReplace(
  from: string,
  to: string,
  options: { stuck?: StuckSource } = {},
): Promise<Placement> {
  const placed = await duplicateAt(from, to);
  if (placed === "taken") return "taken";
  try {
    await unlinkRetry(from);
  } catch (error) {
    if (options.stuck === "rollback") {
      await unlinkIfSame(to, placed);
      throw error;
    }
    await setAside(from, to, placed.size);
  }
  return "placed";
}

async function unlinkRetry(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return;
    await unlink(path).catch((again) => {
      if (codeOf(again) !== "ENOENT") throw again;
    });
  }
}

/**
 * A placed source that cannot be removed would be swept up as a second recording. It is set
 * aside under a name the sweep ignores; failing that, a marker beside it records where it was
 * placed, which the sweep consults. Reported either way.
 */
async function setAside(from: string, to: string, size: number): Promise<void> {
  const aside = `${from}-${randomUUID().slice(0, 8)}${PLACED_SUFFIX}`;
  try {
    await rename(from, aside); // a fresh unique name: nothing there to replace
    console.error(`could not remove the placed source; kept as "${aside}"`);
    return;
  } catch {
    // Fall through to the marker.
  }
  const marker: PlacementMarker = { version: 1, destination: to, size };
  try {
    await writeFile(`${from}${PLACED_MARKER_SUFFIX}`, JSON.stringify(marker));
    console.error(`could not remove the placed source "${from}"; marked as placed at "${to}"`);
  } catch (error) {
    console.error(`could not remove or mark the placed source "${from}"`, error);
  }
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
 * exclusive create can target the new name directly: the file goes through a unique temporary
 * sibling, its identity verified at each step. A different file at `to` → "taken"; on a
 * case-sensitive volume, where `to` is simply free, this is `placeNoReplace` with rollback.
 */
export async function renameCaseOnly(from: string, to: string): Promise<Placement> {
  const source = await lstat(from);
  const existing = await lstatOrNull(to);
  if (existing === null) return placeNoReplace(from, to, { stuck: "rollback" });
  if (!sameFile(existing, source)) return "taken";
  if (from === to) return "placed";

  const temp = siblingTemp(from, "case");
  if ((await moveExclusive(from, temp, source)) === "taken") return "taken";
  try {
    if ((await moveExclusive(temp, to, source)) === "placed") return "placed";
  } catch (error) {
    await moveBack(temp, from, source);
    throw error;
  }
  await moveBack(temp, from, source);
  return "taken";
}

/** Second step failed: the file goes back to its old name. If even that fails it stays at temp. */
async function moveBack(temp: string, from: string, source: Stats): Promise<void> {
  const back = await moveExclusive(temp, from, source).catch(() => "failed" as const);
  if (back !== "placed") {
    console.error(`case-only rename: the file could not return to its name; it is at "${temp}"`);
  }
}

/**
 * Move the file `identity` names from `from` to the free name `to`, never replacing: link then
 * unlink; without hard links, an exclusively created placeholder at `to` is replaced by the
 * file (only while the placeholder is still the one created). The result is checked to be the
 * same file before the old name is dropped.
 */
async function moveExclusive(
  from: string,
  to: string,
  identity: Pick<Stats, "dev" | "ino">,
): Promise<Placement> {
  let linked = false;
  try {
    await link(from, to);
    linked = true;
  } catch (error) {
    const code = codeOf(error);
    if (code === "EEXIST") return "taken";
    if (!code || !NO_HARD_LINK.has(code)) throw error;
  }
  if (linked) {
    const placed = await lstat(to);
    if (!sameFile(placed, identity)) {
      await unlinkIfSame(to, placed);
      throw new Error(`"${from}" is no longer the file being renamed`);
    }
    try {
      await unlink(from);
    } catch (error) {
      await unlinkIfSame(to, identity);
      throw error;
    }
    return "placed";
  }
  return renameOntoPlaceholder(from, to, identity);
}

/** `rename` onto a placeholder this call created exclusively at `to`: replaces nothing else. */
async function renameOntoPlaceholder(
  from: string,
  to: string,
  identity: Pick<Stats, "dev" | "ino">,
): Promise<Placement> {
  let placeholder: Stats;
  try {
    const handle = await open(to, "wx");
    await handle.close();
    placeholder = await lstat(to);
  } catch (error) {
    if (codeOf(error) === "EEXIST") return "taken";
    throw error;
  }
  try {
    const current = await lstat(from);
    if (!sameFile(current, identity)) {
      throw new Error(`"${from}" is no longer the file being renamed`);
    }
    const still = await lstatOrNull(to);
    if (!still || !sameFile(still, placeholder)) return "taken";
    await rename(from, to);
  } catch (error) {
    await unlinkIfSame(to, placeholder);
    throw error;
  }
  return "placed";
}

/**
 * A replacing move, for a destination the user confirmed replacing in the save dialog — the
 * only replacing placement. The bytes go into an exclusively created temporary sibling first
 * (linked, or copied and flushed), which then replaces `to` in one rename. A failure removes
 * only that temporary file: the existing destination and the source are untouched. The source
 * is removed once the destination holds the bytes.
 */
export async function replaceConfirmed(from: string, to: string): Promise<void> {
  const temp = siblingTemp(to, "replace");
  const placed = await duplicateAt(from, temp);
  if (placed === "taken") throw takenError(temp);
  try {
    await rename(temp, to);
  } catch (error) {
    await unlinkIfSame(temp, placed);
    throw error;
  }
  try {
    await unlinkRetry(from);
  } catch {
    await setAside(from, to, placed.size);
  }
}
