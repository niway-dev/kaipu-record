/**
 * Pure glue between the editor's lanes and the filmstrip controller (ADR 0064, layer 3): which
 * files the visible lanes draw, which clips of the timeline draw from each, and how a tile finds
 * its frame in that file's own time. No React, no DOM.
 *
 * Two offsets describe one file, because the 24 frames the editor decodes at open (`legacy`) and the
 * tiles speak in SOURCE time while the store speaks in the file's own time:
 *
 * - `fileOffset`: file time = a tile's SOURCE time − `fileOffset`. A joined recording's offset on
 *   the source axis (ADR 0058), plus a webcam's start offset (ADR 0037).
 * - `legacyOffset`: file time = a legacy frame's `sourceTime` − `legacyOffset`. Zero for a screen
 *   recording (its frames are reported at the recording's own time); a webcam's start offset for a
 *   webcam (its frames are reported at source time).
 */
import { pickFrame, type TimeRange } from "./filmstrip-frames";
import type { FilmstripClip, FilmstripTarget } from "./filmstrip-controller";
import type { StoredFrame } from "./filmstrip-store";
import type { LayoutEntry } from "./timeline";
import type { ThumbnailTile } from "./components/timeline-geometry";

/** Where one file's tiles read their frames. */
export interface FilmstripBinding {
  fileKey: string;
  fileOffset: number;
  legacyOffset: number;
}

/** A frame a tile can show, in the file's own time. */
export interface TileFrame {
  timestamp: number;
  url: string;
}

/** One file of a lane, as the page knows it. */
export interface FilmstripFileInput {
  binding: FilmstripBinding;
  /** The file's duration in its own time (not finite: the file is not requested yet). */
  duration: number;
  /** The clip blocks that draw from this file. */
  entries: readonly LayoutEntry[];
  /** The frames decoded at open, with `sourceTime` as that lane reports it. */
  legacy: readonly { sourceTime: number; url: string }[];
}

/** The controller's targets for the lanes that are showing. */
export function buildFilmstripTargets(files: readonly FilmstripFileInput[]): FilmstripTarget[] {
  return files.flatMap((file) => {
    const clips: FilmstripClip[] = file.entries
      .filter((entry) => entry.kind === "clip")
      .map((entry) => ({
        timelineStart: entry.timelineStart,
        timelineEnd: entry.timelineEnd,
        sourceStart: entry.sourceStart,
        sourceEnd: entry.sourceEnd,
      }));
    if (clips.length === 0) return [];
    return [
      {
        fileKey: file.binding.fileKey,
        duration: file.duration,
        fileOffset: file.binding.fileOffset,
        clips,
        legacy: legacyFrames(file.legacy, file.binding.legacyOffset),
      },
    ];
  });
}

/** The legacy frames in file time, sorted by timestamp. */
export function legacyFrames<T extends { sourceTime: number; url: string }>(
  legacy: readonly T[],
  legacyOffset: number,
): TileFrame[] {
  return legacy
    .map((frame) => ({ timestamp: frame.sourceTime - legacyOffset, url: frame.url }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** The store's frames and the legacy ones as one list sorted by timestamp (store frames win a tie). */
export function mergeTileFrames(
  stored: readonly StoredFrame[],
  legacy: readonly TileFrame[],
): TileFrame[] {
  const out: TileFrame[] = [];
  let i = 0;
  let j = 0;
  while (i < stored.length || j < legacy.length) {
    if (j >= legacy.length || (i < stored.length && stored[i].timestamp <= legacy[j].timestamp)) {
      out.push({ timestamp: stored[i].timestamp, url: stored[i].data });
      i++;
    } else {
      out.push(legacy[j++]);
    }
  }
  return out;
}

/** The tile's span in file time: the span of its stretch of the clip, centred on `tile.sourceTime`. */
export function tileSpanInFile(
  tile: ThumbnailTile,
  entry: Pick<LayoutEntry, "sourceStart" | "sourceEnd">,
  fileOffset: number,
): TimeRange {
  const centre = tile.sourceTime - fileOffset;
  const half = (tile.width * (entry.sourceEnd - entry.sourceStart)) / 2;
  return { start: centre - half, end: centre + half };
}

/**
 * The frame a tile shows (ADR 0064, decision 1): inside the tile's own span, else the nearest
 * inside its clip, else the nearest in the file. A tile whose centre is outside `covered` (a
 * webcam that does not span the whole source, in the same time `tile.sourceTime − shift` is read)
 * stays empty, as it does today.
 */
export function frameForTile(input: {
  frames: readonly TileFrame[];
  tile: ThumbnailTile;
  entry: Pick<LayoutEntry, "sourceStart" | "sourceEnd">;
  fileOffset: number;
  /** In file time. Absent or null: the file is taken to cover everything. */
  covered?: TimeRange | null;
}): { frame: TileFrame; span: TimeRange } | null {
  const { frames, tile, entry, fileOffset, covered } = input;
  const span = tileSpanInFile(tile, entry, fileOffset);
  const centre = (span.start + span.end) / 2;
  if (covered && !(centre >= covered.start && centre < covered.end)) return null;
  const frame = pickFrame(frames, span, {
    start: entry.sourceStart - fileOffset,
    end: entry.sourceEnd - fileOffset,
  });
  return frame ? { frame, span } : null;
}
