import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { asPreparable } from "./use-prepare-copy";

const recording = {
  id: "Demo",
  assetId: "a1",
  kind: "recording",
  title: "Demo",
  durationSeconds: 5,
} as LibraryVideo;

describe("asPreparable", () => {
  it("offers a local recording, and never one a synced workspace's provider offloaded", () => {
    expect(asPreparable(recording)?.id).toBe("Demo");
    // Preparing probes the file, and reading an evicted file downloads it (decision 15).
    expect(asPreparable({ ...recording, evicted: "media" })).toBeNull();
    // Only its poster is offloaded: the media is local.
    expect(asPreparable({ ...recording, evicted: "thumbnail" })?.id).toBe("Demo");
    expect(asPreparable({ ...recording, id: null })).toBeNull();
    expect(asPreparable({ ...recording, kind: "screenshot" })).toBeNull();
  });
});
