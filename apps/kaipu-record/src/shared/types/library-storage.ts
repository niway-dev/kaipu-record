import type { ExportPresetId } from "./export-preset";
import type { RecordingCapture } from "../recording-capture";
import type { WebcamTrackMeta } from "../webcam-track";

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
   * The take's webcam track (ADR 0032): the sidecar's offset, quality, size and recorded
   * layout, present only while `.kaipu/<id>.webcam.mp4` exists. Absent/null otherwise.
   */
  webcam?: WebcamTrackMeta | null;
}

/** Where recordings are stored, and whether the user picked a custom folder. */
export interface VaultDirectory {
  path: string;
  isCustom: boolean;
}
