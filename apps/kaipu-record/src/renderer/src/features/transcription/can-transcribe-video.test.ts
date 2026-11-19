import { describe, expect, it } from "vitest";
import { canTranscribeVideo } from "./can-transcribe-video";

describe("canTranscribeVideo", () => {
  it("accepts a local recording whose audio is known or unknown", () => {
    expect(canTranscribeVideo({ kind: "recording", id: "a" })).toBe(true);
    expect(canTranscribeVideo({ kind: "recording", id: "a" }, true)).toBe(true);
  });

  it.each([
    ["a screenshot", { kind: "screenshot" as const, id: "a" }, undefined],
    ["a GIF export", { kind: "gif" as const, id: "a" }, undefined],
    ["a cloud-only item", { kind: "recording" as const, id: null }, undefined],
    ["a recording without audio", { kind: "recording" as const, id: "a" }, false],
  ])("rejects %s", (_name, video, hasAudio) => {
    expect(canTranscribeVideo(video, hasAudio)).toBe(false);
  });
});
