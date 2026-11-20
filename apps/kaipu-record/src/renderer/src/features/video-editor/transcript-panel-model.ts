/**
 * What the Transcript panel shows, decided away from React (NIW2-818): which of its states a
 * transcript read plus the Transcribe control add up to, where the unresolved intervals land in
 * the edited text, and the plain text the Copy button puts on the clipboard.
 */
import type { TranscriptUnresolvedInterval } from "@shared/types/transcription";
import type { TranscribeControlState } from "@renderer/features/transcription/transcribe-control";
import type { StartFailure } from "@renderer/features/transcription/transcription-job-store";
import type { TranscriptApi } from "@renderer/features/transcription/use-transcript";
import { sourceRangeToTimelineBlocks } from "./source-time";
import type { LayoutEntry } from "./timeline";
import type { TranscriptParagraph } from "./transcript-paragraphs";

export type PanelView =
  | { kind: "loading" }
  | {
      kind: "running";
      phase: string;
      segmentsDone: number;
      segmentsTotal: number;
    }
  | {
      kind: "words";
      /** The recording changed after the transcript was made: words stay, marked out of date. */
      stale: boolean;
      /** The engine could not resolve some stretches of speech. */
      unresolved: boolean;
      /** Why the last attempt to transcribe again failed, when it did. */
      failure: StartFailure | null;
      /** A job is re-transcribing this out-of-date transcript; the words stay while it runs. */
      rerun: { phase: string; segmentsDone: number; segmentsTotal: number } | null;
    }
  | { kind: "failed"; reason: StartFailure | "invalid" }
  | { kind: "idle" }
  | { kind: "needsModel" }
  | { kind: "downloading" }
  | { kind: "noAudio" }
  | { kind: "unavailable" }
  | { kind: "busy" };

/** The look the panel root announces (`data-state`): one value per catalog state. */
export function viewState(view: PanelView): string {
  switch (view.kind) {
    case "running":
      return "transcribing";
    case "words":
      return view.stale ? "stale" : view.unresolved ? "unresolved" : "done";
    default:
      return view.kind;
  }
}

export interface PanelViewInput {
  transcript: Pick<TranscriptApi, "state" | "stale"> & {
    unresolvedCount: number;
  };
  control: TranscribeControlState;
  /** `false`: the recording has no audio track. `null`: not known (yet). */
  hasAudio: boolean | null;
}

/**
 * The first matching rule wins:
 *
 * 1. A job for this video is running: its progress, whatever a file on disk says. The one
 *    exception is an out-of-date transcript: its old words stay readable and the progress
 *    shows beside them, so a re-transcribe never blanks the panel.
 * 2. The transcript file is being read: loading.
 * 3. A transcript exists: its words, marked stale and/or with unresolved stretches. A failed
 *    attempt to transcribe again shows inside that view, so the old words stay readable.
 * 4. The file does not validate: failed, with its own reason.
 * 5. No transcript: a video without audio says so; otherwise the control decides.
 */
export function panelView(input: PanelViewInput): PanelView {
  const { transcript, control, hasAudio } = input;
  if (control.kind === "running") {
    const progress = {
      phase: control.phase,
      segmentsDone: control.segmentsDone,
      segmentsTotal: control.segmentsTotal,
    };
    if (transcript.state === "ready" && transcript.stale) {
      return {
        kind: "words",
        stale: true,
        unresolved: transcript.unresolvedCount > 0,
        failure: null,
        rerun: progress,
      };
    }
    return {
      kind: "running",
      phase: control.phase,
      segmentsDone: control.segmentsDone,
      segmentsTotal: control.segmentsTotal,
    };
  }
  if (transcript.state === "loading") return { kind: "loading" };
  if (transcript.state === "ready") {
    return {
      kind: "words",
      stale: transcript.stale,
      unresolved: transcript.unresolvedCount > 0,
      failure: control.kind === "failed" ? control.failure : null,
      rerun: null,
    };
  }
  if (transcript.state === "invalid") return { kind: "failed", reason: "invalid" };
  if (hasAudio === false) return { kind: "noAudio" };
  switch (control.kind) {
    case "failed":
      return control.failure === "no-audio"
        ? { kind: "noAudio" }
        : { kind: "failed", reason: control.failure };
    case "unavailable":
    case "hidden":
      return { kind: "unavailable" };
    case "busy-elsewhere":
      return { kind: "busy" };
    case "model-downloading":
      return { kind: "downloading" };
    case "needs-model":
      return { kind: "needsModel" };
    case "idle":
      return { kind: "idle" };
    default:
      // loading, or a transcript this session wrote that the file read has not caught up with.
      return { kind: "loading" };
  }
}

