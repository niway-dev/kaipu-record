/** Presentational types for the library UI. */

export type StorageState = "local" | "cloud" | "uploading" | "failed";

/** What kind of asset a library item is — a screen recording or a screenshot. */
export type LibraryKind = "recording" | "screenshot";

export interface LibraryVideo {
  id: string;
  assetId: string;
  kind: LibraryKind;
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
