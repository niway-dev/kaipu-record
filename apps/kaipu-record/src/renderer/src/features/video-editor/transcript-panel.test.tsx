import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TranscriptDocument,
  TranscriptWord,
  TranscriptionModelInfo,
  TranscriptionStatus,
} from "@shared/types/transcription";
import type { TranscribeControlState } from "@renderer/features/transcription/transcribe-control";
import type { TranscriptApi } from "@renderer/features/transcription/use-transcript";
import type { LayoutEntry } from "./timeline";
import { TranscriptPanel, type TranscriptPanelProps } from "./transcript-panel";

const hooks = vi.hoisted(() => ({
  transcript: vi.fn(),
  control: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@renderer/features/transcription/use-transcript", () => ({
  useTranscript: hooks.transcript,
}));
vi.mock("@renderer/features/transcription/use-transcribe-control", () => ({
  useTranscribeControl: hooks.control,
}));
vi.mock("@renderer/features/transcription/use-transcription-status", () => ({
  useTranscriptionStatus: hooks.status,
}));

function word(id: string, text: string, startMs: number, endMs: number): TranscriptWord {
  return { id, segmentId: "s1", text, startMs, endMs, logProb: -0.1 };
}

function doc(over: Partial<TranscriptDocument> = {}): TranscriptDocument {
  return {
    schemaVersion: 1,
    model: { id: "m", revision: "1", files: {} },
    engine: { name: "sherpa", version: "1" },
    media: { contentHash: "h", durationMs: 20_000 },
    createdAt: "2026-11-15T00:00:00.000Z",
    segments: [],
    unresolved: [],
    words: [
      word("w1", "Hello", 1000, 1400),
      word("w2", "brave", 1500, 1900),
      word("w3", "new", 2000, 2300),
      word("w4", "world.", 2400, 2900),
      // A long silence, so the next words start a second paragraph.
      word("w5", "Hello", 8000, 8400),
      word("w6", "again", 8500, 8900),
    ],
    ...over,
  };
}

const READY = (over: Partial<TranscriptDocument> = {}, stale = false): TranscriptApi => ({
  state: "ready",
  transcript: doc(over),
  stale,
  refresh: vi.fn(async () => {}),
});
const NO_TRANSCRIPT: TranscriptApi = {
  state: "none",
  transcript: null,
  stale: false,
  refresh: vi.fn(async () => {}),
};

const start = vi.fn(async () => null);
const cancel = vi.fn();
function control(state: TranscribeControlState): void {
  hooks.control.mockReturnValue({ state, start, cancel });
}

const MODEL: TranscriptionModelInfo = {
  id: "parakeet",
  label: "Parakeet TDT 0.6B v3",
  languages: ["en", "es"],
  sizeBytes: 640_000_000,
  location: "/models/parakeet",
  license: { name: "CC-BY-4.0", attribution: "By NVIDIA.", url: "https://example.com/license" },
  status: { state: "missing" },
};
const download = vi.fn(async () => {});
function modelStatus(status: TranscriptionModelInfo["status"]): void {
  const value: TranscriptionStatus = {
    availability: { status: "available" },
    defaultModelId: MODEL.id,
    models: [{ ...MODEL, status }],
    job: null,
  };
  hooks.status.mockReturnValue({
    status: value,
    failures: {},
    refresh: vi.fn(),
    download,
    cancel: vi.fn(),
    remove: vi.fn(),
  });
}

/** One clip that plays the first 20 s of the source, untouched. */
const WHOLE: LayoutEntry[] = [
  {
    itemId: "clip",
    kind: "clip",
    timelineStart: 0,
    timelineEnd: 20,
    sourceStart: 0,
    sourceEnd: 20,
  },
];

let timeListener: ((t: number) => void) | null = null;
const unsubscribe = vi.fn();
let playhead = 0;

