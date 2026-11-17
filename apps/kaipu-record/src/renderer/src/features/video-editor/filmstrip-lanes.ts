/**
 * Which media files the Clips and Webcam rows draw from, for the zoom-aware filmstrip (ADR 0064,
 * layer 3). Pure: the page hands in what it already knows (the opened recording, the joined ones,
 * the webcam files and the 24 frames each has decoded) and gets the controller's inputs and the
 * lanes' file maps back.
 *
 * A clip's recording is `clipRecordings.get(itemId)`; without joined recordings that map is null
 * and every clip belongs to the opened recording (`sourceId` null).
 */
import type { ClipRecording, ClipRecordings } from "./clip-recordings";
import type { FilmstripFileInput } from "./filmstrip-targets";
import type { LayoutEntry } from "./timeline";
import type { CompanionThumbnails, SourceThumbnail } from "./use-source-thumbnails";
import type { WebcamFilmstripFile } from "./components/webcam-lane";

/** A recording's screen file. `sourceId` is null for the opened recording. */
export interface ScreenFile {
  sourceId: string | null;
  url: string;
  duration: number;
  thumbnails: readonly SourceThumbnail[];
}

/** A recording's webcam file. `companionOffset` is its start offset in seconds (ADR 0037). */
export interface WebcamFile {
  sourceId: string | null;
  url: string;
  companionOffset: number;
  strip: CompanionThumbnails | undefined;
}

const NO_THUMBNAILS: readonly SourceThumbnail[] = [];

function recordingOf(
  clipRecordings: ClipRecordings | null,
  entry: LayoutEntry,
): ClipRecording | undefined {
  return clipRecordings?.get(entry.itemId);
}

/** The clips of `layout` that draw from one recording (null: the opened one). */
function entriesOf(
  layout: readonly LayoutEntry[],
  clipRecordings: ClipRecordings | null,
  sourceId: string | null,
): LayoutEntry[] {
  return layout.filter(
    (entry) =>
      entry.kind === "clip" && (recordingOf(clipRecordings, entry)?.sourceId ?? null) === sourceId,
  );
}

/** The Clips row's file for each recording, for `TimelineStrip.filmstripFiles`. */
export function screenFileMap(files: readonly ScreenFile[]): Map<string | null, string> {
  return new Map(files.map((file) => [file.sourceId, file.url]));
}

/** The Webcam row's file for each recording, for `WebcamLane.filmstripFiles`. */
export function webcamFileMap(
  files: readonly WebcamFile[],
): Map<string | null, WebcamFilmstripFile> {
  return new Map(
    files.map((file) => [
      file.sourceId,
      { fileKey: file.url, companionOffset: file.companionOffset },
    ]),
  );
}

/**
 * The controller's files for the rows that are showing. A row that is hidden passes no files
 * (hidden lanes request nothing, decision 7).
 */
export function laneFileInputs(input: {
  layout: readonly LayoutEntry[];
  clipRecordings: ClipRecordings | null;
  screen: readonly ScreenFile[];
  webcam: readonly WebcamFile[];
}): FilmstripFileInput[] {
  const { layout, clipRecordings } = input;
  const out: FilmstripFileInput[] = [];

  for (const file of input.screen) {
    const entries = entriesOf(layout, clipRecordings, file.sourceId);
    if (entries.length === 0) continue;
    out.push({
      binding: {
        fileKey: file.url,
        fileOffset: recordingOf(clipRecordings, entries[0])?.offset ?? 0,
        legacyOffset: 0,
      },
      duration: file.duration,
      entries,
      legacy: file.thumbnails,
    });
  }

  for (const file of input.webcam) {
    const entries = entriesOf(layout, clipRecordings, file.sourceId);
    if (entries.length === 0) continue;
    const covered = file.strip?.covered ?? null;
    const duration = covered ? covered.end - covered.start : Number.NaN;
    out.push({
      binding: {
        fileKey: file.url,
        fileOffset: (recordingOf(clipRecordings, entries[0])?.offset ?? 0) + file.companionOffset,
        legacyOffset: file.companionOffset,
      },
      duration,
      entries,
      legacy: file.strip?.thumbnails ?? NO_THUMBNAILS,
    });
  }
  return out;
}
