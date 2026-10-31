import { describe, expect, it } from "vitest";
import { initialScene, type VideoScene } from "./scene";
import { parseSession, serializeSession } from "./session";
import { SESSION_BEFORE_WEBCAM } from "./session-before-webcam.fixture";

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
  ...initialScene(10),
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
    const scene: VideoScene = { ...initialScene(10), items: [CLIP_ITEM], overlays: [] };
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

// ── v2 fields (plans/video-editor-v2/07) ─────────────────────────────────────

const ZOOM = {
  id: "auto-4600",
  start: 4.6,
  end: 7,
  scale: 2,
  mode: "follow" as const,
  anchor: null,
  smoothing: 70,
  origin: "auto" as const,
  trigger: "click" as const,
};

const BLUR = {
  id: "r1",
  kind: "blur" as const,
  start: 1,
  end: 6,
  rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
  intensity: 70,
  style: "gaussian" as const,
};

const COVER = {
  id: "r2",
  kind: "cover" as const,
  start: 2,
  end: 4,
  rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
  fill: "#18181b",
  label: "API key",
};

describe("parseSession — v2 fields", () => {
  it("round-trips zoom segments, redactions and sensitivity", () => {
    const scene: VideoScene = {
      ...initialScene(10),
      zoomSegments: [ZOOM],
      redactions: [BLUR, COVER],
      zoomSensitivity: 80,
    };
    const result = parseSession(serializeSession(scene))!;
    expect(result.hasZoomData).toBe(true);
    expect(result.scene.zoomSegments).toEqual([ZOOM]);
    expect(result.scene.redactions).toEqual([BLUR, COVER]);
    expect(result.scene.zoomSensitivity).toBe(80);
  });

  it("opens a pre-v2 session with defaults and hasZoomData = false", () => {
    const old = JSON.stringify({ version: 1, scene: { items: [CLIP_ITEM], overlays: [] } });
    const result = parseSession(old)!;
    expect(result.hasZoomData).toBe(false);
    expect(result.scene.zoomSegments).toEqual([]);
    expect(result.scene.redactions).toEqual([]);
    expect(result.scene.zoomSensitivity).toBe(55);
  });

  it("clamps a too-weak blur intensity on load", () => {
    const json = JSON.stringify({
      version: 1,
      scene: { items: [CLIP_ITEM], overlays: [], redactions: [{ ...BLUR, intensity: 5 }] },
    });
    expect((parseSession(json)!.scene.redactions[0] as typeof BLUR).intensity).toBe(40);
  });

  it("clamps scale and replaces an unknown cover fill", () => {
    const json = JSON.stringify({
      version: 1,
      scene: {
        items: [CLIP_ITEM],
        overlays: [],
        zoomSegments: [{ ...ZOOM, scale: 9 }],
        redactions: [{ ...COVER, fill: "red" }],
      },
    });
    const { scene } = parseSession(json)!;
    expect(scene.zoomSegments[0].scale).toBe(4);
    expect((scene.redactions[0] as typeof COVER).fill).toBe("#18181b");
  });

  it("drops an overlapping zoom instead of rejecting the whole session", () => {
    const json = JSON.stringify({
      version: 1,
      scene: {
        items: [CLIP_ITEM],
        overlays: [],
        zoomSegments: [
          ZOOM,
          { ...ZOOM, id: "overlaps", start: 6, end: 9 },
          { ...ZOOM, id: "clear", start: 9, end: 12 },
        ],
      },
    });
    expect(parseSession(json)!.scene.zoomSegments.map((z) => z.id)).toEqual(["auto-4600", "clear"]);
  });

  it.each([
    ["zoom with end <= start", { zoomSegments: [{ ...ZOOM, end: 4 }] }],
    ["zoom shorter than ZOOM_LIMITS.minSeconds", { zoomSegments: [{ ...ZOOM, end: 5.1 }] }],
    ["zoom with bad mode", { zoomSegments: [{ ...ZOOM, mode: "orbit" }] }],
    ["zoom with bad anchor", { zoomSegments: [{ ...ZOOM, anchor: { x: "a" } }] }],
    ["redaction of unknown kind", { redactions: [{ ...BLUR, kind: "smudge" }] }],
    ["redaction with empty rect", { redactions: [{ ...BLUR, rect: { x: 0, y: 0, w: 0, h: 1 } }] }],
    ["non-array zoomSegments", { zoomSegments: "nope" }],
    ["non-numeric sensitivity", { zoomSensitivity: "high" }],
  ])("rejects %s", (_label: string, extra: object) => {
    const json = JSON.stringify({
      version: 1,
      scene: { items: [CLIP_ITEM], overlays: [], ...extra },
    });
    expect(parseSession(json)).toBeNull();
  });
});

