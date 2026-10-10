/**
 * Saves an exported animated GIF into the vault (NIW2-217). Pure fs (no Electron) so it is
 * testable against a temp folder; the IPC handler in `./index.ts` wires the deps.
 *
 * The renderer only sends bytes + metadata — never a path. The bytes are refused when they
 * are not a GIF89a file or are over the hard cap, so a compromised renderer cannot use the
 * channel to drop arbitrary files into the vault.
 */
import type { LocalRecording } from "@shared/types/library-storage";
import type { GifSaveMeta } from "@shared/types/ipc";
import { LibraryVault } from "./library-vault";

/** Hard cap on a GIF payload (IPC safety). Mirrors `GIF_HARD_CAP_BYTES` in the renderer. */
export const GIF_MAX_BYTES = 64 * 1024 * 1024;

const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

export class GifSaveError extends Error {
  constructor(readonly code: "too-large" | "not-gif" | "empty") {
    super(`gif-save: ${code}`);
  }
}

export function validateGifBytes(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) throw new GifSaveError("empty");
  if (bytes.byteLength > GIF_MAX_BYTES) throw new GifSaveError("too-large");
  if (bytes.byteLength < GIF89A.length || GIF89A.some((b, i) => bytes[i] !== b)) {
    throw new GifSaveError("not-gif");
  }
}

export interface GifSaveDeps {
  vaultDir: () => string;
  newId: () => string;
  now?: () => number;
}

export async function saveGif(
  deps: GifSaveDeps,
  data: ArrayBuffer | Uint8Array,
  meta: GifSaveMeta,
): Promise<LocalRecording> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  validateGifBytes(bytes);
  const vault = new LibraryVault(deps.vaultDir());
  const id = deps.newId();
  await vault.writeGif(id, bytes);
  try {
    await vault.writeMeta(id, {
      title: meta.title,
      durationSeconds: meta.durationSeconds,
      createdAt: (deps.now ?? Date.now)(),
      derivedFromAssetId: meta.derivedFromAssetId ?? null,
      gifWidth: meta.width,
      gifHeight: meta.height,
      gifFps: meta.fps,
    });
    if (meta.thumbnail) await vault.writeThumbnail(id, Buffer.from(meta.thumbnail));
  } catch (error) {
    // No half-saved item: the GIF without its sidecar would list with a wrong title.
    await vault.remove(id).catch(() => {});
    throw error;
  }
  const recording = await vault.describe(id);
  if (!recording) throw new Error(`Saved GIF "${id}" not found in vault`);
  return recording;
}
