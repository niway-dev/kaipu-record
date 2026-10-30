import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LibraryVault } from "../library/library-vault";
import { STAGING_DIR, moveFile, timestampId } from "./recording-writer";

const PART_RE = /^kaipu-rec-.+\.mp4\.part$/;
const WEBCAM_PART_RE = /^kaipu-rec-.+\.webcam\.mp4\.part$/;
/** The webcam part staged beside a screen part of the same take (ADR 0032). */
const webcamPartFor = (screenPart: string): string =>
  screenPart.replace(/\.mp4\.part$/, ".webcam.mp4.part");
const MIN_AGE_MS = 2 * 60_000; // another instance may still be writing a fresh file

export interface SweepDeps {
  vaultDir: string;
  /** os.tmpdir() in production: where takes land when the vault staging folder is unavailable. */
  fallbackTempDir: string;
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
  for (const dir of [join(deps.vaultDir, STAGING_DIR), deps.fallbackTempDir]) {
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
        const base = `${timestampId(info.mtimeMs)}-recovered`;
        let id = base;
        for (let n = 2; await vault.hasMedia(id); n += 1) id = `${base}-${n}`;
        await moveFile(path, await vault.filePath(id));
        await vault.writeMeta(id, {
          title: deps.title,
          createdAt: info.mtimeMs,
          derivedFromAssetId: null,
        });
        result.recovered.push(id);
        if (webcamPath) {
          await mkdir(dirname(vault.webcamFilePath(id)), { recursive: true });
          // Best-effort: the screen file is the take. A webcam left behind is lone next time.
          await moveFile(webcamPath, vault.webcamFilePath(id)).catch((error) =>
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
  }
  return result;
}