/** "7:05" under an hour, "1:02:07" from an hour on. */
export function formatStamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 1e-6));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A stretch the engine could not resolve, on the edited timeline (seconds). */
export interface UnresolvedMark {
  start: number;
  end: number;
}

/** Marks closer than this are one stretch (seconds); the same tolerance `source-time.ts` uses. */
const MARK_EPSILON = 1e-6;

/**
 * The unresolved intervals (source ms) as marks on the timeline: the pieces of each interval
 * that survive the edit, sorted by start. An interval cut away entirely has no mark. Pieces that
 * touch or overlap are one mark: a split keeps the source contiguous, so an interval over a split
 * point reaches the timeline as two back-to-back pieces that the user sees as one stretch.
 */
export function unresolvedMarks(
  unresolved: readonly TranscriptUnresolvedInterval[],
  layout: LayoutEntry[],
): UnresolvedMark[] {
  const marks: UnresolvedMark[] = [];
  for (const interval of unresolved) {
    if (interval.endMs <= interval.startMs) continue;
    for (const block of sourceRangeToTimelineBlocks(
      layout,
      interval.startMs / 1000,
      interval.endMs / 1000,
    )) {
      marks.push({ start: block.timelineStart, end: block.timelineEnd });
    }
  }
  marks.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: UnresolvedMark[] = [];
  for (const mark of marks) {
    const last = merged[merged.length - 1];
    if (last && mark.start <= last.end + MARK_EPSILON) last.end = Math.max(last.end, mark.end);
    else merged.push({ ...mark });
  }
  return merged;
}

export type TranscriptRow =
  | {
      kind: "paragraph";
      paragraph: TranscriptParagraph;
      /** Index, in the projected occurrences, of the paragraph's first word. */
      firstIndex: number;
      /** Marks inside the paragraph, each with the word index it goes before (0..n). */
      marks: { before: number; mark: UnresolvedMark }[];
    }
  | { kind: "gap"; id: string; mark: UnresolvedMark };

/**
 * Paragraphs and unresolved marks in reading order. A mark that starts inside a paragraph is
 * placed before the first word that starts at or after it; any other mark (before the first
 * word, in a long silence, after the last) is a row of its own.
 */
export function buildRows(
  paragraphs: readonly TranscriptParagraph[],
  marks: readonly UnresolvedMark[],
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  let markIndex = 0;
  let firstIndex = 0;
  const gapBefore = (limit: number): void => {
    while (markIndex < marks.length && marks[markIndex].start < limit) {
      rows.push({ kind: "gap", id: `gap:${markIndex}`, mark: marks[markIndex] });
      markIndex += 1;
    }
  };
  for (const paragraph of paragraphs) {
    gapBefore(paragraph.start);
    const inside: { before: number; mark: UnresolvedMark }[] = [];
    while (markIndex < marks.length && marks[markIndex].start <= paragraph.end) {
      const mark = marks[markIndex];
      const at = paragraph.occurrences.findIndex((o) => o.start >= mark.start);
      inside.push({ before: at === -1 ? paragraph.occurrences.length : at, mark });
      markIndex += 1;
    }
    rows.push({ kind: "paragraph", paragraph, firstIndex, marks: inside });
    firstIndex += paragraph.occurrences.length;
  }
  gapBefore(Infinity);
  return rows;
}

/** The transcript as plain text: one line of words per paragraph, blank line between. */
export function transcriptText(paragraphs: readonly TranscriptParagraph[]): string {
  return paragraphs.map((p) => p.occurrences.map((o) => o.text.trim()).join(" ")).join("\n\n");
}
