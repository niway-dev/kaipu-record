import { describe, expect, it } from "vitest";
import { mediaRows, placeMedia } from "../../src/renderer/src/features/video-editor/media";
import { parseSession } from "../../src/renderer/src/features/video-editor/session";
import { toLayout } from "../../src/renderer/src/features/video-editor/timeline";
import { FLOATING_IMAGES, floatingScene } from "./seed-vault";

describe("floatingScene", () => {
  it("is a saved edit the editor's own reader accepts, with two overlapping floating images", () => {
    const session = parseSession(JSON.stringify({ version: 1, scene: floatingScene(9) }));
    expect(session).not.toBeNull();
    const scene = session!.scene;
    expect(scene.media?.map((m) => m.id)).toEqual([
      FLOATING_IMAGES.back.id,
      FLOATING_IMAGES.front.id,
    ]);
    const placed = placeMedia(scene.media, toLayout(scene.items));
    expect(placed.map((p) => [p.start, p.end])).toEqual([
      [0, 6],
      [0, 5],
    ]);
    // Overlapping in time: two rows, the front image above.
    const rows = mediaRows(placed);
    expect(rows.get(FLOATING_IMAGES.back.id)).toBe(1);
    expect(rows.get(FLOATING_IMAGES.front.id)).toBe(2);
  });
});
