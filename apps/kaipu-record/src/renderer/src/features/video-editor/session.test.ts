import { describe, expect, it } from "vitest";
import type { VideoScene } from "./scene";
import { parseSession, serializeSession } from "./session";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CLIP_ITEM = {
  id: "clip-1",
  kind: "clip" as const,
  sourceStart: 0,
  sourceEnd: 10,
};

const SLIDE_ITEM = {
  id: "slide-1",
  kind: "slide" as const,
  assetId: "asset-uuid-1",
  duration: 3,
  naturalWidth: 1920,
  naturalHeight: 1080,
};

const BOX_OVERLAY = {
  id: "box-1",
  kind: "box" as const,
  start: 1,
  end: 5,
  color: "#ff0000",
  x: 0.1,
  y: 0.2,
  w: 0.3,
  h: 0.15,
  stroke: 2,
  seed: 42,
};

const ARROW_OVERLAY = {
  id: "arrow-1",
  kind: "arrow" as const,
  start: 2,
  end: 6,
  color: "#00ff00",
  x1: 0.1,
  y1: 0.1,
  x2: 0.9,
  y2: 0.9,
  stroke: 3,
  seed: 99,
};

const TEXT_OVERLAY = {
  id: "text-1",
  kind: "text" as const,
  start: 0,
  end: 8,
  color: "#0000ff",
  x: 0.5,
  y: 0.5,
  text: "Hello world",
  size: 1,
};

const FULL_SCENE: VideoScene = {
  items: [CLIP_ITEM, SLIDE_ITEM],
  overlays: [BOX_OVERLAY, ARROW_OVERLAY, TEXT_OVERLAY],
};

// ── Round-trip ────────────────────────────────────────────────────────────────

describe("serializeSession / parseSession — round-trips", () => {
  it("round-trips a full scene with all three overlay kinds and a slide", () => {
    const json = serializeSession(FULL_SCENE);
    const result = parseSession(json);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.scene.items).toHaveLength(2);
    expect(result!.scene.overlays).toHaveLength(3);

    // Structural equality for each item/overlay type
    const [clip, slide] = result!.scene.items;
    expect(clip).toMatchObject(CLIP_ITEM);
    expect(slide).toMatchObject(SLIDE_ITEM);

    const [box, arrow, text] = result!.scene.overlays;
    expect(box).toMatchObject(BOX_OVERLAY);
    expect(arrow).toMatchObject(ARROW_OVERLAY);
    expect(text).toMatchObject(TEXT_OVERLAY);
  });

  it("round-trips a scene with only clips and no overlays", () => {
    const scene: VideoScene = { items: [CLIP_ITEM], overlays: [] };
    const result = parseSession(serializeSession(scene));
    expect(result).not.toBeNull();
    expect(result!.scene.items).toHaveLength(1);
    expect(result!.scene.overlays).toHaveLength(0);
  });
});

// ── Null paths ────────────────────────────────────────────────────────────────

describe("parseSession — null on invalid input", () => {
  it("returns null for invalid JSON", () => {
    expect(parseSession("not json at all")).toBeNull();
    expect(parseSession("{broken")).toBeNull();
    expect(parseSession("")).toBeNull();
  });

  it("returns null for wrong version", () => {
    const withWrongVersion = JSON.stringify({ version: 2, scene: { items: [], overlays: [] } });
    expect(parseSession(withWrongVersion)).toBeNull();

    const withNoVersion = JSON.stringify({ scene: { items: [], overlays: [] } });
    expect(parseSession(withNoVersion)).toBeNull();
  });

  it("returns null when items array is missing", () => {
    const noItems = JSON.stringify({ version: 1, scene: { overlays: [] } });
    expect(parseSession(noItems)).toBeNull();
  });

  it("returns null when overlays array is missing", () => {
    const noOverlays = JSON.stringify({ version: 1, scene: { items: [] } });
    expect(parseSession(noOverlays)).toBeNull();
  });

  it("returns null for an item with an unknown kind", () => {
    const scene = {
      version: 1,
      scene: {
        items: [{ id: "x", kind: "video", src: "foo" }],
        overlays: [],
      },
    };
    expect(parseSession(JSON.stringify(scene))).toBeNull();
  });

  it("returns null for an overlay with an unknown kind", () => {
    const scene = {
      version: 1,
      scene: {
        items: [],
        overlays: [{ id: "x", kind: "circle", start: 0, end: 1, color: "#fff" }],
      },
    };
    expect(parseSession(JSON.stringify(scene))).toBeNull();
  });

  it("returns null for non-numeric times on a clip item", () => {
    const badClip = {
      version: 1,
      scene: {
        items: [{ id: "c", kind: "clip", sourceStart: "not-a-number", sourceEnd: 10 }],
        overlays: [],
      },
    };
    expect(parseSession(JSON.stringify(badClip))).toBeNull();
  });

  it("returns null for non-numeric times on an overlay", () => {
    const badOverlay = {
      version: 1,
      scene: {
        items: [],
        overlays: [
          {
            id: "o",
            kind: "box",
            start: "two",
            end: 5,
            color: "#f00",
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            stroke: 1,
            seed: 0,
          },
        ],
      },
    };
    expect(parseSession(JSON.stringify(badOverlay))).toBeNull();
  });

  it("returns null for a box overlay missing a required geometry field", () => {
    const badBox = {
      version: 1,
      scene: {
        items: [],
        overlays: [
          // `w` missing
          {
            id: "b",
            kind: "box",
            start: 0,
            end: 1,
            color: "#f00",
            x: 0,
            y: 0,
            h: 1,
            stroke: 1,
            seed: 0,
          },
        ],
      },
    };
    expect(parseSession(JSON.stringify(badBox))).toBeNull();
  });

  it("returns null for an arrow overlay missing a required endpoint field", () => {
    const badArrow = {
      version: 1,
      scene: {
        items: [],
        overlays: [
          // `x2` missing
          {
            id: "a",
            kind: "arrow",
            start: 0,
            end: 1,
            color: "#0f0",
            x1: 0,
            y1: 0,
            y2: 1,
            stroke: 2,
            seed: 7,
          },
        ],
      },
    };
    expect(parseSession(JSON.stringify(badArrow))).toBeNull();
  });

  it("returns null for a text overlay where size is not a number", () => {
    const badText = {
      version: 1,
      scene: {
        items: [],
        overlays: [
          {
            id: "t",
            kind: "text",
            start: 0,
            end: 2,
            color: "#00f",
            x: 0,
            y: 0,
            text: "hi",
            size: "big",
          },
        ],
      },
    };
    expect(parseSession(JSON.stringify(badText))).toBeNull();
  });

  it("returns null for a slide item with non-numeric duration", () => {
    const badSlide = {
      version: 1,
      scene: {
        items: [
          {
            id: "s",
            kind: "slide",
            assetId: "a",
            duration: "three",
            naturalWidth: 100,
            naturalHeight: 100,
          },
        ],
        overlays: [],
      },
    };
    expect(parseSession(JSON.stringify(badSlide))).toBeNull();
  });

  it("returns null when the scene is not an object", () => {
    expect(parseSession(JSON.stringify({ version: 1, scene: null }))).toBeNull();
    expect(parseSession(JSON.stringify({ version: 1, scene: 42 }))).toBeNull();
  });
});
