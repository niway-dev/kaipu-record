/**
 * Import an outside video into the vault (NIW2-579). The source is only ever read
 * (ADR 0003): its bytes are copied into the vault and the copy becomes a normal recording
 * item — `<id><ext>` plus a sidecar — exactly the layout `RecordingWriter.finalize` leaves.
 *
 * Pure Node, no Electron: the IPC wiring and the file dialog live in `./index.ts`.
 */
import { basename, extname, isAbsolute, join, relative } from "node:path";
import {
  access,
  constants,
  copyFile,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { ALL_FORMATS, FilePathSource, Input } from "mediabunny";
import {
  importableVideoExtension,
  MAX_IMPORT_FILES,
  type ImportableVideoExtension,
  type ImportVideoFailure,
  type ImportVideoFailureReason,
  type ImportVideoResult,
} from "@shared/import-video";
import type { LocalRecording } from "@shared/types/library-storage";
import { uniqueTempPath, withLock } from "./atomic-write";
import { LibraryVault } from "./library-vault";

/** What the vault stores about an imported video, read from its container. */
export interface VideoProbe {
  durationSeconds: number;
  width: number;
  height: number;
}

export type VideoProbeResult = VideoProbe | "unreadable" | "no-video-track";
export type ProbeVideo = (path: string) => Promise<VideoProbeResult>;

/**
 * Demux-level probe with mediabunny (already the app's media library; it reads files in
 * Node, no decoder needed). Rejects what cannot be parsed, a container without a video
 * track, and a video track whose codec mediabunny does not recognise. Whether the codec
 * also *decodes* on this machine is only known in the renderer (WebCodecs).
 */
export async function probeVideoFile(path: string): Promise<VideoProbeResult> {
  const input = new Input({ source: new FilePathSource(path), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || track.codec === null) return "no-video-track";
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) return "unreadable";
    return {
      // Floored like the recorder does; a sub-second clip still reads as 1 s, not "unknown".
      durationSeconds: Math.max(1, Math.floor(duration)),
      width: Math.max(0, Math.round(track.displayWidth)),
      height: Math.max(0, Math.round(track.displayHeight)),
    };
  } catch {
    return "unreadable";
  } finally {
    input.dispose();
  }
}

export interface ImportVideoDeps {
  vaultDir: () => string;
  /** The id stem for an item imported at `now`; a numeric suffix is added on a clash. */
  newId: (now: number) => string;
  now?: () => number;
  probe?: ProbeVideo;
}

type ValidatedSource =
  | { ok: true; path: string; ext: ImportableVideoExtension }
  | { ok: false; reason: ImportVideoFailureReason };

