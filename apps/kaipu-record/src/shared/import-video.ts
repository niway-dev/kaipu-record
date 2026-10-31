/**
 * Importing an outside video into the Library (NIW2-579): what may be imported and what
 * main answers. Pure and import-free on the value side — reachable from the preload
 * bundle, which cannot load workspace packages at runtime.
 */
import type { LocalRecording } from "./types/library-storage";

/**
 * Containers the import accepts, lowercase with the dot. `.mov` (iPhone, QuickTime) and
 * `.m4v` are ISO BMFF like `.mp4`; `.webm` is what older Kaipu builds recorded.
 */
export const IMPORTABLE_VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm"] as const;
export type ImportableVideoExtension = (typeof IMPORTABLE_VIDEO_EXTENSIONS)[number];

/** Most files one import call accepts; a drop of a whole folder's worth is refused past this. */
export const MAX_IMPORT_FILES = 50;

/** The lowercase extension of a file name when it is an importable video, else null. */
export function importableVideoExtension(fileName: string): ImportableVideoExtension | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  const ext = fileName.slice(dot).toLowerCase();
  return (IMPORTABLE_VIDEO_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as ImportableVideoExtension)
    : null;
}

/**
 * Why one file was not imported. `unsupported-type`: not an importable extension;
 * `not-found` / `not-a-file`: the path is gone or is a folder; `unreadable`: no known
 * container, or it could not be parsed; `no-video-track`: a container with no (known)
 * video in it, e.g. audio only; `copy-failed`: reading the source or writing the vault failed;
 * `too-many`: past {@link MAX_IMPORT_FILES} in one call; `already-in-library`: the file is
 * inside the recordings folder (a Library card dragged back onto the Library).
 */
export const IMPORT_VIDEO_FAILURE_REASONS = [
  "unsupported-type",
  "not-found",
  "not-a-file",
  "unreadable",
  "no-video-track",
  "copy-failed",
  "too-many",
  "already-in-library",
] as const;
export type ImportVideoFailureReason = (typeof IMPORT_VIDEO_FAILURE_REASONS)[number];

export interface ImportVideoFailure {
  /** The source file's name (no folder), for the error toast. */
  fileName: string;
  reason: ImportVideoFailureReason;
}

export interface ImportVideoResult {
  /** The new Library items, in the order the files were given. */
  imported: LocalRecording[];
  failed: ImportVideoFailure[];
  /** True when the user closed the file dialog without picking anything. */
  canceled: boolean;
}
