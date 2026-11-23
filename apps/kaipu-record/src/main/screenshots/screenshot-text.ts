import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  recognizedWordsSchema,
  type RecognizedWord,
  type TextRecognizer,
} from "@kaipu/domain/schemas";
import { CANVAS_ASSET_ID_PATTERN, type CanvasSavePayload } from "@shared/types/screenshot-canvas";
import type {
  TextCacheSavePayload,
  TextRecognitionRequest,
  TextRecognitionResult,
} from "@shared/types/text-recognition";
import { atomicWriteFile, withLock } from "../library/atomic-write";
import { withItemLock } from "../library/item-lock";
import { isPlainItemId, type LibraryVault } from "../library/library-vault";

/**
 * The recognized-text cache beside a screenshot (ADR 0055): `.kaipu/<id>.text.json`, keyed by
 * asset id and by the sha256 of the PNG bytes that were recognized, so a changed asset is
 * recognized again. The file is only ever a cache: anything invalid is a miss, never an error.
 */

/** Largest cache file main reads or writes. */
export const TEXT_CACHE_MAX_BYTES = 8 * 1024 * 1024;
/** Largest PNG a recognition request may carry. */
export const TEXT_RECOGNITION_MAX_PNG_BYTES = 256 * 1024 * 1024;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface TextCacheEntry {
  sha256: string;
  words: RecognizedWord[];
}
export type TextCacheAssets = Record<string, TextCacheEntry>;

type VaultSource = LibraryVault | (() => LibraryVault);
const resolveVault = (source: VaultSource): LibraryVault =>
  typeof source === "function" ? source() : source;

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const itemKey = (vault: LibraryVault, id: string): string =>
  `${vault.workspaceId ?? vault.directory}\u0000${id}`;

/**
 * Per-item generation: bumped by every save, so an older recognition is stale. A rename, move
 * or delete is covered by the item lock in `cacheRecognition`, not by this counter.
 */
const generations = new Map<string, number>();

/** The item's current generation. A recognition reads it before it starts. */
export function textGeneration(vault: LibraryVault, id: string): number {
  return generations.get(itemKey(vault, id)) ?? 0;
}

/** Marks every recognition started so far for this item as stale. */
export function bumpTextGeneration(vault: LibraryVault, id: string): void {
  const key = itemKey(vault, id);
  generations.set(key, (generations.get(key) ?? 0) + 1);
}

const lockKey = (vault: LibraryVault, id: string): string =>
  `text-cache\u0000${itemKey(vault, id)}`;

/** The cache's valid entries; a missing, oversized, corrupt or off-schema file is `{}`. */
export async function readTextCache(vault: LibraryVault, id: string): Promise<TextCacheAssets> {
  try {
    const path = vault.companionPaths(id).textCache;
    const info = await stat(path);
    if (!info.isFile() || info.size > TEXT_CACHE_MAX_BYTES) return {};
    const file = JSON.parse(await readFile(path, "utf-8")) as {
      schemaVersion?: unknown;
      assets?: unknown;
    } | null;
    if (file?.schemaVersion !== 1) return {};
    if (typeof file.assets !== "object" || file.assets === null || Array.isArray(file.assets)) {
      return {};
    }
    const out: TextCacheAssets = {};
    for (const [assetId, raw] of Object.entries(file.assets)) {
      if (!CANVAS_ASSET_ID_PATTERN.test(assetId)) continue;
      const entry = raw as { sha256?: unknown; words?: unknown } | null;
      if (typeof entry?.sha256 !== "string" || !SHA256_HEX.test(entry.sha256)) continue;
      const words = recognizedWordsSchema.safeParse(entry.words);
      if (words.success) out[assetId] = { sha256: entry.sha256, words: words.data };
    }
    return out;
  } catch {
    return {};
  }
}

async function writeAssets(
  vault: LibraryVault,
  id: string,
  assets: TextCacheAssets,
): Promise<void> {
  const path = vault.companionPaths(id).textCache;
  const json = JSON.stringify({ schemaVersion: 1, assets });
  if (Buffer.byteLength(json, "utf-8") > TEXT_CACHE_MAX_BYTES) {
    await rm(path, { force: true });
    return;
  }
  await atomicWriteFile(path, json);
}

/**
 * Rewrites the cache after a save. Called after the canvas write. The new file holds exactly
 * the payload's assets, each hashed from the bytes of the asset of the same id in the canvas
 * payload, so a word the renderer removed (a redaction) cannot survive. Without a text
 * payload, a canvas, or a canvas that was stored, the file is deleted. Never throws.
 */
export async function saveTextCache(
  vault: LibraryVault,
  id: string,
  text: TextCacheSavePayload | undefined,
  canvas: CanvasSavePayload | undefined,
): Promise<void> {
  // Bumped before anything awaits: a recognition that finishes from here on is stale.
  bumpTextGeneration(vault, id);
  try {
    await withLock(lockKey(vault, id), async () => {
      const path = vault.companionPaths(id).textCache;
      const canvasStored = canvas
        ? await stat(vault.companionPaths(id).canvasDoc).then(
            (info) => info.isFile(),
            () => false,
          )
        : false;
      if (!text || !Array.isArray(text.assets) || !canvas || !canvasStored) {
        await rm(path, { force: true });
        return;
      }
      const pngs = new Map<string, Uint8Array>();
      for (const asset of canvas.assets ?? []) pngs.set(asset.assetId, new Uint8Array(asset.png));
      const assets: TextCacheAssets = {};
      for (const entry of text.assets) {
        if (typeof entry?.assetId !== "string" || !CANVAS_ASSET_ID_PATTERN.test(entry.assetId)) {
          continue;
        }
        const png = pngs.get(entry.assetId);
        const words = recognizedWordsSchema.safeParse(entry.words);
        if (!png || !words.success) continue;
        assets[entry.assetId] = { sha256: sha256Hex(png), words: words.data };
      }
      await writeAssets(vault, id, assets);
    });
  } catch (error) {
    console.warn(`screenshot text: could not store the cache for ${id}`, error);
    await rm(vault.companionPaths(id).textCache, { force: true }).catch(() => {});
  }
}