/** Whether `path` is `dir` or under it, comparing real paths (symlinks, /var → /private/var). */
async function isInside(path: string, dir: string): Promise<boolean> {
  const real = async (p: string): Promise<string> => realpath(p).catch(() => p);
  const rel = relative(await real(dir), await real(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * A path from the renderer is untrusted: it must be an absolute path to an existing
 * regular file with an importable extension, and readable. Nothing else is opened.
 * A file already in the vault (`vaultDir`) is refused: it is in the Library already —
 * a card dragged out and dropped back would otherwise come in twice.
 */
export async function validateImportSource(
  path: string,
  vaultDir?: string,
): Promise<ValidatedSource> {
  if (!isAbsolute(path)) return { ok: false, reason: "not-found" };
  const ext = importableVideoExtension(basename(path));
  if (!ext) return { ok: false, reason: "unsupported-type" };
  let info;
  try {
    info = await stat(path);
  } catch {
    return { ok: false, reason: "not-found" };
  }
  if (!info.isFile()) return { ok: false, reason: "not-a-file" };
  if (vaultDir && (await isInside(path, vaultDir))) {
    return { ok: false, reason: "already-in-library" };
  }
  try {
    await access(path, constants.R_OK);
  } catch {
    return { ok: false, reason: "copy-failed" };
  }
  return { ok: true, path, ext };
}

/** The title an imported item starts with: the source's name without its extension. */
export function importTitle(path: string): string {
  const name = basename(path, extname(path)).trim();
  return name.length > 0 ? name : basename(path);
}

/** Copy, then fsync, so a crash after the rename never lists a file with missing bytes. */
async function copyDurably(source: string, target: string): Promise<void> {
  // FICLONE: a copy-on-write clone where the volume supports it (APFS), a plain copy elsewhere.
  await copyFile(source, target, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
  const handle = await open(target, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Pick a free id and move the staged copy in under it. Under a per-vault lock so two
 * imports in the same second never pick the same id. The sidecar is written first: a
 * sidecar without media is never listed, while media without its sidecar would be.
 */
async function commitImport(
  vault: LibraryVault,
  staged: string,
  ext: ImportableVideoExtension,
  stem: string,
  meta: { title: string; createdAt: number; probe: VideoProbe },
): Promise<string> {
  return withLock(`import:${vault.directory}`, async () => {
    let id = stem;
    for (let n = 2; (await vault.hasMedia(id)) || (await exists(vault.sidecarPath(id))); n++) {
      id = `${stem}-${n}`;
    }
    await vault.writeMeta(id, {
      title: meta.title,
      durationSeconds: meta.probe.durationSeconds,
      createdAt: meta.createdAt,
      derivedFromAssetId: null,
      capture: {
        mode: "import",
        width: meta.probe.width,
        height: meta.probe.height,
        ratio: null,
      },
    });
    try {
      await rename(staged, join(vault.directory, `${id}${ext}`));
    } catch (error) {
      await rm(vault.sidecarPath(id), { force: true }).catch(() => {});
      throw error;
    }
    return id;
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Import one file. Resolves to the new item or the reason it was refused; never throws.
 * Whatever fails, nothing is left in the vault: the copy is staged under a `.part` name
 * (never listed) and removed on every error path.
 */
export async function importVideoFile(
  path: string,
  deps: ImportVideoDeps,
): Promise<LocalRecording | ImportVideoFailureReason> {
  const vault = new LibraryVault(deps.vaultDir());
  const source = await validateImportSource(path, vault.directory);
  if (!source.ok) return source.reason;

  const probe = deps.probe ?? probeVideoFile;
  const now = (deps.now ?? Date.now)();
  let staged: string | null = null;
  let id: string | null = null;
  try {
    await mkdir(vault.directory, { recursive: true });
    staged = uniqueTempPath(join(vault.directory, `import${source.ext}`), "part");
    await copyDurably(source.path, staged);
    // Probe the copy, not the source: what was checked is exactly what the vault keeps.
    const probed = await probe(staged);
    if (probed === "unreadable" || probed === "no-video-track") {
      await rm(staged, { force: true }).catch(() => {});
      return probed;
    }
    id = await commitImport(vault, staged, source.ext, deps.newId(now), {
      title: importTitle(source.path),
      createdAt: now,
      probe: probed,
    });
    staged = null;
    const described = await vault.describe(id);
    if (!described) throw new Error(`Imported item "${id}" not found in the vault`);
    return described;
  } catch {
    if (staged) await rm(staged, { force: true }).catch(() => {});
    if (id) await vault.remove(id).catch(() => {});
    return "copy-failed";
  }
}

/**
 * Import a batch, one file at a time (each can be gigabytes). One file failing never
 * stops the others. `paths` crossed IPC, so anything that is not a string list is
 * refused here rather than trusted.
 */
export async function importVideoFiles(
  paths: unknown,
  deps: ImportVideoDeps,
): Promise<ImportVideoResult> {
  const result: ImportVideoResult = { imported: [], failed: [], canceled: false };
  if (!Array.isArray(paths)) return result;
  const strings = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  for (const [index, path] of strings.entries()) {
    const outcome =
      index < MAX_IMPORT_FILES ? await importVideoFile(path, deps) : ("too-many" as const);
    if (typeof outcome === "string") result.failed.push(failure(path, outcome));
    else result.imported.push(outcome);
  }
  return result;
}

function failure(path: string, reason: ImportVideoFailureReason): ImportVideoFailure {
  return { fileName: basename(path), reason };
}
