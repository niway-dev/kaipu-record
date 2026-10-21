import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { LibraryVault } from "../library/library-vault";
import { STAGING_DIR, moveFile, timestampId } from "./recording-writer";

const PART_RE = /^kaipu-rec-.+\.mp4\.part$/;
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
  /** Empty files removed. */
  discarded: number;
  /** Paths left in place (unreadable, unmovable). */
  failed: string[];
}

/**
 * Moves finished-but-stranded takes (`kaipu-rec-*.mp4.part`) into the vault as
 * recovered recordings. A part left by a renderer crash mid-take has no moov and
 * will not play; the title promises nothing, and the user can delete it.
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
    for (const name of names.filter((n) => PART_RE.test(n))) {
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs < MIN_AGE_MS) continue;
        if (info.size === 0) {
          await unlink(path);
          result.discarded += 1;
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
      } catch {
        result.failed.push(path);
      }
    }
  }
  return result;
}