describe("audio edits", () => {
  const withScene = (scene: Record<string, unknown>) =>
    parseSession(
      JSON.stringify({ version: 1, scene: { items: [CLIP_ITEM], overlays: [], ...scene } }),
    );

  it("loads a session saved before muting existed as nothing muted", () => {
    // The whole point of additive fields: an old .edit.json must still open.
    const parsed = withScene({});
    expect(parsed?.scene.audioMuted).toBe(false);
    expect(parsed?.scene.mutedRanges).toEqual([]);
  });

  it("keeps a stored whole-video mute", () => {
    expect(withScene({ audioMuted: true })?.scene.audioMuted).toBe(true);
  });

  it("keeps stored ranges, overlaps included", () => {
    const ranges = [
      { id: "a", sourceStart: 10, sourceEnd: 15 },
      { id: "b", sourceStart: 12, sourceEnd: 20 },
    ];
    expect(withScene({ mutedRanges: ranges })?.scene.mutedRanges).toEqual(ranges);
  });

  it.each([
    ["a reversed range", { id: "a", sourceStart: 15, sourceEnd: 10 }],
    ["a zero-width range", { id: "a", sourceStart: 10, sourceEnd: 10 }],
    ["a negative start", { id: "a", sourceStart: -1, sourceEnd: 5 }],
    ["a range with no id", { sourceStart: 1, sourceEnd: 5 }],
    ["a non-numeric bound", { id: "a", sourceStart: "1", sourceEnd: 5 }],
  ])("rejects %s rather than repairing it", (_label, range) => {
    expect(withScene({ mutedRanges: [range] })).toBeNull();
  });

  it("rejects a non-boolean audioMuted", () => {
    expect(withScene({ audioMuted: "yes" })).toBeNull();
  });
});

