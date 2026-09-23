import { describe, expect, it } from "vitest";
import { AVAILABILITIES, hasCloudCopy, hasLocalCopy, type LibraryItem } from "./library-item";

const base: LibraryItem = {
  assetId: "a1",
  kind: "recording",
  title: "Demo",
  createdAt: 1,
  durationSeconds: 10,
  derivedFromAssetId: null,
  editSavedAt: null,
  local: null,
  cloud: null,
  availability: "unverified",
  transfer: { state: "idle" },
  comparison: "pending",
  editing: "exported-only",
  sharing: "private",
};

describe("library item helpers", () => {
  it("derives copy presence from the axes, not from nullable payloads alone", () => {
    expect(hasLocalCopy({ ...base, availability: "local" })).toBe(true);
    expect(hasLocalCopy({ ...base, availability: "local-and-cloud" })).toBe(true);
    expect(hasLocalCopy({ ...base, availability: "local-unavailable" })).toBe(false);
    expect(hasCloudCopy({ ...base, availability: "cloud" })).toBe(true);
    expect(hasCloudCopy({ ...base, availability: "local-unavailable" })).toBe(true);
    expect(hasCloudCopy({ ...base, availability: "local" })).toBe(false);
  });

  it("lists every availability so exhaustive switches stay honest", () => {
    expect(AVAILABILITIES).toEqual([
      "local",
      "cloud",
      "local-and-cloud",
      "local-unavailable",
      "unverified",
    ]);
  });
});
