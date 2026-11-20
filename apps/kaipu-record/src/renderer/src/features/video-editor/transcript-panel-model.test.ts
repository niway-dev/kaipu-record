import { describe, expect, it } from "vitest";
import type { TranscribeControlState } from "@renderer/features/transcription/transcribe-control";
import type { LayoutEntry } from "./timeline";
import { groupParagraphs } from "./transcript-paragraphs";
import type { WordOccurrence } from "./transcript-occurrence";
import {
  buildRows,
  formatStamp,
  panelView,
  transcriptText,
  unresolvedMarks,
  viewState,
  type PanelViewInput,
} from "./transcript-panel-model";

function input(
  transcript: Partial<PanelViewInput["transcript"]>,
  control: TranscribeControlState,
  hasAudio: boolean | null = null,
): PanelViewInput {
  return {
    transcript: { state: "none", stale: false, unresolvedCount: 0, ...transcript },
    control,
    hasAudio,
  };
}

describe("panelView", () => {
  it("shows a running job's progress over everything else", () => {
    const view = panelView(
      input(
        { state: "ready" },
        { kind: "running", phase: "transcribing", segmentsDone: 2, segmentsTotal: 5 },
      ),
    );
    expect(view).toEqual({
      kind: "running",
      phase: "transcribing",
      segmentsDone: 2,
      segmentsTotal: 5,
    });
    expect(viewState(view)).toBe("transcribing");
  });

  it("keeps the old words visible while a job re-transcribes an out-of-date transcript", () => {
    const view = panelView(
      input(
        { state: "ready", stale: true },
        { kind: "running", phase: "transcribing", segmentsDone: 1, segmentsTotal: 4 },
      ),
    );
    expect(view).toEqual({
      kind: "words",
      stale: true,
      unresolved: false,
      failure: null,
      rerun: { phase: "transcribing", segmentsDone: 1, segmentsTotal: 4 },
    });
    expect(viewState(view)).toBe("stale");
  });

  it("is loading while the file is read", () => {
    expect(panelView(input({ state: "loading" }, { kind: "idle" })).kind).toBe("loading");
  });

  it("names done, unresolved and stale", () => {
    const done = panelView(input({ state: "ready" }, { kind: "idle" }));
    const unresolved = panelView(input({ state: "ready", unresolvedCount: 2 }, { kind: "idle" }));
    const stale = panelView(
      input({ state: "ready", stale: true, unresolvedCount: 2 }, { kind: "idle" }),
    );
    expect([done, unresolved, stale].map(viewState)).toEqual(["done", "unresolved", "stale"]);
  });

  it("keeps the old words when transcribing again failed, and carries the reason", () => {
    const view = panelView(
      input({ state: "ready", stale: true }, { kind: "failed", failure: "engine-failed" }),
    );
    expect(view).toMatchObject({ kind: "words", stale: true, failure: "engine-failed" });
  });

  it("calls an unreadable file failed with its own reason", () => {
    expect(panelView(input({ state: "invalid" }, { kind: "idle" }))).toEqual({
      kind: "failed",
      reason: "invalid",
    });
  });

  it("says a video without audio has nothing to transcribe, before anything else", () => {
    expect(panelView(input({}, { kind: "idle" }, false)).kind).toBe("noAudio");
    expect(panelView(input({}, { kind: "needs-model" }, false)).kind).toBe("noAudio");
  });

  it("maps the engine's own no-audio verdict to the same state", () => {
    expect(panelView(input({}, { kind: "failed", failure: "no-audio" })).kind).toBe("noAudio");
  });

  it("maps the rest of the control's states", () => {
    const kinds = (control: TranscribeControlState): string => panelView(input({}, control)).kind;
    expect(kinds({ kind: "idle" })).toBe("idle");
    expect(kinds({ kind: "needs-model" })).toBe("needsModel");
    expect(kinds({ kind: "model-downloading" })).toBe("downloading");
    expect(kinds({ kind: "unavailable" })).toBe("unavailable");
    expect(kinds({ kind: "hidden" })).toBe("unavailable");
    expect(kinds({ kind: "busy-elsewhere" })).toBe("busy");
    expect(kinds({ kind: "loading" })).toBe("loading");
    expect(kinds({ kind: "failed", failure: "write-failed" })).toBe("failed");
  });

  it("waits for the file read when this session just wrote a transcript", () => {
    expect(panelView(input({}, { kind: "done" })).kind).toBe("loading");
  });
});

