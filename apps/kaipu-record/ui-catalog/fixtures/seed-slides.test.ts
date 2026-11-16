import { describe, expect, it } from "vitest";
import { parseSession } from "../../src/renderer/src/features/video-editor/session";
import { SLIDE_IMAGES, slideScene } from "./seed-vault";

describe("slideScene", () => {
  it("is a session the editor's reader accepts: one clip, then three slides", () => {
    const session = parseSession(JSON.stringify({ version: 1, scene: slideScene(9) }), 9);
    expect(session).not.toBeNull();
    expect(session!.scene.items.map((item) => item.kind)).toEqual([
      "clip",
      "slide",
      "slide",
      "slide",
    ]);
    expect(SLIDE_IMAGES).toHaveLength(3);
  });
});
