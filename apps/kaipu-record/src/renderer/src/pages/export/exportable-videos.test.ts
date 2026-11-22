import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { exportableVideos } from "./exportable-videos";

// illustrative: only the fields the filter reads
const v = (over: Partial<LibraryVideo> & { assetId: string }): LibraryVideo =>
  ({
    id: `id-${over.assetId}`,
    kind: "recording",
    createdAt: 1,
    derivedFromAssetId: null,
    ...over,
  }) as LibraryVideo;

describe("exportableVideos", () => {
  it("keeps local original recordings, newest first", () => {
    const list = exportableVideos([
      v({ assetId: "old", createdAt: 1 }),
      v({ assetId: "new", createdAt: 3 }),
      v({ assetId: "mid", createdAt: 2 }),
    ]);
    expect(list.map((x) => x.assetId)).toEqual(["new", "mid", "old"]);
  });

  it("leaves out copies, screenshots and cloud-only items", () => {
    const list = exportableVideos([
      v({ assetId: "copy", derivedFromAssetId: "old" }),
      v({ assetId: "shot", kind: "screenshot" }),
      v({ assetId: "cloud", id: null }),
      v({ assetId: "ok" }),
    ]);
    expect(list.map((x) => x.assetId)).toEqual(["ok"]);
  });
});