describe("formatStamp", () => {
  it("writes minutes and seconds, and hours from one hour on", () => {
    expect(formatStamp(0)).toBe("0:00");
    expect(formatStamp(65.9)).toBe("1:05");
    expect(formatStamp(3600)).toBe("1:00:00");
    expect(formatStamp(3725)).toBe("1:02:05");
  });
});

function clip(timelineStart: number, sourceStart: number, sourceEnd: number): LayoutEntry {
  return {
    itemId: `clip-${timelineStart}`,
    kind: "clip",
    timelineStart,
    timelineEnd: timelineStart + (sourceEnd - sourceStart),
    sourceStart,
    sourceEnd,
  };
}

describe("unresolvedMarks", () => {
  it("maps an interval to its surviving pieces on the timeline, in order", () => {
    // Source 2..4 is cut out: timeline 0..2 plays source 0..2, timeline 2..6 plays source 4..8.
    const layout = [clip(0, 0, 2), clip(2, 4, 8)];
    const marks = unresolvedMarks(
      [
        { startMs: 5000, endMs: 6000, reason: "segment-failed" },
        { startMs: 1000, endMs: 3000, reason: "empty-with-speech" },
        { startMs: 2500, endMs: 3500, reason: "segment-failed" },
      ],
      layout,
    );
    expect(marks).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 },
    ]);
  });

  it("keeps one mark for an interval that crosses a split, where the source stays contiguous", () => {
    // A split at source 5 leaves two clips that play on without a gap.
    const layout = [clip(0, 0, 5), clip(5, 5, 10)];
    const marks = unresolvedMarks(
      [{ startMs: 4000, endMs: 6000, reason: "segment-failed" }],
      layout,
    );
    expect(marks).toEqual([{ start: 4, end: 6 }]);
  });

  it("merges overlapping intervals into one mark", () => {
    const layout = [clip(0, 0, 10)];
    const marks = unresolvedMarks(
      [
        { startMs: 1000, endMs: 3000, reason: "segment-failed" },
        { startMs: 2000, endMs: 4000, reason: "empty-with-speech" },
      ],
      layout,
    );
    expect(marks).toEqual([{ start: 1, end: 4 }]);
  });
});

function occ(wordId: string, start: number, end: number, text = wordId): WordOccurrence {
  return {
    wordId,
    text,
    start,
    end,
    sourceStartMs: Math.round(start * 1000),
    sourceEndMs: Math.round(end * 1000),
    clipId: "a",
  };
}

describe("buildRows", () => {
  const paragraphs = groupParagraphs([
    occ("a", 2, 2.4, "Hello"),
    occ("b", 2.5, 2.9, "world."),
    occ("c", 10, 10.4, "Next"),
  ]);

  it("numbers each paragraph's first word in the flat occurrence list", () => {
    const rows = buildRows(paragraphs, []);
    expect(rows.map((r) => r.kind === "paragraph" && r.firstIndex)).toEqual([0, 2]);
  });

  it("puts a mark inside a paragraph before the first word at or after it", () => {
    const rows = buildRows(paragraphs, [{ start: 2.45, end: 2.5 }]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "paragraph", marks: [{ before: 1 }] });
  });

  it("gives a mark outside every paragraph a row of its own, in reading order", () => {
    const rows = buildRows(paragraphs, [
      { start: 0, end: 1 },
      { start: 5, end: 6 },
      { start: 20, end: 21 },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["gap", "paragraph", "gap", "paragraph", "gap"]);
  });

  it("puts a mark that starts where a paragraph's last word ends at the end of that paragraph", () => {
    const rows = buildRows(paragraphs, [{ start: 2.9, end: 3.2 }]);
    expect(rows[0]).toMatchObject({ kind: "paragraph", marks: [{ before: 2 }] });
  });

  it("makes a mark that starts after a paragraph ends a row of its own", () => {
    const rows = buildRows(paragraphs, [{ start: 2.95, end: 3.2 }]);
    expect(rows.map((r) => r.kind)).toEqual(["paragraph", "gap", "paragraph"]);
  });
});

describe("transcriptText", () => {
  it("joins words with spaces and paragraphs with a blank line", () => {
    const paragraphs = groupParagraphs([
      occ("a", 0, 0.4, "Hello"),
      occ("b", 0.5, 0.9, "world."),
      occ("c", 10, 10.4, "Again"),
    ]);
    expect(transcriptText(paragraphs)).toBe("Hello world.\n\nAgain");
  });
});
