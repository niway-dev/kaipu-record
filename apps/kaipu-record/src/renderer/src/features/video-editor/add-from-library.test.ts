import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { joinableRecordings, resolutionLabel } from "./add-from-library";

function video(over: Partial<LibraryVideo> & { assetId: string }): LibraryVideo {
  return {
    id: `id-${over.assetId}`,
    kind: "recording",
    title: `Title ${over.assetId}`,
    createdAt: 1,
    durationSeconds: 10,
    derivedFromAssetId: null,
    ...over,
  } as LibraryVideo;
}

const ids = (videos: LibraryVideo[]): string[] => videos.map((v) => v.assetId);

describe("joinableRecordings", () => {
  it("keeps only Kaipu recordings: no screenshots, no gifs", () => {
    const list = [
      video({ assetId: "a" }),
      video({ assetId: "shot", kind: "screenshot" }),
      video({ assetId: "gif", kind: "gif" }),
    ];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["a"]);
  });

  it("leaves out the recording being edited, by asset id", () => {
    const list = [video({ assetId: "opened" }), video({ assetId: "other" })];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["other"]);
  });

  it("leaves out a cloud-only recording, which has no local file to join", () => {
    const list = [video({ assetId: "cloud", id: null }), video({ assetId: "local" })];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["local"]);
  });

  it("leaves out exports, which are derived from another recording", () => {
    const list = [video({ assetId: "export", derivedFromAssetId: "a" }), video({ assetId: "a" })];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["a"]);
  });

  it("leaves out a recording whose sidecar could not be read", () => {
    const list = [
      video({ assetId: "broken", metadataIssue: "unreadable" }),
      video({ assetId: "fine" }),
    ];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["fine"]);
  });

  it("leaves out a recording too short to make a clip", () => {
    const list = [
      video({ assetId: "empty", durationSeconds: 0 }),
      video({ assetId: "sliver", durationSeconds: 0.05 }),
      video({ assetId: "ok", durationSeconds: 0.1 }),
    ];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["ok"]);
  });

  it("lists newest first", () => {
    const list = [
      video({ assetId: "old", createdAt: 1 }),
      video({ assetId: "new", createdAt: 3 }),
      video({ assetId: "mid", createdAt: 2 }),
    ];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["new", "mid", "old"]);
  });

  it("matches the title case-insensitively on the trimmed query", () => {
    const list = [
      video({ assetId: "a", title: "Checkout bug" }),
      video({ assetId: "b", title: "Signup flow" }),
    ];
    expect(ids(joinableRecordings(list, "opened", "  CHECK "))).toEqual(["a"]);
    expect(ids(joinableRecordings(list, "opened", "nothing"))).toEqual([]);
  });

  it("treats a blank query as no filter", () => {
    const list = [video({ assetId: "a" }), video({ assetId: "b" })];
    expect(ids(joinableRecordings(list, "opened", "   "))).toHaveLength(2);
  });

  it("keeps a recording the scene already joined: joining it again is a new copy", () => {
    // The scene is not an input: nothing about "already joined" removes a row.
    const list = [video({ assetId: "joined-before" })];
    expect(ids(joinableRecordings(list, "opened", ""))).toEqual(["joined-before"]);
  });
});

describe("resolutionLabel", () => {
  it("writes the capture size as width × height", () => {
    const v = video({ assetId: "a", capture: { width: 1440, height: 1080 } as never });
    expect(resolutionLabel(v)).toBe("1440 × 1080");
  });

  it("is null when the capture is unknown", () => {
    expect(resolutionLabel(video({ assetId: "a", capture: null }))).toBeNull();
    expect(resolutionLabel(video({ assetId: "a" }))).toBeNull();
  });

  it("is null when the size is zero or missing", () => {
    expect(
      resolutionLabel(video({ assetId: "a", capture: { width: 0, height: 0 } as never })),
    ).toBeNull();
  });
});
