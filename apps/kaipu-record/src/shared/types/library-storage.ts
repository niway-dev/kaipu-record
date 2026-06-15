/**
 * A recording stored in the local vault, as returned by the main process.
 * Pure type — safe to import from both main and renderer.
 */
export interface LocalRecording {
  id: string;
  title: string;
  /** Absolute path to the video file on disk. */
  filePath: string;
  /** Epoch milliseconds. */
  createdAt: number;
  sizeBytes: number;
  /** 0 when unknown (no sidecar metadata yet). */
  durationSeconds: number;
  thumbnailUrl?: string | null;
}

/** Where recordings are stored, and whether the user picked a custom folder. */
export interface VaultDirectory {
  path: string;
  isCustom: boolean;
}
