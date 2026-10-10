/**
 * The library's unified item: one entry per logical video/screenshot, whether its
 * bytes live here, in cloud, or both. Five independent axes replace the old
 * `storage: "local" | "cloud" | "uploading" | "failed"` enum, which could not say
 * "local and cloud, uploading a new revision, with local changes" at once.
 * Pure — imported by main and renderer.
 */
import type { LocalRecording } from "./library-storage";

export const AVAILABILITIES = [
  "local",
  "cloud",
  "local-and-cloud",
  "local-unavailable",
  "unverified",
] as const;
export type Availability = (typeof AVAILABILITIES)[number];

export const TRANSFER_STATES = [
  "idle",
  "queued",
  "preparing",
  "uploading",
  "verifying",
  "downloading",
  "paused-offline",
  "cancelling",
  "failed",
  "deleting",
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

/** Local revision vs cloud revision of the same asset. */
export const COMPARISONS = ["same", "local-changes", "pending", "different"] as const;
export type Comparison = (typeof COMPARISONS)[number];

export const EDITING_STATES = [
  "project-available",
  "needs-source",
  "exported-only",
  "missing-dependencies",
] as const;
export type EditingState = (typeof EDITING_STATES)[number];

export const SHARING_STATES = ["private", "link-active", "revoking", "link-revoked"] as const;
export type SharingState = (typeof SHARING_STATES)[number];

/** What main caches from the server catalog for one asset (plan 01 `CloudAssetSummary`). */
export interface CloudCatalogEntry {
  assetId: string;
  kind: "recording" | "screenshot";
  title: string;
  revisionId: string;
  contentType: string;
  sizeBytes: number;
  contentSha256: string;
  durationSeconds: number;
  hasThumbnail: boolean;
  derivedFromAssetId: string | null;
  autoUploadExcluded: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** When this entry was last confirmed against the server (epoch ms). */
  lastVerifiedAt: number;
  /** The local filename id this asset was last merged with, if any — lets an unreadable vault say "local unavailable" rather than "cloud". */
  lastSeenLocalId: string | null;
}

export interface LibraryItem {
  assetId: string;
  /** "gif" items are local-only (NIW2-217); the cloud catalog never holds one. */
  kind: "recording" | "screenshot" | "gif";
  title: string;
  createdAt: number;
  durationSeconds: number;
  derivedFromAssetId: string | null;
  /**
   * Epoch ms of the last video-edit-session save on this device, or null when there is
   * no session (or no local copy). Compared against the item's exports to say
   * "edited, not exported" (backlog/edit-state-indicators).
   */
  editSavedAt: number | null;
  /**
   * The `savedAt` already burned into an export, or null when none is. Equal to
   * `editSavedAt` exactly when every edit is in an export; see
   * `SessionMeta.exportedSavedAt` for why this is a stamp and not a date comparison.
   */
  editExportedSavedAt: number | null;
  /** The local copy, when the file is present and readable. */
  local: LocalRecording | null;
  /** The cloud copy as last seen in the catalog cache. */
  cloud: CloudCatalogEntry | null;
  availability: Availability;
  /** Plan 03 fills this from the transfer queue; here it is always `{ state: "idle" }`. */
  transfer: { state: TransferState; progress?: { sentBytes: number; totalBytes: number } };
  comparison: Comparison;
  editing: EditingState;
  /** Plan 04 fills this; here it is always `"private"`. */
  sharing: SharingState;
}

/**
 * Whether an item of this kind may ever be uploaded to the cloud. GIF exports are
 * local-only in v1 (NIW2-217); the cloud upload flow (NIW2-214) must check this both in
 * the UI and in the main-process handler.
 */
export function isCloudUploadEligible(item: Pick<LibraryItem, "kind">): boolean {
  return item.kind !== "gif";
}

export function hasLocalCopy(item: Pick<LibraryItem, "availability">): boolean {
  return item.availability === "local" || item.availability === "local-and-cloud";
}

export function hasCloudCopy(item: Pick<LibraryItem, "availability">): boolean {
  return (
    item.availability === "cloud" ||
    item.availability === "local-and-cloud" ||
    item.availability === "local-unavailable"
  );
}

export interface LibraryListResult {
  items: LibraryItem[];
  /** The vault folder could not be read; `items` still carries cached cloud entries. */
  vaultError: string | null;
  /** null = signed out; otherwise when the cloud catalog was last confirmed (epoch ms) or 0 if never. */
  catalogVerifiedAt: number | null;
}

export type CatalogRefreshResult =
  | { ok: true; verifiedAt: number }
  | { ok: false; reason: "signed-out" | "unauthorized" | "network" };

export type RemoveLocalCopyResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no-cloud-copy" | "different-bytes" | "hash-unknown" | "edit-project" | "not-found";
    };
