/** Presentational types for the library UI. */

export type StorageState = "local" | "cloud" | "uploading" | "failed";

export interface LibraryVideo {
  id: string;
  title: string;
  /** Epoch milliseconds. */
  createdAt: number;
  durationSeconds: number;
  fileSizeBytes: number;
  thumbnailUrl?: string | null;
  storage: StorageState;
  /** 0–100, only meaningful while `storage === "uploading"`. */
  processingProgress?: number;
  tags?: string[];
}
