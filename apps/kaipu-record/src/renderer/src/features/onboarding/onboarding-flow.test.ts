import { describe, expect, it } from "vitest";
import type { TranscriptionModelInfo, TranscriptionStatus } from "@shared/types/transcription";
import {
  canAdvanceFrom,
  canJumpTo,
  skipActionFor,
  stepIndexFor,
  stepsFor,
  transcriptionOfferModel,
  triedShortcutCount,
} from "./onboarding-flow";

const WITHOUT = stepsFor({ offerTranscription: false });
const WITH = stepsFor({ offerTranscription: true });

function transcriptionStatus(
  state: TranscriptionModelInfo["status"],
  over: Partial<TranscriptionStatus> = {},
): TranscriptionStatus {
  return {
    availability: { status: "available" },
    defaultModelId: "parakeet",
    models: [
      {
        id: "parakeet",
        label: "Parakeet",
        languages: ["en"],
        sizeBytes: 640_000_000,
        location: "/models/parakeet",
        license: { name: "CC-BY-4.0", attribution: "Credit", url: "https://example.test/l" },
        status: state,
      },
    ],
    job: null,
    ...over,
  };
}

describe("onboarding flow", () => {
  it("has five steps in order without the offer, six with Transcription before Privacy", () => {
    expect(WITHOUT).toEqual(["welcome", "permissions", "shortcuts", "privacy", "done"]);
    expect(WITH).toEqual([
      "welcome",
      "permissions",
      "shortcuts",
      "transcription",
      "privacy",
      "done",
    ]);
  });

  it("keeps Permissions at the same place, so the dot rules do not depend on the offer", () => {
    expect(WITHOUT.indexOf("permissions")).toBe(WITH.indexOf("permissions"));
  });

  it("lands on the next step still there when the current one left the list", () => {
    expect(stepIndexFor(WITHOUT, "transcription")).toBe(WITHOUT.indexOf("privacy"));
    expect(stepIndexFor(WITH, "transcription")).toBe(WITH.indexOf("transcription"));
    expect(stepIndexFor(WITHOUT, "done")).toBe(WITHOUT.indexOf("done"));
  });

  it("Transcription lets the footer move on and dots jump over it, once Permissions are met", () => {
    const at = WITH.indexOf("transcription");
    expect(canAdvanceFrom("transcription", false)).toBe(true);
    expect(canJumpTo(at, at + 1, false)).toBe(true); // already past Permissions
    expect(canJumpTo(at - 1, at, false)).toBe(true);
    expect(canJumpTo(0, at, false)).toBe(false); // would cross Permissions
    expect(canJumpTo(0, at, true)).toBe(true);
    expect(canJumpTo(WITH.length - 1, at, false)).toBe(true); // going back
  });

  it("only the permissions step blocks, until screen and microphone are granted", () => {
    expect(canAdvanceFrom("welcome", false)).toBe(true);
    expect(canAdvanceFrom("permissions", false)).toBe(false);
    expect(canAdvanceFrom("permissions", true)).toBe(true);
    // Trying shortcuts is optional: Continue is always on.
    expect(canAdvanceFrom("shortcuts", false)).toBe(true);
    // Privacy informs; it never blocks (the toggle is on by default and is not a gate).
    expect(canAdvanceFrom("privacy", false)).toBe(true);
  });

  it("a dot cannot jump past permissions while they are missing", () => {
    expect(canJumpTo(0, 1, false)).toBe(true);
    expect(canJumpTo(0, 2, false)).toBe(false);
    expect(canJumpTo(1, 3, false)).toBe(false);
    expect(canJumpTo(3, 0, false)).toBe(true);
    expect(canJumpTo(0, 3, true)).toBe(true);
    expect(canJumpTo(2, 3, false)).toBe(true); // already past Permissions
  });

  it("the skip link goes to permissions first, then skips the tour once they are met", () => {
    expect(skipActionFor("welcome", false)).toBe("toPermissions");
    expect(skipActionFor("welcome", true)).toBe("toPermissions");
    expect(skipActionFor("permissions", false)).toBe("blocked");
    expect(skipActionFor("permissions", true)).toBe("close");
    expect(skipActionFor("shortcuts", true)).toBe("close");
    expect(skipActionFor("privacy", true)).toBe("close");
    expect(skipActionFor("transcription", true)).toBe("close");
    expect(skipActionFor("done", true)).toBe("none");
  });

  it("offers the default model only when the engine runs and it is missing or failed", () => {
    expect(transcriptionOfferModel(null)).toBeNull();
    expect(transcriptionOfferModel(transcriptionStatus({ state: "missing" }))?.id).toBe("parakeet");
    expect(
      transcriptionOfferModel(transcriptionStatus({ state: "failed", reason: "offline" }))?.id,
    ).toBe("parakeet");
    expect(transcriptionOfferModel(transcriptionStatus({ state: "ready" }))).toBeNull();
    expect(
      transcriptionOfferModel(
        transcriptionStatus({ state: "downloading", receivedBytes: 1, totalBytes: 2 }),
      ),
    ).toBeNull();
    expect(
      transcriptionOfferModel(
        transcriptionStatus(
          { state: "missing" },
          { availability: { status: "unavailable", reason: "engine-missing" } },
        ),
      ),
    ).toBeNull();
    expect(
      transcriptionOfferModel(
        transcriptionStatus({ state: "missing" }, { defaultModelId: "other" }),
      ),
    ).toBeNull();
  });

  it("counts only the four onboarding shortcuts as tried", () => {
    expect(triedShortcutCount(new Set())).toBe(0);
    expect(triedShortcutCount(new Set(["captureScreenshot", "captureWindow"]))).toBe(1);
    expect(
      triedShortcutCount(
        new Set(["captureScreenshot", "startRecording", "captureInstant", "bringToFront"]),
      ),
    ).toBe(4);
  });
});
