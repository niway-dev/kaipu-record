import { describe, expect, it } from "vitest";
import {
  handOffFor,
  parseRecordingReadyAction,
  parseRecordingReadyPayload,
  type RecordingReadyPayload,
} from "./recording-ready";

const FRESH: RecordingReadyPayload = {
  assetId: "a1",
  durationSeconds: 78,
  dimensions: { width: 1920, height: 1080 },
  sizeBytes: 4_000_000,
  canEdit: true,
};

describe("parseRecordingReadyAction", () => {
  it("keeps the card's actions and drops anything else", () => {
    expect(parseRecordingReadyAction({ kind: "pick", destination: "youtube" })).toEqual({
      kind: "pick",
      destination: "youtube",
    });
    expect(parseRecordingReadyAction({ kind: "pick", destination: null })).toEqual({
      kind: "pick",
      destination: null,
    });
    expect(parseRecordingReadyAction({ kind: "open", extra: 1 })).toEqual({ kind: "open" });
    expect(parseRecordingReadyAction({ kind: "pick", destination: "square" })).toBeNull();
    expect(parseRecordingReadyAction({ kind: "pick" })).toBeNull();
    expect(parseRecordingReadyAction("dismiss")).toBeNull();
    expect(parseRecordingReadyAction(null)).toBeNull();
  });
});

describe("parseRecordingReadyPayload", () => {
  it("keeps a well-formed payload and refuses a malformed one", () => {
    expect(parseRecordingReadyPayload(FRESH)).toEqual(FRESH);
    expect(parseRecordingReadyPayload({ ...FRESH, dimensions: null })).toEqual({
      ...FRESH,
      dimensions: null,
    });
    expect(parseRecordingReadyPayload({ ...FRESH, assetId: "" })).toBeNull();
    expect(parseRecordingReadyPayload({ ...FRESH, sizeBytes: Number.NaN })).toBeNull();
    expect(parseRecordingReadyPayload({ ...FRESH, dimensions: { width: 1 } })).toBeNull();
    expect(parseRecordingReadyPayload({ ...FRESH, canEdit: "yes" })).toBeNull();
  });
});

describe("handOffFor", () => {
  it("maps each action to where the main window goes; ✕ goes nowhere", () => {
    expect(handOffFor({ kind: "pick", destination: "vertical" }, FRESH)).toEqual({
      target: "prepare",
      assetId: "a1",
      destination: "vertical",
    });
    expect(handOffFor({ kind: "edit" }, FRESH)).toEqual({ target: "editor", assetId: "a1" });
    expect(handOffFor({ kind: "edit" }, { ...FRESH, canEdit: false })).toBeNull();
    expect(handOffFor({ kind: "open" }, FRESH)).toEqual({ target: "detail", assetId: "a1" });
    expect(handOffFor({ kind: "dismiss" }, FRESH)).toBeNull();
  });
});
