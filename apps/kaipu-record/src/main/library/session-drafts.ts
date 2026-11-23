/**
 * Drafts of a video edit project that could not be saved into its folder.
 *
 * A workspace may live in a synced folder, and the save of an edit project is refused while the
 * folder cannot answer for the project's export record (the file is only in the cloud, or the
 * provider does not respond). The editor keeps the edits in memory and retries, but closing its
 * window would drop every one of them. So the refused save is also written here, under the app's
 * own data folder (never a synced folder), keyed by the item's identity (its asset id, which
 * survives a rename and a move), and the next open restores it when it is newer than the project
 * on disk. A successful save removes it.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./atomic-write";

export interface DraftPayload {
  sessionJson: string;
  assets: { assetId: string; bytes: ArrayBuffer }[];
}

export interface Draft extends DraftPayload {
  savedAt: number;
}

interface DraftFile {
  version: 1;
  savedAt: number;
  sessionJson: string;
  assets: { assetId: string; base64: string }[];
}

/** The item's identity: its asset id; a record without one falls back to workspace + stem. */
export function draftKey(workspaceId: string, id: string, assetId: string | null): string {
  const identity = assetId ? `asset:${assetId}` : `stem:${workspaceId}:${id}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 40);
}

const draftPath = (dir: string, key: string): string => join(dir, `${key}.json`);

export async function writeDraft(
  dir: string,
  key: string,
  payload: DraftPayload,
  now: number = Date.now(),
): Promise<void> {
  const file: DraftFile = {
    version: 1,
    savedAt: now,
    sessionJson: payload.sessionJson,
    assets: payload.assets.map((a) => ({
      assetId: a.assetId,
      base64: Buffer.from(a.bytes).toString("base64"),
    })),
  };
  await mkdir(dir, { recursive: true });
  await atomicWriteFile(draftPath(dir, key), JSON.stringify(file));
}

/** The draft for `key`, or null when there is none or it is not a readable draft. */
export async function readDraft(dir: string, key: string): Promise<Draft | null> {
  try {
    const file = JSON.parse(await readFile(draftPath(dir, key), "utf-8")) as Partial<DraftFile>;
    if (
      file.version !== 1 ||
      typeof file.savedAt !== "number" ||
      typeof file.sessionJson !== "string" ||
      !Array.isArray(file.assets)
    ) {
      return null;
    }
    return {
      savedAt: file.savedAt,
      sessionJson: file.sessionJson,
      assets: file.assets.map((a) => {
        const buf = Buffer.from(a.base64, "base64");
        return {
          assetId: a.assetId,
          bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
        };
      }),
    };
  } catch {
    return null;
  }
}

export async function removeDraft(dir: string, key: string): Promise<void> {
  await rm(draftPath(dir, key), { force: true });
}