export interface RecognizeDeps {
  vault: VaultSource;
  recognizer: TextRecognizer;
}

const inFlight = new Map<string, Promise<RecognizedWord[] | "unavailable">>();

const toBytes = (png: unknown): Uint8Array | null => {
  if (png instanceof ArrayBuffer) return new Uint8Array(png);
  if (ArrayBuffer.isView(png)) return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
  return null;
};

/**
 * The sha256 of the bytes the asset has on disk right now, or null when it cannot be known.
 * A canvas asset is `.kaipu/<id>.assets/<assetId>.png`. Only `base` of an item without a
 * stored canvas document is the media file itself; with a canvas document the assets folder
 * is the truth, so a missing asset file means "unknown", never the flat PNG (which a canvas
 * save does not keep in step with a redaction).
 */
async function onDiskSha256(
  vault: LibraryVault,
  id: string,
  assetId: string,
): Promise<string | null> {
  const paths = vault.companionPaths(id);
  const missing = (error: unknown): boolean =>
    ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException)?.code ?? "");
  try {
    // An offloaded asset is not hashed (that would download it): the catch below treats the
    // refusal as "unknown", so no cache is judged.
    return sha256Hex(await vault.readLocalFile(join(paths.assetsDir, `${assetId}.png`)));
  } catch (error) {
    if (!missing(error)) return null;
  }
  if (assetId !== "base") return null;
  try {
    await stat(paths.canvasDoc);
    return null;
  } catch (error) {
    if (!missing(error)) return null;
  }
  try {
    // An offloaded PNG is not hashed (that would download it): no hash, so no cache is judged.
    return sha256Hex(await vault.readLocalFile(await vault.filePath(id)));
  } catch {
    return null;
  }
}

/**
 * Stores a recognition's words. The whole check-then-write runs under the item lock, the one
 * a delete, a rename, a move and a screenshot overwrite also hold (ADR 0033, decision 12), so
 * none of them can complete between "the item exists and the bytes match" and the write:
 * a recognition can never recreate `.kaipu/<old-id>.text.json` for an item that is gone, and
 * never writes over an asset a save replaced meanwhile. Lock order is item lock, then the
 * text lock (the same order as an overwrite save, which takes the text lock inside its item
 * lock); the text lock stays because a new screenshot's save takes it without the item lock.
 * The recognizer itself runs before this, outside every lock.
 */
async function cacheRecognition(
  vault: LibraryVault,
  id: string,
  assetId: string,
  sha256: string,
  words: RecognizedWord[],
  startedAt: number,
): Promise<void> {
  await withItemLock(vault.workspaceId ?? vault.directory, id, () =>
    withLock(lockKey(vault, id), async () => {
      // A save since the start means these words may be stale or hidden ones.
      if (textGeneration(vault, id) !== startedAt) return;
      // A rename, move or delete took the item away: never write under its old id.
      if (!(await vault.hasMedia(id))) return;
      // The words belong to the bytes the caller held, which may be older than the asset: a
      // window that kept the unredacted image open can ask after another window saved a
      // redaction. Only the image on disk right now may be cached.
      if ((await onDiskSha256(vault, id, assetId)) !== sha256) return;
      const assets = await readTextCache(vault, id);
      assets[assetId] = { sha256, words };
      await writeAssets(vault, id, assets);
    }),
  );
}

/**
 * Recognizes the text of one canvas asset, answering from the cache when the same bytes were
 * recognized before. Never rejects: anything wrong is "unavailable".
 */
export async function recognizeScreenshotText(
  deps: RecognizeDeps,
  request: TextRecognitionRequest,
): Promise<TextRecognitionResult> {
  const unavailable: TextRecognitionResult = { status: "unavailable" };
  try {
    const { id, assetId } = request ?? {};
    if (typeof assetId !== "string" || !CANVAS_ASSET_ID_PATTERN.test(assetId)) return unavailable;
    if (id !== null && (typeof id !== "string" || !isPlainItemId(id))) return unavailable;
    const png = toBytes(request.png);
    if (!png || png.byteLength === 0 || png.byteLength > TEXT_RECOGNITION_MAX_PNG_BYTES) {
      return unavailable;
    }
    const vault = resolveVault(deps.vault);
    const sha256 = sha256Hex(png);

    // Before any await: a save that lands from here on makes this recognition stale.
    const startedAt = id === null ? 0 : textGeneration(vault, id);
    if (id !== null) {
      const hit = (await readTextCache(vault, id))[assetId];
      if (hit && hit.sha256 === sha256) return { status: "ready", words: hit.words };
    }

    const key = `${id === null ? "" : itemKey(vault, id)}\u0000${assetId}\u0000${sha256}`;
    let pending = inFlight.get(key);
    if (!pending) {
      pending = (async () => {
        const words = await deps.recognizer.recognize(png);
        if (words === "unavailable") return words;
        if (id !== null) {
          await cacheRecognition(vault, id, assetId, sha256, words, startedAt).catch(() => {});
        }
        return words;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const words = await pending;
    return words === "unavailable" ? unavailable : { status: "ready", words };
  } catch (error) {
    console.warn("screenshot text: recognition failed", error);
    return unavailable;
  }
}
