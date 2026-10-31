import type { ExportPresetId } from "./export-preset";
import type { RecordingCapture } from "../recording-capture";

/**
 * Why an item's sidecar cannot be trusted (NIW2-568): `unreadable` = a read error other
 * than a missing file; `corrupt` = it read but is not a JSON object.
 */
export type MetadataIssue = "unreadable" | "corrupt";

/**
 * A recording stored in the local vault, as returned by the main process.
 * Pure type — safe to import from both main and renderer.
 */
export interface LocalRecording {
  /**
   * The filename without extension. Local-only handle that changes when the item is
   * renamed (ADR 0035): use it for the current render and IPC call, never persist it —
   * `assetId` is the identity for anything that outlives that.
   */
  id: string;
  /**
   * Stable identity minted on first read and persisted in the sidecar. This is
   * what the cloud catalog and every cross-device relation use — never `id`.
   */
  assetId: string;
  /**
   * Discriminates a video recording, a screenshot and an animated GIF export
   * (NIW2-217) in the unified vault. GIFs are local-only: never uploaded to the cloud.
   */
  kind: "recording" | "screenshot" | "gif";
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
  /**
   * Ids of the tags this item carries (ADR 0020); `[]` without any. Optional so
   * older callers and fixtures that build a `LocalRecording` by hand stay valid.
   */
  tagIds?: string[];
  /** GIF exports only: output size and frame rate, from the sidecar. */
  gif?: { width: number; height: number; fps: number } | null;
  /**
   * MP4 exports (NIW2-218): the preset that produced the file (a legacy "original" reads as
   * "maximum") and what was encoded (`RecordingFinalizeMeta.exportFingerprint`; null on
   * exports made before it existed). null for everything else.
   */
  export?: { preset: ExportPresetId; fingerprint: string | null } | null;
  /**
   * The Editor home's activity stamps: when the item was last opened in an editor,
   * and (screenshots) when it was last saved from the image editor by hand. null
   * when never; optional for the same reason as `tagIds`.
   */
  editorOpenedAt?: number | null;
  editorSavedAt?: number | null;
  /**
   * Recordings made after capture metadata existed: mode, output size and ratio, from the
   * sidecar. null for older recordings, screenshots, GIFs and exports. Optional like `tagIds`.
   */
  capture?: RecordingCapture | null;
  /**
   * Set only when the sidecar could not be read or parsed. Every sidecar-backed field above
   * is then a placeholder (title from the file name, `assetId` a stand-in), and nothing is
   * written for the item until a later read succeeds.
   */
  metadataIssue?: MetadataIssue;
}

/** Where recordings are stored, and whether the user picked a custom folder. */
export interface VaultDirectory {
  path: string;
  isCustom: boolean;
}

/** What a rename did to the file (NIW2-560). "kept-old-name" is not an error: the title was saved. */
export type RenameFileOutcome = "renamed" | "unchanged" | "kept-old-name";
/**
 * Why the file kept its old name: another app holds it, an export is reading it, the item
 * is open in the video editor (which holds its id for its lifetime), another file appeared
 * under the new name while the rename ran ("taken": never replaced), or another I/O error.
 */
export type RenameKeptReason = "locked" | "busy" | "editing" | "taken" | "io";

export interface RenameResult {
  /** The item after the rename; `recording.id` is the id to use from now on. */
  recording: LocalRecording;
  file: RenameFileOutcome;
  /** Set only when `file` is "kept-old-name". */
  reason?: RenameKeptReason;
}

/**
 * Marker in the message of the error a rename rejects with when no item carries the
 * requested `assetId` any more (deleted). A stale id alone does not reject: the rename
 * follows the identity to its current id. Electron passes only the
 * message across IPC, so the renderer matches on this to refresh quietly instead of
 * reporting an error.
 */
export const ITEM_NOT_FOUND_MARKER = "vault-item-not-found";

/**
 * Marker in the message of the error a vault operation rejects with when two local files
 * claim the same identity (a Finder copy made with its sidecar) and the caller's id no
 * longer settles which one it means. Nothing was changed; the renderer shows a plain toast.
 */
export const AMBIGUOUS_IDENTITY_MARKER = "vault-ambiguous-identity";

/**
 * Marker in the message of the error a vault write rejects with when the item's sidecar
 * is unreadable, corrupt or invalid: nothing was written, so whatever the record still
 * holds can be recovered by hand (NIW2-561).
 */
export const UNREADABLE_RECORD_MARKER = "vault-unreadable-record";

/**
 * Marker in the message of the error a vault operation is refused with while "Check and
 * fix files" runs (NIW2-561, maintenance mode). Nothing was done and nothing is queued:
 * the renderer says "Kaipu is fixing your files", and editors retry their pending save
 * when `library:maintenance-ended` arrives.
 */
export const VAULT_MAINTENANCE_MARKER = "vault-maintenance";
