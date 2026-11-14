import { describe, expect, it } from "vitest";
import { recordingAt, sourceAxis } from "../../src/renderer/src/features/video-editor/source-axis";
import { parseSession } from "../../src/renderer/src/features/video-editor/session";
import { toLayout } from "../../src/renderer/src/features/video-editor/timeline";
import { ASSETS, JOINED_MISSING_ASSET, JOINED_OFFSET, joinedScene } from "./seed-vault";

describe("joinedScene", () => {
  it("is a version 2 session the editor's reader accepts, clips alternating A, B, A", () => {
    const session = parseSession(
      JSON.stringify({ version: 2, scene: joinedScene("present", 12) }),
      12,
    );
    expect(session).not.toBeNull();
    const { scene } = session!;
    expect(scene.sources).toEqual([
      expect.objectContaining({
        assetId: ASSETS.joinedSecond,
        title: "Checkout bug",
        offset: JOINED_OFFSET,
        durationSeconds: 7,
      }),
    ]);
    const axis = sourceAxis(12, scene.sources);
    const owners = toLayout(scene.items).map((entry) => {
      const found = recordingAt(axis, entry.sourceStart);
      return found ? found.recording.sourceId : "none";
    });
    expect(owners).toEqual([null, "join-b", null]);
  });

  it("joins a recording that is not in the vault for the missing state", () => {
    const session = parseSession(
      JSON.stringify({ version: 2, scene: joinedScene("missing", 9) }),
      9,
    );
    expect(session?.scene.sources?.[0].assetId).toBe(JOINED_MISSING_ASSET);
  });
});
