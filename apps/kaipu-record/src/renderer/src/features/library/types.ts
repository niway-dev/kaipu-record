/** Presentational types for the library UI. */

import type { LocalRecording } from "@shared/types/library-storage";
import type { RecordingCapture } from "@shared/recording-capture";
import type {
  Availability,
  Comparison,
  EditingState,
  TransferState,
} from "@shared/types/library-item";

/** "gif" = an animated GIF export (NIW2-217); grouped under Recordings in the filters. */
export type LibraryKind = "recording" | "screenshot" | "gif";

export interface LibraryVideo {
  /** Local filename id; null for a cloud-only item (nothing to reveal, play or edit locally). */
  id: string | null;
  assetId: string;
  kind: LibraryKind;
  title: string;
  /** Epoch milliseconds. */
  createdAt: number;
  durationSeconds: number;
  /** Local size when present, otherwise the cloud size. */
  fileSizeBytes: number;
  cloudSizeBytes: number | null;
  thumbnailUrl?: string | null;
  availability: Availability;
  comparison: Comparison;
  editing: EditingState;
  transfer: { state: TransferState; progress?: { sentBytes: number; totalBytes: number } };
  derivedFromAssetId: string | null;
  /** Epoch ms of the last edit-session save, null without a session (see LibraryItem). */
  editSavedAt: number | null;
  editExportedSavedAt: number | null;
  /** Editor home stamps (sidecar): last opened in an editor; last manual image Save. */
  editorOpenedAt?: number | null;
  editorSavedAt?: number | null;
  /** Ids of the tags this item carries (ADR 0020); resolve with `useTags`. */
  tagIds?: string[];
  /** GIF exports only: output size and frame rate (NIW2-217). */
  gif?: { width: number; height: number; fps: number } | null;
  /** MP4 exports only: preset + what was encoded, for "already exported" reuse (NIW2-218). */
  export?: LocalRecording["export"];
  /** How the recording was captured (library label); null for older and cloud-only items. */
  capture?: RecordingCapture | null;
  /** Set when the local sidecar could not be read: the item is listed but read-only (NIW2-568). */
  metadataIssue?: LocalRecording["metadataIssue"];
}