describe("webcam layer", () => {
  const LAYOUT = {
    shape: "circle",
    cornerRadius: 0.18,
    size: 0.25,
    position: { x: 0.12, y: 0.82 },
    mirrored: true,
    framing: { zoom: 1.5, x: 0.2, y: -0.2 },
    scaleDuringZoom: 0.7,
    shadow: true,
  };
  const HIDDEN = { id: "h", start: 2, end: 4, mode: "hidden" };
  const OVERRIDE = { id: "o", start: 6, end: 9, mode: "override", layout: { size: 0.4 } };
  const withWebcam = (webcam: unknown) =>
    parseSession(
      JSON.stringify({
        version: 1,
        scene: { items: [CLIP_ITEM], overlays: [], webcam },
      }),
    );
  const segments = (list: unknown[]) => withWebcam({ layout: LAYOUT, segments: list });

  it("round-trips the layer", () => {
    const scene: VideoScene = {
      ...initialScene(10),
      webcam: { layout: LAYOUT as never, segments: [HIDDEN, OVERRIDE] as never },
    };
    expect(parseSession(serializeSession(scene))!.scene.webcam).toEqual(scene.webcam);
  });

  it("opens a layer saved before the corner slider with today's 18 % corner", () => {
    const { cornerRadius: _cornerRadius, ...before } = LAYOUT as Record<string, unknown>;
    const scene: VideoScene = {
      ...initialScene(10),
      webcam: { layout: before as never, segments: [] },
    };
    expect(parseSession(serializeSession(scene))!.scene.webcam!.layout.cornerRadius).toBe(0.18);
  });

  it("keeps a rectangle and its corner, clamped", () => {
    const scene: VideoScene = {
      ...initialScene(10),
      webcam: {
        layout: { ...LAYOUT, shape: "rectangle", cornerRadius: 0.9 } as never,
        segments: [],
      },
    };
    const layout = parseSession(serializeSession(scene))!.scene.webcam!.layout;
    expect(layout.shape).toBe("rectangle");
    expect(layout.cornerRadius).toBe(0.5);
  });

  it("opens the frozen pre-webcam session with every edit intact and no layer (W6)", () => {
    const parsed = parseSession(SESSION_BEFORE_WEBCAM)!;
    expect(parsed).not.toBeNull();
    expect(parsed.hasZoomData).toBe(true);
    expect(parsed.scene.webcam).toBeNull();
    expect(parsed.scene.items.map((i) => i.id)).toEqual(["clip-a", "clip-b"]);
    expect(parsed.scene.zoomSegments.map((z) => z.id)).toEqual(["zoom-1"]);
    expect(parsed.scene.redactions.map((r) => r.id)).toEqual(["cover-1"]);
    expect(parsed.scene.mutedRanges).toEqual([{ id: "mute-1", sourceStart: 20, sourceEnd: 22 }]);
  });

  it("opens a session saved before the webcam, and a null one, with no layer", () => {
    const old = JSON.stringify({ version: 1, scene: { items: [CLIP_ITEM], overlays: [] } });
    expect(parseSession(old)!.scene.webcam).toBeNull();
    expect(withWebcam(null)!.scene.webcam).toBeNull();
  });

  it("is additive: a build that does not know the key finds a valid version-1 session", () => {
    const json = serializeSession({
      ...initialScene(10),
      webcam: { layout: LAYOUT as never, segments: [] },
    });
    const raw = JSON.parse(json) as { version: number; scene: Record<string, unknown> };
    expect(raw.version).toBe(1);
    const { webcam: _ignored, ...rest } = raw.scene;
    expect(parseSession(JSON.stringify({ version: 1, scene: rest }))).not.toBeNull();
  });

  it("clamps out-of-range layout numbers on load", () => {
    const layer = withWebcam({
      layout: {
        ...LAYOUT,
        size: 3,
        position: { x: -2, y: 5 },
        scaleDuringZoom: 0,
        framing: { zoom: 9, x: 4, y: -4 },
      },
      segments: [],
    })!.scene.webcam!;
    expect(layer.layout).toMatchObject({
      size: 0.6,
      position: { x: 0, y: 1 },
      scaleDuringZoom: 0.3,
      framing: { zoom: 3, x: 1, y: -1 },
    });
  });

  it("clamps an override's numbers too, and ignores the layout of a hidden segment", () => {
    const layer = segments([
      { ...OVERRIDE, layout: { size: 0.01, position: { x: 2, y: 0.5 } } },
      { ...HIDDEN, layout: { size: 0.3 } },
    ])!.scene.webcam!;
    expect(layer.segments).toEqual([
      { id: "h", start: 2, end: 4, mode: "hidden" },
      {
        id: "o",
        start: 6,
        end: 9,
        mode: "override",
        layout: { size: 0.1, position: { x: 1, y: 0.5 } },
      },
    ]);
  });

  it("sorts segments and drops the ones that overlap the one before", () => {
    const layer = segments([OVERRIDE, { id: "late", start: 8, end: 10, mode: "hidden" }, HIDDEN])!
      .scene.webcam!;
    expect(layer.segments.map((s) => s.id)).toEqual(["h", "o"]);
  });

  it.each([
    ["a non-object layer", "nope"],
    ["a layer without a layout", { segments: [] }],
    ["a layout with a bad shape", { layout: { ...LAYOUT, shape: "star" }, segments: [] }],
    ["a layout with a non-numeric size", { layout: { ...LAYOUT, size: "big" }, segments: [] }],
    ["a layout with a non-boolean mirror", { layout: { ...LAYOUT, mirrored: 1 }, segments: [] }],
    ["a layout with a bad position", { layout: { ...LAYOUT, position: { x: 0 } }, segments: [] }],
    ["non-array segments", { layout: LAYOUT, segments: {} }],
  ])("loads the session without the layer for %s", (_label: string, webcam: unknown) => {
    // The cuts and zooms are worth more than a layer the sidecar can re-seed.
    const parsed = parseSession(
      JSON.stringify({
        version: 1,
        scene: { items: [CLIP_ITEM], overlays: [], zoomSegments: [ZOOM], webcam },
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.scene.zoomSegments).toEqual([ZOOM]);
    expect(parsed!.scene.webcam).toBeNull();
  });

  it.each([
    ["a bad mode", { ...HIDDEN, mode: "fade" }],
    ["a length under the minimum", { ...HIDDEN, end: 2.5 }],
    ["no id", { start: 1, end: 3, mode: "hidden" }],
    ["an override with a bad field", { ...OVERRIDE, layout: { shadow: "yes" } }],
  ])("drops only the segment with %s and keeps the layer", (_label: string, bad: unknown) => {
    const layer = segments([bad, { id: "ok", start: 30, end: 33, mode: "hidden" }])!.scene.webcam!;
    expect(layer.layout).toMatchObject({ size: 0.25 });
    expect(layer.segments.map((s) => s.id)).toEqual(["ok"]);
  });

  it("accepts a segment a float short of the minimum, as the edge drag produces", () => {
    const start = 15.190612791990477;
    const end = 16.190612791990475;
    expect(end - start).toBeLessThan(1);
    const layer = segments([{ id: "d", start, end, mode: "hidden" }])!.scene.webcam!;
    expect(layer.segments).toHaveLength(1);
  });

  it("accepts a zoom a float short of the minimum, as the edge drag produces", () => {
    const start = 15.190612791990477;
    const end = 16.190612791990475;
    const json = JSON.stringify({
      version: 1,
      scene: { items: [CLIP_ITEM], overlays: [], zoomSegments: [{ ...ZOOM, start, end }] },
    });
    expect(parseSession(json)?.scene.zoomSegments).toHaveLength(1);
  });
});
