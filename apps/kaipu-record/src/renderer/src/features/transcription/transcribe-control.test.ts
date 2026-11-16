import { describe, expect, it } from "vitest";
import {
  transcribeControlState,
  type TranscribeControlInput,
  type TranscribeControlState,
} from "./transcribe-control";

/** An item that could be transcribed right now; each test spoils one thing. */
const BASE: TranscribeControlInput = {
  flagOn: true,
  hasLocalMedia: true,
  availability: { status: "available" },
  defaultModelReady: true,
  downloading: false,
  transcript: "none",
  running: null,
  busyElsewhere: false,
  failure: null,
};

const RUNNING = { itemId: "a", phase: "transcribing", segmentsDone: 3, segmentsTotal: 9 } as const;
const UNAVAILABLE = { status: "unavailable", reason: "engine-missing" } as const;

function stateOf(over: Partial<TranscribeControlInput>): TranscribeControlState {
  return transcribeControlState({ ...BASE, ...over });
}

describe("transcribeControlState kinds", () => {
  it("is idle when nothing stands in the way", () => {
    expect(stateOf({})).toEqual({ kind: "idle" });
  });

  it("is hidden with the flag off", () => {
    expect(stateOf({ flagOn: false })).toEqual({ kind: "hidden" });
  });

  it("is hidden without local media", () => {
    expect(stateOf({ hasLocalMedia: false })).toEqual({ kind: "hidden" });
  });

  it("is unavailable when the engine cannot run", () => {
    expect(stateOf({ availability: UNAVAILABLE })).toEqual({ kind: "unavailable" });
  });

  it("is loading before the status arrives", () => {
    expect(stateOf({ availability: null, defaultModelReady: null })).toEqual({ kind: "loading" });
  });

  it("is loading while the model state is unknown", () => {
    expect(stateOf({ defaultModelReady: null })).toEqual({ kind: "loading" });
  });

  it("needs a model when it is not installed and not downloading", () => {
    expect(stateOf({ defaultModelReady: false })).toEqual({ kind: "needs-model" });
  });

  it("shows the model downloading", () => {
    expect(stateOf({ defaultModelReady: false, downloading: true })).toEqual({
      kind: "model-downloading",
    });
  });

  it("carries the progress while running", () => {
    expect(stateOf({ running: RUNNING })).toEqual({
      kind: "running",
      phase: "transcribing",
      segmentsDone: 3,
      segmentsTotal: 9,
    });
  });

  it("is busy elsewhere when another item's job runs", () => {
    expect(stateOf({ busyElsewhere: true })).toEqual({ kind: "busy-elsewhere" });
  });

  it("carries the failure when the last attempt failed", () => {
    expect(stateOf({ failure: "engine-failed" })).toEqual({
      kind: "failed",
      failure: "engine-failed",
    });
  });

  it("is done with a ready transcript", () => {
    expect(stateOf({ transcript: "ready" })).toEqual({ kind: "done" });
  });

  it("is stale with an out-of-date transcript", () => {
    expect(stateOf({ transcript: "stale" })).toEqual({ kind: "stale" });
  });

  it("is invalid with an unreadable transcript", () => {
    expect(stateOf({ transcript: "invalid" })).toEqual({ kind: "invalid" });
  });

  it("treats an unknown transcript like none", () => {
    expect(stateOf({ transcript: "unknown" })).toEqual({ kind: "idle" });
    expect(stateOf({ transcript: "unknown", failure: "write-failed" })).toEqual({
      kind: "failed",
      failure: "write-failed",
    });
  });
});

describe("transcribeControlState precedence", () => {
  // hidden > running > unavailable > loading > failed(only when none) > done/stale/invalid
  //   > busy-elsewhere > model-downloading > needs-model > idle
  const cases: Array<[string, Partial<TranscribeControlInput>, TranscribeControlState["kind"]]> = [
    ["hidden over running", { flagOn: false, running: RUNNING }, "hidden"],
    ["hidden over unavailable", { hasLocalMedia: false, availability: UNAVAILABLE }, "hidden"],
    ["running over unavailable", { running: RUNNING, availability: UNAVAILABLE }, "running"],
    ["running over a ready transcript", { running: RUNNING, transcript: "ready" }, "running"],
    ["running over busy elsewhere", { running: RUNNING, busyElsewhere: true }, "running"],
    [
      "unavailable over loading",
      { availability: UNAVAILABLE, defaultModelReady: null },
      "unavailable",
    ],
    [
      "unavailable over a ready transcript",
      { availability: UNAVAILABLE, transcript: "ready" },
      "unavailable",
    ],
    [
      "unavailable over failed",
      { availability: UNAVAILABLE, failure: "engine-failed" },
      "unavailable",
    ],
    [
      "loading over failed",
      { availability: null, defaultModelReady: null, failure: "unknown" },
      "loading",
    ],
    [
      "loading over a ready transcript",
      { defaultModelReady: null, transcript: "ready" },
      "loading",
    ],
    ["failed over busy elsewhere", { failure: "unknown", busyElsewhere: true }, "failed"],
    ["failed over needs-model", { failure: "unknown", defaultModelReady: false }, "failed"],
    ["done over a failure", { failure: "unknown", transcript: "ready" }, "done"],
    ["stale over a failure", { failure: "unknown", transcript: "stale" }, "stale"],
    ["invalid over a failure", { failure: "unknown", transcript: "invalid" }, "invalid"],
    ["done over busy elsewhere", { transcript: "ready", busyElsewhere: true }, "done"],
    ["stale over needs-model", { transcript: "stale", defaultModelReady: false }, "stale"],
    [
      "invalid over model-downloading",
      { transcript: "invalid", defaultModelReady: false, downloading: true },
      "invalid",
    ],
    [
      "busy elsewhere over model-downloading",
      { busyElsewhere: true, defaultModelReady: false, downloading: true },
      "busy-elsewhere",
    ],
    [
      "busy elsewhere over needs-model",
      { busyElsewhere: true, defaultModelReady: false },
      "busy-elsewhere",
    ],
    [
      "model-downloading over needs-model",
      { downloading: true, defaultModelReady: false },
      "model-downloading",
    ],
  ];

  it.each(cases)("%s", (_name, over, expected) => {
    expect(stateOf(over).kind).toBe(expected);
  });
});