function baseProps(over: Partial<TranscriptPanelProps> = {}): TranscriptPanelProps {
  return {
    itemId: "item-1",
    assetId: "asset-1",
    mediaUrl: "kaipu-media://recording/item-1",
    durationMs: 20_000,
    layout: WHOLE,
    audioMuted: false,
    mutedRanges: [],
    hasAudio: true,
    onSeek: vi.fn(),
    subscribeTime: (listener) => {
      timeListener = listener;
      return unsubscribe;
    },
    readTime: () => playhead,
    onClose: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<TranscriptPanelProps> = {}): TranscriptPanelProps {
  const props = baseProps(over);
  render(<TranscriptPanel {...props} />);
  return props;
}

const panel = (): HTMLElement => screen.getByTestId("transcript-panel");

beforeEach(() => {
  hooks.transcript.mockReturnValue(READY());
  control({ kind: "done" });
  modelStatus({ state: "missing" });
  timeListener = null;
  playhead = 0;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TranscriptPanel — states", () => {
  it("is loading while the transcript file is read", () => {
    hooks.transcript.mockReturnValue({ ...NO_TRANSCRIPT, state: "loading" });
    control({ kind: "idle" });
    setup();
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByText("Loading the transcript…")).toBeInTheDocument();
  });

  it("idle: explains there is no transcript and offers Transcribe, not Translate", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "idle" });
    setup();
    expect(panel()).toHaveAttribute("data-state", "idle");
    expect(screen.queryByRole("button", { name: /translate/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("model missing: explains, then opens the model offer, whose Download starts the download", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "needs-model" });
    setup();
    expect(panel()).toHaveAttribute("data-state", "needsModel");
    expect(screen.getByText(/needs a speech model/)).toBeInTheDocument();
    expect(screen.queryByTestId("model-offer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Download the speech model" }));
    const offer = screen.getByTestId("model-offer");
    expect(within(offer).getByText("640 MB")).toBeInTheDocument();
    fireEvent.click(within(offer).getByRole("button", { name: "Download" }));
    expect(download).toHaveBeenCalledWith(MODEL.id);
    expect(start).not.toHaveBeenCalled();
  });

  it("model downloading: shows the download's progress", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "model-downloading" });
    modelStatus({ state: "downloading", receivedBytes: 320_000_000, totalBytes: 640_000_000 });
    setup();
    expect(panel()).toHaveAttribute("data-state", "downloading");
    expect(screen.getByTestId("model-offer-progress")).toHaveAttribute("aria-valuenow", "50");
  });

  it("transcribing: shows the parts done and Cancel stops the job", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "running", phase: "transcribing", segmentsDone: 3, segmentsTotal: 8 });
    setup();
    expect(panel()).toHaveAttribute("data-state", "transcribing");
    expect(screen.getByTestId("transcript-progress")).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByTestId("transcript-progress")).toHaveAttribute("aria-valuemax", "8");
    expect(screen.getByText("3 of 8 parts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("transcribing before the first progress: an indeterminate bar, no count", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "running", phase: "starting", segmentsDone: 0, segmentsTotal: 0 });
    setup();
    expect(screen.getByText("Getting the audio ready")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-progress")).not.toHaveAttribute("aria-valuenow");
    expect(screen.queryByText(/parts/)).toBeNull();
  });

  it("done: paragraphs with their start time", () => {
    setup();
    expect(panel()).toHaveAttribute("data-state", "done");
    expect(screen.getByRole("button", { name: "Go to 0:01" })).toHaveTextContent("0:01");
    expect(screen.getByRole("button", { name: "Go to 0:08" })).toHaveTextContent("0:08");
    expect(screen.getByTestId("transcript-list")).toHaveTextContent("Hello brave new world.");
    expect(screen.queryByTestId("transcript-stale")).toBeNull();
    expect(screen.queryByTestId("transcript-unresolved-note")).toBeNull();
  });

  it("done with unresolved intervals: marks them in the text and says so", () => {
    hooks.transcript.mockReturnValue(
      READY({ unresolved: [{ startMs: 4000, endMs: 6000, reason: "empty-with-speech" }] }),
    );
    setup();
    expect(panel()).toHaveAttribute("data-state", "unresolved");
    expect(screen.getByTestId("transcript-unresolved-note")).toBeInTheDocument();
    const gaps = screen.getAllByTestId("transcript-gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toHaveTextContent("[not recognised]");
    // The words around it are still there.
    expect(screen.getByTestId("transcript-list")).toHaveTextContent("Hello again");
  });

  it("marks an unresolved stretch inside a paragraph, between its words", () => {
    hooks.transcript.mockReturnValue(
      READY({ unresolved: [{ startMs: 1950, endMs: 1990, reason: "segment-failed" }] }),
    );
    setup();
    expect(screen.queryByTestId("transcript-gap")).toBeNull();
    expect(screen.getByText("[not recognised]")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-list")).toHaveTextContent(
      "Hello brave [not recognised] new world.",
    );
  });

  it("stale: a banner over the old words, and Transcribe again starts a new job", () => {
    hooks.transcript.mockReturnValue(READY({}, true));
    control({ kind: "idle" });
    setup();
    expect(panel()).toHaveAttribute("data-state", "stale");
    const banner = screen.getByTestId("transcript-stale");
    expect(banner).toHaveTextContent("This transcript is out of date");
    expect(screen.getByTestId("transcript-list")).toHaveTextContent("Hello brave new world.");
    fireEvent.click(within(banner).getByRole("button", { name: "Transcribe again" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it.each([
    ["busy-elsewhere", { kind: "busy-elsewhere" } as const, /Another video is being transcribed/],
    ["model-downloading", { kind: "model-downloading" } as const, /speech model is downloading/],
  ])(
    "stale while the control is %s: Transcribe again is disabled and says why",
    (_name, state, why) => {
      hooks.transcript.mockReturnValue(READY({}, true));
      control(state);
      setup();
      const button = within(screen.getByTestId("transcript-stale")).getByRole("button", {
        name: "Transcribe again",
      });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", expect.stringMatching(why));
      fireEvent.click(button);
      expect(start).not.toHaveBeenCalled();
    },
  );

  it("stale and startable: Transcribe again is enabled with no tooltip", () => {
    hooks.transcript.mockReturnValue(READY({}, true));
    control({ kind: "idle" });
    setup();
    const button = screen.getByRole("button", { name: "Transcribe again" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("title");
  });

  it("stale without the model: Transcribe again opens the offer instead of a job", () => {
    hooks.transcript.mockReturnValue(READY({}, true));
    control({ kind: "needs-model" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Transcribe again" }));
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByTestId("model-offer")).toBeInTheDocument();
  });

  it("stale and the second attempt failed: keeps the words and says why", () => {
    hooks.transcript.mockReturnValue(READY({}, true));
    control({ kind: "failed", failure: "engine-failed" });
    setup();
    expect(screen.getByTestId("transcript-stale")).toHaveTextContent(
      "The transcription engine stopped before it finished.",
    );
    expect(screen.getByTestId("transcript-list")).toBeInTheDocument();
  });

  it("failed: the reason and Try again", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "failed", failure: "write-failed" });
    setup();
    expect(panel()).toHaveAttribute("data-state", "failed");
    expect(screen.getByRole("alert")).toHaveTextContent("could not be saved to disk");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("failed: an unreadable transcript file says so and can be retried", () => {
    hooks.transcript.mockReturnValue({ ...NO_TRANSCRIPT, state: "invalid" });
    control({ kind: "idle" });
    setup();
    expect(panel()).toHaveAttribute("data-state", "failed");
    expect(screen.getByRole("alert")).toHaveTextContent("The saved transcript could not be read.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("no audio: explains and offers no button, whether the probe or the engine found it", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "idle" });
    setup({ hasAudio: false });
    expect(panel()).toHaveAttribute("data-state", "noAudio");
    expect(screen.getByText(/no audio track/)).toBeInTheDocument();
    expect(within(panel()).queryAllByRole("button")).toHaveLength(1); // only Close
    cleanup();
    control({ kind: "failed", failure: "no-audio" });
    setup({ hasAudio: null });
    expect(panel()).toHaveAttribute("data-state", "noAudio");
  });

  it("unavailable: explains, no crash, no button but Close", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "unavailable" });
    setup();
    expect(panel()).toHaveAttribute("data-state", "unavailable");
    expect(screen.getByText(/cannot run on this Mac/)).toBeInTheDocument();
    expect(within(panel()).queryAllByRole("button")).toHaveLength(1);
  });

  it("busy: another video holds the engine", () => {
    hooks.transcript.mockReturnValue(NO_TRANSCRIPT);
    control({ kind: "busy-elsewhere" });
    setup();
    expect(panel()).toHaveAttribute("data-state", "busy");
  });

  it("Close calls onClose", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close transcript" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});

describe("TranscriptPanel — the edited video's words only", () => {
  it("drops words that were cut, and words in a muted range", () => {
    // Source 0..2.2 and 8..9 play; 2.2..8 is cut. "new" (2.0..2.3) is half in the cut and
    // half out, so it still plays; "world." (2.4..2.9) is cut. "Hello" at 1.0 is muted.
    const layout: LayoutEntry[] = [
      {
        itemId: "a",
        kind: "clip",
        timelineStart: 0,
        timelineEnd: 2.2,
        sourceStart: 0,
        sourceEnd: 2.2,
      },
      {
        itemId: "b",
        kind: "clip",
        timelineStart: 2.2,
        timelineEnd: 3.2,
        sourceStart: 8,
        sourceEnd: 9,
      },
    ];
    setup({ layout, mutedRanges: [{ id: "m", sourceStart: 0.9, sourceEnd: 1.5 }] });
    const text = screen.getByTestId("transcript-list").textContent ?? "";
    expect(text).not.toContain("world.");
    expect(text).not.toMatch(/Hello brave/);
    expect(text).toContain("brave new");
    expect(text).toContain("Hello again");
  });

  it("says nothing is left when the whole audio is muted", () => {
    setup({ audioMuted: true });
    expect(screen.queryByTestId("transcript-list")).toBeNull();
    expect(screen.getByText(/No spoken words are left/)).toBeInTheDocument();
  });

  it("shows repeated footage twice, each repeat on its own timeline time", () => {
    const layout: LayoutEntry[] = [
      { itemId: "a", kind: "clip", timelineStart: 0, timelineEnd: 3, sourceStart: 0, sourceEnd: 3 },
      { itemId: "b", kind: "clip", timelineStart: 3, timelineEnd: 6, sourceStart: 0, sourceEnd: 3 },
    ];
    const props = setup({ layout });
    const words = screen.getAllByText("brave");
    expect(words).toHaveLength(2);
    fireEvent.click(words[1]);
    expect(props.onSeek).toHaveBeenLastCalledWith(4.5);
    fireEvent.click(words[0]);
    expect(props.onSeek).toHaveBeenLastCalledWith(1.5);
  });
});

describe("TranscriptPanel — seek and the playing word", () => {
  it("clicking a word moves the playhead to that word", () => {
    const props = setup();
    fireEvent.click(screen.getByText("new"));
    expect(props.onSeek).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("clicking a paragraph's time moves the playhead to its start", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Go to 0:08" }));
    expect(props.onSeek).toHaveBeenCalledExactlyOnceWith(8);
  });

  it("highlights the playing word from the playhead's clock, one word at a time", () => {
    setup();
    expect(timeListener).not.toBeNull();
    const current = (): string[] =>
      Array.from(document.querySelectorAll("[data-current]")).map((el) => el.textContent ?? "");
    expect(current()).toEqual([]);

    act(() => timeListener?.(1.2));
    expect(current()).toEqual(["Hello"]);
    act(() => timeListener?.(2.1));
    expect(current()).toEqual(["new"]);
    // In a long silence nothing is highlighted.
    act(() => timeListener?.(5));
    expect(current()).toEqual([]);
    act(() => timeListener?.(8.6));
    expect(current()).toEqual(["again"]);
  });

  it("does not re-render the words as time passes: the same elements, only an attribute moves", () => {
    setup();
    const brave = screen.getByText("brave");
    act(() => timeListener?.(1.6));
    expect(screen.getByText("brave")).toBe(brave);
    expect(brave).toHaveAttribute("data-current");
    act(() => timeListener?.(2.1));
    expect(screen.getByText("brave")).toBe(brave);
    expect(brave).not.toHaveAttribute("data-current");
  });

  it("marks the playing word again after the list is unmounted and mounted back", () => {
    const props = baseProps();
    const { rerender } = render(<TranscriptPanel {...props} />);
    // A job for this video takes the list's place, then the same transcript is shown again.
    control({ kind: "running", phase: "transcribing", segmentsDone: 1, segmentsTotal: 2 });
    rerender(<TranscriptPanel {...props} />);
    expect(screen.queryByTestId("transcript-list")).toBeNull();
    control({ kind: "done" });
    rerender(<TranscriptPanel {...props} />);

    act(() => timeListener?.(2.1));
    expect(
      Array.from(document.querySelectorAll("[data-current]")).map((el) => el.textContent),
    ).toEqual(["new"]);
  });

  it("starts from where the playhead is when it opens", () => {
    playhead = 2.45;
    setup();
    expect(document.querySelector("[data-current]")).toHaveTextContent("world.");
  });

  it("stops listening when it closes", () => {
    setup();
    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("TranscriptPanel — search", () => {
  it("counts matches, marks them and Enter goes to the next, wrapping", () => {
    const props = setup();
    const input = screen.getByRole("searchbox", { name: "Search the transcript" });
    fireEvent.change(input, { target: { value: "hello" } });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-match]")).toHaveLength(2);
    expect(document.querySelector("[data-match-current]")).toBe(
      document.querySelectorAll("[data-match]")[0],
    );
    // Typing alone never moves the playhead.
    expect(props.onSeek).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
    expect(props.onSeek).toHaveBeenLastCalledWith(8);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(props.onSeek).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("marks the matches again after the list is unmounted and mounted back", () => {
    const props = baseProps();
    const { rerender } = render(<TranscriptPanel {...props} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hello" } });
    expect(document.querySelectorAll("[data-match]")).toHaveLength(2);
    control({ kind: "running", phase: "transcribing", segmentsDone: 1, segmentsTotal: 2 });
    rerender(<TranscriptPanel {...props} />);
    control({ kind: "done" });
    rerender(<TranscriptPanel {...props} />);

    expect(document.querySelectorAll("[data-match]")).toHaveLength(2);
    expect(document.querySelector("[data-match-current]")).toBe(
      document.querySelectorAll("[data-match]")[0],
    );
  });

  it("the previous and next buttons move between matches", () => {
    const props = setup();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(props.onSeek).toHaveBeenLastCalledWith(8);
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(props.onSeek).toHaveBeenLastCalledWith(1);
  });

  it("ignores case and accents, and says when nothing matches", () => {
    setup();
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "HELLO" } });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "zebra" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
    expect(document.querySelectorAll("[data-match]")).toHaveLength(0);
  });

  it("clears the marks when the query is emptied", () => {
    setup();
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(document.querySelectorAll("[data-match]")).toHaveLength(0);
  });
});

describe("TranscriptPanel — copy", () => {
  const writeText = vi.fn(async (_text: string) => {});
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("copies every paragraph of the edited text and confirms", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy all text/ }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Hello brave new world.\n\nHello again");
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("copies only what the edit keeps", async () => {
    const layout: LayoutEntry[] = [
      { itemId: "b", kind: "clip", timelineStart: 0, timelineEnd: 1, sourceStart: 8, sourceEnd: 9 },
    ];
    setup({ layout });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy all text/ }));
    });
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Hello again");
  });

  it("is disabled with nothing to copy", () => {
    setup({ audioMuted: true });
    expect(screen.getByRole("button", { name: /Copy all text/ })).toBeDisabled();
  });
});

describe("TranscriptPanel — long transcripts", () => {
  it("renders a long transcript as paragraphs and seeks from one delegated handler", () => {
    // About 60 minutes of speech: 7,200 words, one every half second, a pause every 12.
    const words: TranscriptWord[] = [];
    for (let i = 0; i < 7200; i++) {
      const group = Math.floor(i / 12);
      const startMs = i * 500 + group * 2000;
      words.push(word(`w${i}`, `word${i}`, startMs, startMs + 300));
    }
    const lastEnd = words[words.length - 1].endMs / 1000;
    const layout: LayoutEntry[] = [
      {
        itemId: "clip",
        kind: "clip",
        timelineStart: 0,
        timelineEnd: lastEnd,
        sourceStart: 0,
        sourceEnd: lastEnd,
      },
    ];
    hooks.transcript.mockReturnValue(READY({ words }));
    const props = setup({ layout });
    expect(document.querySelectorAll("[data-w]")).toHaveLength(7200);
    expect(document.querySelectorAll("[data-seek]").length).toBeLessThanOrEqual(600);
    // No word carries its own handler: a click is caught by the list.
    fireEvent.click(screen.getByText("word3600"));
    expect(props.onSeek).toHaveBeenCalledExactlyOnceWith(words[3600].startMs / 1000);
  });
});
