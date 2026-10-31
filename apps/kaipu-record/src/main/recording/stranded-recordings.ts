import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LibraryVault } from "../library/library-vault";
import { defaultCaptureName } from "@shared/default-capture-name";
import { PLACED_MARKER_SUFFIX, placeNoReplace, readPlacementMarker } from "../library/safe-place";
import { STAGING_DIR, placeTake, webcamPartFor } from "./recording-writer";

const PART_RE = /^kaipu-rec-.+\.mp4\.part$/;
const WEBCAM_PART_RE = /^kaipu-rec-.+\.webcam\.mp4\.part$/;
const MARKER_RE = /^kaipu-rec-.+\.mp4\.part\.placed\.json$/;
/**
 * `<vault>/.kaipu/tmp/placed-parts/`: where a staging part whose bytes are already in the
 * vault is kept, out of the sweep's way. Never deleted by the app.
 */
export const PLACED_PARTS_DIR = "placed-parts";
const MIN_AGE_MS = 2 * 60_000; // another instance may still be writing a fresh file

export interface SweepDeps {
  vaultDir: string;
  /**
   * os.tmpdir() in production: where takes land when the vault staging folder is unavailable.
   * Swept once, with the active workspace; the other workspaces sweep only their own staging.
   */
  fallbackTempDir?: string;
  /** Title written to each recovered take's sidecar (localized by the caller). */
  title: string;
  now?: () => number;
}

export interface SweepResult {
  /** Recording ids now in the vault. */
  recovered: string[];
  /** Empty files removed, and webcam parts without their screen part. */
  discarded: number;
  /** Paths left in place (unreadable, unmovable). */
  failed: string[];
}

/**
 * Moves finished-but-stranded takes (`kaipu-rec-*.mp4.part`) into the vault as
 * recovered recordings. A part left by a renderer crash mid-take has no moov and
 * will not play; the title promises nothing, and the user can delete it.
 *
 * A take's webcam part (`kaipu-rec-*.webcam.mp4.part`) goes with its screen part, to
 * `.kaipu/<id>.webcam.mp4`. Its start offset was never written, so the sidecar gets no
 * `webcam` field: the recovered take reads as one without a webcam rather than with a wrong
 * offset. A webcam part whose screen part is gone is no take, and is deleted.
 */
export async function recoverStrandedRecordings(deps: SweepDeps): Promise<SweepResult> {
  const now = (deps.now ?? Date.now)();
  const vault = new LibraryVault(deps.vaultDir);
  const result: SweepResult = { recovered: [], discarded: 0, failed: [] };
  const dirs = [
    join(deps.vaultDir, STAGING_DIR),
    ...(deps.fallbackTempDir ? [deps.fallbackTempDir] : []),
  ];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // vault unplugged or no staging folder yet: try again next launch
    }
    const present = new Set(names);
    for (const name of names.filter((n) => PART_RE.test(n) && !WEBCAM_PART_RE.test(n))) {
      const path = join(dir, name);
      const webcamPath = present.has(webcamPartFor(name)) ? join(dir, webcamPartFor(name)) : null;
      try {
        const info = await stat(path);
        if (now - info.mtimeMs < MIN_AGE_MS) continue;
        // Placed in the vault, but its staging file could not be removed (`safe-place`). The
        // marker only stops a second recovery: the destination may hold another file by now,
        // so the part is kept, never deleted.
        if (await placedElsewhere(path, info.size)) {
          if (dir !== deps.fallbackTempDir) await retainPlaced(dir, name);
          continue;
        }
        if (info.size === 0) {
          await unlink(path);
          result.discarded += 1;
          if (
            webcamPath &&
            (await unlink(webcamPath).then(
              () => true,
              () => false,
            ))
          ) {
            result.discarded += 1;
          }
          continue;
        }
        const reservation = await vault.reserve({
          kind: "recording",
          title: deps.title,
          createdAt: info.mtimeMs,
          stem: `${defaultCaptureName("recording", new Date(info.mtimeMs))} (recovered)`,
        });
        const { id } = reservation;
        try {
          await placeTake(path, await vault.filePath(id));
        } catch (error) {
          // Release the reserved stem (its stub sidecar), never the media path: a file that
          // took it meanwhile is not this take's.
          await vault.releaseReservation(reservation).catch(() => {});
          throw error;
        }
        await vault.writeMeta(id, { derivedFromAssetId: null });
        await unlink(`${path}${PLACED_MARKER_SUFFIX}`).catch(() => {}); // a stale one, if any
        result.recovered.push(id);
        if (webcamPath) {
          const webcamDest = vault.webcamFilePath(id);
          await mkdir(dirname(webcamDest), { recursive: true });
          // Best-effort: the screen file is the take. A webcam left behind is lone next time.
          await placeTake(webcamPath, webcamDest).catch((error) =>
            console.error("recovering a webcam part failed", error),
          );
        }
      } catch {
        result.failed.push(path);
      }
    }
    // Webcam parts whose screen part is gone (the take was aborted or already recovered).
    for (const name of names.filter((n) => WEBCAM_PART_RE.test(n))) {
      if (present.has(name.replace(/\.webcam\.mp4\.part$/, ".mp4.part"))) continue;
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs < MIN_AGE_MS) continue;
        await unlink(path);
        result.discarded += 1;
      } catch {
        result.failed.push(path);
      }
    }
    await dropLoneMarkers(dir, names);
  }
  return result;
}

/** Move a placed part into `placed-parts/` (never replacing); left where it is on failure. */
async function retainPlaced(dir: string, name: string): Promise<void> {
  const keep = join(dir, PLACED_PARTS_DIR);
  try {
    await mkdir(keep, { recursive: true });
    const moved = await placeNoReplace(join(dir, name), join(keep, name), { stuck: "rollback" });
    if (moved === "placed") await unlink(join(dir, `${name}${PLACED_MARKER_SUFFIX}`));
  } catch {
    // Still marked: skipped again on the next launch.
  }
}

/** A marker whose part is gone marks nothing: removed (only the marker, the app's own file). */
async function dropLoneMarkers(dir: string, names: string[]): Promise<void> {
  for (const name of names.filter((n) => MARKER_RE.test(n))) {
    const part = name.slice(0, -PLACED_MARKER_SUFFIX.length);
    try {
      await stat(join(dir, part));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") continue;
      await unlink(join(dir, name)).catch(() => {});
    }
  }
}

/**
 * Whether an explicit placement marker says this staging file's bytes are already in the
 * vault: the marker exists, and its destination exists with the same size. A link count is no
 * proof (another app can hard-link a file anywhere), so only the marker counts; anything less
 * recovers the take as before.
 */
async function placedElsewhere(path: string, size: number): Promise<boolean> {
  const marker = await readPlacementMarker(path);
  if (!marker || marker.size !== size) return false;
  try {
    return (await stat(marker.destination)).size === size;
  } catch {
    return false;
  }
}
