/**
 * A recording stored in the local vault, as returned by the main process.
 * Pure type — safe to import from both main and renderer.
 */
export interface LocalRecording {
  /** The filename without extension. Local-only handle; stable while the file is not renamed. */
  id: string;
  /**
   * Stable identity minted on first read and persisted in the sidecar. This is
   * what the cloud catalog and every cross-device relation use — never `id`.
   */
  assetId: string;
  /** Discriminates a video recording from a screenshot in the unified vault. */
  kind: "recording" | "screenshot";
  title: string;
  /** Absolute path to the media file on disk. */
  filePath: string;
  /** Epoch milliseconds. */
  createdAt: number;
  sizeBytes: number;
  /** 0 when unknown (no sidecar metadata yet). */
  durationSeconds: number;
  thumbnailUrl?: string | null;
  /** The asset this file was exported from, when it is an editor export. */
  derivedFromAssetId: string | null;
  /**
   * base64 sha256 of the file, only when the cached hash still matches the file's
   * current size + mtime. null = not computed yet or stale (never "unknown bytes").
   */
  contentSha256: string | null;
}

/** Where recordings are stored, and whether the user picked a custom folder. */
export interface VaultDirectory {
  path: string;
  isCustom: boolean;
}
