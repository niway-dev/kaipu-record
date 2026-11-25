/**
 * The editing axis for one library item — whether an editor session can be
 * opened for a local recording, and whether it is still safe to open.
 * Deliberately cheap: `stat`/existence checks only, no hashing — `list()` calls
 * this for every item, and hashing is lazy elsewhere (`LibraryVault.ensureContentHash`).
 */
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EditingState } from "@shared/types/library-item";
import { webcamTrackState, type WebcamState } from "./webcam-track-state";
import { sessionMetaPath, type SessionMeta } from "./video-edit-session";

/** How a session meta file is read; a synced workspace passes its bounded reader. */
type ReadText = (path: string) => Promise<string>;

const readUtf8: ReadText = (path) => readFile(path, "utf-8");

/**
 * The provider could not hand the file over right now: it is offloaded (`EVICTED`) or the
 * bounded read gave up (`ETIMEDOUT`). The answer is unknown, which is not a damaged file.
 */
function isUnavailableNow(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "EVICTED" || code === "ETIMEDOUT";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function hasEditSession(vaultDir: string, id: string): Promise<boolean> {
  return exists(join(vaultDir, ".kaipu", `${id}.edit.json`));
}

/**
 * The editing axis for one local item. `local` is the item's local-copy view
 * (or `null` when there is no local file). Never hashes: a session is
 * considered fresh when the source's size + mtime still match what was
 * recorded at save time and every referenced asset file still exists.
 */
export async function probeEditing(
  vaultDir: string,
  local: { id: string; filePath: string; derivedFromAssetId: string | null } | null,
  /** How `.edit.meta.json` is read: a synced workspace passes its bounded reader (never a bare read). */
  readText: ReadText = readUtf8,
): Promise<EditingState> {
  if (!local) return "needs-source";
  if (!(await hasEditSession(vaultDir, local.id))) {
    return local.derivedFromAssetId ? "exported-only" : "project-available";
  }
  const metaPath = sessionMetaPath(vaultDir, local.id);
  if (!(await exists(metaPath))) {
    // A session saved before this branch has `.edit.json` but no `.edit.meta.json` —
    // there is nothing to compare the source against, so trust the session rather
    // than reporting a false "missing-dependencies" for every pre-existing project.
    return "project-available";
  }
  let meta: SessionMeta;
  try {
    meta = JSON.parse(await readText(metaPath)) as SessionMeta;
  } catch (error) {
    // Offloaded or stalled: nothing to compare the source against, so trust the session, as
    // for a meta that was never written. Unknown counts as fine; only a file that was read
    // and is damaged is a problem.
    if (isUnavailableNow(error)) return "project-available";
    // Present but unreadable/corrupt: unlike the absent case above, this is a real
    // problem with a file that should exist and be trustworthy.
    return "missing-dependencies";
  }
  let info;
  try {
    info = await stat(local.filePath);
  } catch {
    return "needs-source";
  }
  if (info.size !== meta.sourceSizeBytes || info.mtimeMs !== meta.sourceMtimeMs)
    return "missing-dependencies";
  for (const assetId of meta.assetIds) {
    if (!(await exists(join(vaultDir, ".kaipu", `${local.id}.assets`, `${assetId}.png`)))) {
      return "missing-dependencies";
    }
  }
  return "project-available";
}

export type { WebcamState } from "./webcam-track-state";

/**
 * The webcam track of one item (ADR 0037), by the rule `describe()` shares
 * (`webcamTrackState`): "present" while `.kaipu/<id>.webcam.mp4` exists, "missing" when the
 * sidecar recorded a webcam but the file is gone, "none" for a recording that never had one.
 * Read-only; never touches the video.
 */
export async function probeWebcam(
  vaultDir: string,
  id: string,
  /** How the sidecar is read: a synced workspace passes its bounded reader (never a bare read). */
  readText: ReadText = readUtf8,
): Promise<WebcamState> {
  const fileExists = await exists(join(vaultDir, ".kaipu", `${id}.webcam.mp4`));
  // The file alone makes it "present": the sidecar is only read when it is not there.
  if (fileExists) return webcamTrackState(true, undefined).state;
  let sidecarWebcam: unknown;
  try {
    const sidecar = JSON.parse(await readText(join(vaultDir, ".kaipu", `${id}.json`)));
    sidecarWebcam = sidecar?.webcam;
  } catch {
    sidecarWebcam = undefined;
  }
  return webcamTrackState(false, sidecarWebcam).state;
}

/** When the session was last written, and which of those writes has been exported. */
export interface EditSessionState {
  /** Epoch ms of the last session write, or null with no session/meta sidecar. */
  savedAt: number | null;
  /** The `savedAt` that was burned into an export, or null if none ever was. */
  exportedSavedAt: number | null;
}

const NO_SESSION: EditSessionState = { savedAt: null, exportedSavedAt: null };

/**
 * The session's save/export stamps for one item. Read-only, like `probeEditing`, and
 * one read for both values — `list()` runs this per item, so a second open of the
 * same sidecar would double the syscalls for nothing.
 *
 * The library badge compares the two for equality. It deliberately does NOT compare
 * `savedAt` against the exports' `createdAt`: see `SessionMeta.exportedSavedAt` for
 * why that comparison could never be right.
 */
export async function probeEditSession(
  vaultDir: string,
  id: string,
  /** How `.edit.meta.json` is read: a synced workspace passes its bounded reader (never a bare read). */
  readText: ReadText = readUtf8,
): Promise<EditSessionState> {
  if (!(await hasEditSession(vaultDir, id))) return NO_SESSION;
  try {
    const meta = JSON.parse(await readText(sessionMetaPath(vaultDir, id))) as SessionMeta;
    return {
      savedAt: typeof meta.savedAt === "number" ? meta.savedAt : null,
      // Sessions written before the stamp existed have no field here. Reading that as
      // null means a pre-existing edited recording shows "not exported" until its next
      // export — the honest answer, since nothing recorded that it ever was.
      exportedSavedAt: typeof meta.exportedSavedAt === "number" ? meta.exportedSavedAt : null,
    };
  } catch {
    return NO_SESSION;
  }
}

/**
 * When the item's transcript file was last written (epoch ms), or null when there is none.
 * One `stat`, no read and no parse: `list()` runs this per item, and whether a transcript is
 * valid is the reader's concern. Any stat error reads as "no transcript" so a vault the
 * list can still open never fails because of this one probe.
 */
export async function probeTranscribedAt(vaultDir: string, id: string): Promise<number | null> {
  try {
    const info = await stat(join(vaultDir, ".kaipu", `${id}.transcript.json`));
    return info.isFile() ? Math.trunc(info.mtimeMs) : null;
  } catch {
    return null;
  }
}
