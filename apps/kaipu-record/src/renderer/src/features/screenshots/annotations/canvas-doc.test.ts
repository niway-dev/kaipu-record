import { describe, expect, it, vi } from "vitest";
import { CANVAS_DOC_VERSION, buildCanvasDoc, parseCanvasDoc } from "./canvas-doc";
import type { Annotation, Scene } from "./scene";

const annotations: Annotation[] = [
  { id: "a1", kind: "box", x: 0.1, y: 0.1, w: 0.2, h: 0.2, color: "#f00", stroke: 2, seed: 5 },
  { id: "a2", kind: "arrow", x1: -0.2, y1: 0, x2: 1.4, y2: 0.5, color: "#0f0", stroke: 1, seed: 6 },
  {
    id: "a3",
    kind: "text",
    x: 0.3,
    y: 0.3,
    text: "hi",
    color: "#00f",
    size: 1,
    width: 0.2,
    fontPx: 20,
  },
  {
    id: "a4",
    kind: "path",
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
    ],
    color: "#fff",
    stroke: 2,
  },
  { id: "a5", kind: "blur", x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
  { id: "a6", kind: "blur", x: 0.6, y: 0.6, w: 0.1, h: 0.1, style: "solid" },
  { id: "a7", kind: "step", x: 0.7, y: 0.2, color: "#f00", size: 2 },
  // A ruler (NIW2-702) is kept in the base's source px, not normalized.
  {
    id: "a8",
    kind: "measure",
    axis: "y",
    from: 60,
    to: 240,
    at: 80,
    imageW: 800,
    imageH: 600,
    color: "#0f0",
  },
];
const scene: Scene = {
  beautify: { bg: "ocean", padding: 24, radius: 8, shadow: 30 },
  annotations,
  exportFrame: { x: -0.1, y: -0.1, w: 1.2, h: 1.2 },
};
const base = { pixelWidth: 800, pixelHeight: 600 };

/** Deep equality that tolerates float noise from the world <-> normalized conversion. */
function expectClose(actual: unknown, expected: unknown, path = "value"): void {
  if (typeof expected === "number") {
    expect(actual, path).toBeCloseTo(expected, 9);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((e, i) => expectClose((actual as unknown[])[i], e, `${path}[${i}]`));
  } else if (typeof expected === "object" && expected !== null) {
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [k, e] of Object.entries(expected)) {
      expectClose((actual as Record<string, unknown>)[k], e, `${path}.${k}`);
    }
  } else {
    expect(actual, path).toEqual(expected);
  }
}

function docWith(patch: (d: any) => void): string {
  const d = JSON.parse(JSON.stringify(buildCanvasDoc(scene, base)));
  patch(d);
  return JSON.stringify(d);
}

describe("canvas document", () => {
  it("round-trips build -> JSON -> parse with redactions locked", () => {
    const parsed = parseCanvasDoc(JSON.stringify(buildCanvasDoc(scene, base)));
    expect(parsed).not.toBeNull();
    expect(parsed!.base).toMatchObject({ assetId: "base", x: 0, y: 0, w: 800, h: 600 });
    expect(parsed!.scene.crop).toBeUndefined();
    expect(parsed!.scene.beautify).toEqual(scene.beautify);
    expectClose(parsed!.scene.exportFrame, scene.exportFrame);
    expectClose(
      parsed!.scene.annotations,
      annotations.map((a) => (a.kind === "blur" ? { ...a, locked: true } : a)),
    );
  });

  it("writes the current version with every geometry in world units", () => {
    const doc = buildCanvasDoc(scene, base);
    expect(doc.schemaVersion).toBe(CANVAS_DOC_VERSION);
    expect(CANVAS_DOC_VERSION).toBe(3);
    const [, box, arrow, text, path] = doc.items as any[];
    expect(box).toMatchObject({ x: 80, y: 60, w: 160, h: 120 });
    expect(arrow).toMatchObject({ x1: -160, y1: 0, x2: 1120, y2: 300 });
    expect(text).toMatchObject({ x: 240, y: 180, width: 160, fontPx: 20, size: 1 });
    expect(path.points[1]).toEqual({ x: 400, y: 300 });
    expect(doc.exportFrame).toEqual({ x: -80, y: -60, w: 960, h: 720 });
  });

  it("round-trips images at their z-position, with the scene otherwise intact", () => {
    // Illustrative: 400x300 image right of the 800x600 base, one above-left of it.
    const withImages: Scene = {
      ...scene,
      annotations: [
        annotations[0],
        {
          id: "a7",
          kind: "image",
          assetId: "img-aaaaaaaaaaaa",
          x: 1.1,
          y: 0.05,
          w: 0.5,
          h: 0.5,
          pixelWidth: 400,
          pixelHeight: 300,
        },
        annotations[1],
        {
          id: "a8",
          kind: "image",
          assetId: "img-bbbbbbbbbbbb",
          x: -0.7,
          y: -0.6,
          w: 0.25,
          h: 0.25,
          pixelWidth: 200,
          pixelHeight: 150,
        },
        annotations[4],
      ],
    };
    const doc = buildCanvasDoc(withImages, base);
    expect((doc.items[2] as any).x).toBeCloseTo(880);
    expect((doc.items[2] as any).w).toBeCloseTo(400);
    const parsed = parseCanvasDoc(JSON.stringify(doc))!;
    expect(parsed.scene.annotations.map((a) => a.kind)).toEqual([
      "box",
      "image",
      "arrow",
      "image",
      "blur",
    ]);
    expectClose(
      parsed.scene.annotations,
      withImages.annotations.map((a) => (a.kind === "blur" ? { ...a, locked: true } : a)),
    );
  });

  it("reads a v1 document unchanged: base-normalized, extra image items ignored", () => {
    const v1 = {
      schemaVersion: 1,
      items: [
        {
          id: "image-base",
          kind: "image",
          assetId: "base",
          x: 0,
          y: 0,
          w: 800,
          h: 600,
          pixelWidth: 800,
          pixelHeight: 600,
        },
        {
          id: "a1",
          kind: "box",
          x: 0.1,
          y: 0.2,
          w: 0.3,
          h: 0.4,
          color: "#f00",
          stroke: 2,
          seed: 5,
        },
        {
          id: "x",
          kind: "image",
          assetId: "img-ignored",
          x: 900,
          y: 0,
          w: 10,
          h: 10,
          pixelWidth: 10,
          pixelHeight: 10,
        },
        { id: "a5", kind: "blur", x: 0.5, y: 0.5, w: 0.1, h: 0.1, locked: true },
      ],
      frame: { bg: "ocean", padding: 24, radius: 8, shadow: 30 },
      exportFrame: { x: -0.1, y: -0.1, w: 1.2, h: 1.2 },
    };
    const parsed = parseCanvasDoc(JSON.stringify(v1))!;
    expect(parsed.scene.annotations).toEqual([v1.items[1], v1.items[3]]);
    expect(parsed.scene.exportFrame).toEqual(v1.exportFrame);
  });

  it("converts by the base's rect when the base is not at 0,0", () => {
    // Illustrative: the base sits at (100,50), 800x600. World x = 100 + 0.1 * 800 = 180.
    const v2 = {
      schemaVersion: 2,
      items: [
        {
          id: "image-base",
          kind: "image",
          assetId: "base",
          x: 100,
          y: 50,
          w: 800,
          h: 600,
          pixelWidth: 800,
          pixelHeight: 600,
        },
        {
          id: "a1",
          kind: "box",
          x: 180,
          y: 110,
          w: 160,
          h: 120,
          color: "#f00",
          stroke: 2,
          seed: 5,
        },
        { id: "a3", kind: "text", x: 180, y: 110, text: "hi", color: "#00f", size: 1, width: 160 },
        {
          id: "a4",
          kind: "path",
          points: [
            { x: 100, y: 50 },
            { x: 500, y: 350 },
          ],
          color: "#fff",
          stroke: 2,
        },
        {
          id: "a7",
          kind: "image",
          assetId: "img-aaaaaaaaaaaa",
          x: 1000,
          y: 50,
          w: 400,
          h: 300,
          pixelWidth: 400,
          pixelHeight: 300,
        },
        // A step badge's centre is a position; its size is a level and stays as it is.
        { id: "a8", kind: "step", x: 660, y: 170, color: "#f00", size: 2 },
        // A vertical ruler: from/to are world y, at is world x; back in the base's source px.
        {
          id: "a9",
          kind: "measure",
          axis: "y",
          from: 110,
          to: 290,
          at: 180,
          imageW: 800,
          imageH: 600,
          color: "#0f0",
        },
      ],
      frame: { bg: "none", padding: 0, radius: 0, shadow: 0 },
      exportFrame: { x: 100, y: 50, w: 1300, h: 600 },
    };
    const parsed = parseCanvasDoc(JSON.stringify(v2))!;
    expect(parsed.base).toMatchObject({ x: 100, y: 50, w: 800, h: 600 });
    const [box, text, path, image, step, measure] = parsed.scene.annotations as any[];
    expectClose(measure, {
      id: "a9",
      kind: "measure",
      axis: "y",
      from: 60,
      to: 240,
      at: 80,
      imageW: 800,
      imageH: 600,
      color: "#0f0",
    });
    expectClose(step, { id: "a8", kind: "step", x: 0.7, y: 0.2, color: "#f00", size: 2 });
    expect(box).toMatchObject({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    expect(text).toMatchObject({ x: 0.1, y: 0.1, width: 0.2 });
    expect(path.points).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
    ]);
    expect(image).toMatchObject({ x: 1.125, y: 0, w: 0.5, h: 0.5, pixelWidth: 400 });
    expect(parsed.scene.exportFrame).toEqual({ x: 0, y: 0, w: 1.625, h: 1 });
  });

  it("reopens a ruler on whole source pixels, without float noise from the world round trip", () => {
    // 49 px across a 1000-unit base: v/49*1000 and back is not exact in doubles.
    const measures = Array.from({ length: 48 }, (_, i) => ({
      id: `m${i}`,
      kind: "measure" as const,
      axis: (i % 2 ? "x" : "y") as "x" | "y",
      from: i,
      to: 48 - (i % 7),
      at: (i * 5) % 49,
      imageW: 49,
      imageH: 49,
      color: "#0f0",
    }));
    const doc = buildCanvasDoc(
      { ...scene, annotations: measures },
      { pixelWidth: 1000, pixelHeight: 1000 },
    );
    const parsed = parseCanvasDoc(JSON.stringify(doc))!;
    expect(parsed.scene.annotations).toEqual(measures);
  });

  it("returns null for corrupt JSON", () => {
    expect(parseCanvasDoc("{not json")).toBeNull();
    expect(parseCanvasDoc("42")).toBeNull();
  });
  it("returns null for an unknown schema version", () => {
    expect(parseCanvasDoc(docWith((d) => (d.schemaVersion = 4)))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => (d.schemaVersion = 0)))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => delete d.schemaVersion))).toBeNull();
  });
  it("returns null for an added image with a bad or reserved asset id", () => {
    const image = {
      id: "a7",
      kind: "image",
      assetId: "img-aaaaaaaaaaaa",
      x: 900,
      y: 0,
      w: 100,
      h: 100,
      pixelWidth: 100,
      pixelHeight: 100,
    };
    expect(parseCanvasDoc(docWith((d) => d.items.push(image)))).not.toBeNull();
    expect(parseCanvasDoc(docWith((d) => d.items.push({ ...image, assetId: "../x" })))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => d.items.push({ ...image, assetId: "base" })))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => d.items.push({ ...image, w: 0 })))).toBeNull();
  });
  it("returns null for an unknown annotation kind", () => {
    expect(parseCanvasDoc(docWith((d) => d.items.push({ id: "z", kind: "star" })))).toBeNull();
  });
  it("returns null for a bad asset id", () => {
    expect(parseCanvasDoc(docWith((d) => (d.items[0].assetId = "../x")))).toBeNull();
    // `__proto__` would not be an own key of the asset map.
    expect(parseCanvasDoc(docWith((d) => (d.items[0].assetId = "__proto__")))).toBeNull();
  });
  it("returns null for a non-finite or wrong-typed field", () => {
    // JSON has no NaN: a null coordinate is what NaN serializes to.
    expect(parseCanvasDoc(docWith((d) => (d.items[1].x = null)))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => (d.items[2].y2 = "1")))).toBeNull();
  });
  it("returns null for a stroke or text size outside its preset table", () => {
    // A stroke level indexes STROKE_WIDTHS: 4 would draw a NaN stroke.
    expect(parseCanvasDoc(docWith((d) => (d.items[2].stroke = 4)))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => (d.items[2].stroke = 1.5)))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => (d.items[4].stroke = -1)))).toBeNull();
    // A step size indexes STEP_PX.
    expect(parseCanvasDoc(docWith((d) => (d.items[7].size = 4)))).toBeNull();
  });
  it("returns null for a frame value outside the panel's range", () => {
    expect(parseCanvasDoc(docWith((d) => (d.frame.padding = -100)))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => (d.frame.radius = 1000)))).toBeNull();
  });
  it("returns null for an unknown background", () => {
    expect(parseCanvasDoc(docWith((d) => (d.frame.bg = "nope")))).toBeNull();
  });
  it("returns null for a bad exportFrame, redaction style, or missing base", () => {
    expect(
      parseCanvasDoc(docWith((d) => (d.exportFrame = { x: 0, y: 0, w: "a", h: 1 }))),
    ).toBeNull();
    expect(parseCanvasDoc(docWith((d) => (d.items[5].style = "gaussian")))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => d.items.shift()))).toBeNull();
    expect(parseCanvasDoc(docWith((d) => (d.items[0].w = 0)))).toBeNull();
  });
});

describe("canvas document — lockedAt", () => {
  const SAVED = Date.UTC(2026, 10, 11, 12, 0, 0);
  const EARLIER = Date.UTC(2026, 9, 1, 8, 0, 0);

  it("stamps the save time on a redaction this save locks, when a time is given", () => {
    const doc = buildCanvasDoc(scene, base, { lockedAt: () => SAVED });
    const blurs = doc.items.filter((i) => i.kind === "blur") as { lockedAt?: number }[];
    expect(blurs).toHaveLength(2);
    expect(blurs.map((b) => b.lockedAt)).toEqual([SAVED, SAVED]);
  });

  it("writes no lockedAt without a time, so a document stays what it was", () => {
    const doc = buildCanvasDoc(scene, base);
    expect(doc.items.some((i) => "lockedAt" in i)).toBe(false);
  });

  it("keeps the time an earlier save wrote, and does not date one that has none", () => {
    const reopened: Scene = {
      ...scene,
      annotations: [
        { id: "k1", kind: "blur", x: 0.1, y: 0.1, w: 0.1, h: 0.1, locked: true, lockedAt: EARLIER },
        { id: "k2", kind: "blur", x: 0.3, y: 0.3, w: 0.1, h: 0.1, locked: true },
        { id: "k3", kind: "blur", x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
      ],
    };
    const doc = buildCanvasDoc(reopened, base, { lockedAt: () => SAVED });
    const [, k1, k2, k3] = doc.items as { lockedAt?: number }[];
    expect(k1.lockedAt).toBe(EARLIER);
    expect(k2.lockedAt).toBeUndefined();
    expect(k3.lockedAt).toBe(SAVED);
  });

  it("keeps the first stamp for an id across two builds", () => {
    const first = new Map<string, number>();
    const lockedAt = (id: string): number => {
      if (!first.has(id)) first.set(id, Date.now());
      return first.get(id)!;
    };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const a = buildCanvasDoc(scene, base, { lockedAt });
      vi.setSystemTime(9000);
      const b = buildCanvasDoc(scene, base, { lockedAt });
      const stamps = (d: typeof a) =>
        (d.items.filter((i) => i.kind === "blur") as { lockedAt?: number }[]).map(
          (x) => x.lockedAt,
        );
      expect(stamps(a)).toEqual([1000, 1000]);
      expect(stamps(b)).toEqual([1000, 1000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("round-trips lockedAt through parse", () => {
    const parsed = parseCanvasDoc(
      JSON.stringify(buildCanvasDoc(scene, base, { lockedAt: () => SAVED })),
    )!;
    const blurs = parsed.scene.annotations.filter((a) => a.kind === "blur");
    expect(blurs.map((b) => (b.kind === "blur" ? b.lockedAt : null))).toEqual([SAVED, SAVED]);
  });

  it("returns null when lockedAt is not a finite number", () => {
    for (const bad of ["yesterday", null, true, {}]) {
      const json = docWith((d) => (d.items[5].lockedAt = bad));
      expect(parseCanvasDoc(json), String(bad)).toBeNull();
    }
  });
});

describe("canvas document — per-image crop (v3)", () => {
  // Illustrative: a 400x300 image right of the 800x600 base, showing the middle 50% x 50%
  // of its asset, with its own 12 px corner.
  const cropped: Annotation = {
    id: "a7",
    kind: "image",
    assetId: "img-aaaaaaaaaaaa",
    x: 1.25,
    y: 0.125,
    w: 0.25,
    h: 0.25,
    pixelWidth: 800,
    pixelHeight: 600,
    crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    radius: 12,
  };
  const plain: Annotation = { ...cropped, id: "a8", y: 1, crop: undefined, radius: undefined };
  delete plain.crop;
  delete plain.radius;
  const withImages: Scene = { ...scene, annotations: [cropped, plain] };

  it("round-trips crop and radius; crop and radius stay asset-relative, the rect goes to world units", () => {
    const doc = buildCanvasDoc(withImages, base);
    const [, item] = doc.items as any[];
    expect(item).toMatchObject({ x: 1000, y: 75, w: 200, h: 150, radius: 12 });
    expect(item.crop).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    const parsed = parseCanvasDoc(JSON.stringify(doc));
    expectClose(parsed!.scene.annotations, withImages.annotations);
  });

  it("writes no crop or radius key for an image that has neither", () => {
    const [, , item] = buildCanvasDoc(withImages, base).items as any[];
    expect("crop" in item).toBe(false);
    expect("radius" in item).toBe(false);
  });

  it("still reads a v2 document (no crop, no radius)", () => {
    const v2 = docWith((d) => {
      d.schemaVersion = 2;
      d.items = [d.items[0], { ...d.items[0], id: "a1", assetId: "img-bbbbbbbbbbbb", x: 900 }];
    });
    const parsed = parseCanvasDoc(v2);
    expect(parsed).not.toBeNull();
    expect(parsed!.scene.annotations[0]).not.toHaveProperty("crop");
  });

  it("ignores crop and radius on a v2 file: that version never wrote them", () => {
    const doc = JSON.parse(JSON.stringify(buildCanvasDoc(withImages, base)));
    doc.schemaVersion = 2;
    const parsed = parseCanvasDoc(JSON.stringify(doc));
    expect(parsed!.scene.annotations[0]).not.toHaveProperty("crop");
    expect(parsed!.scene.annotations[0]).not.toHaveProperty("radius");
  });

  it("falls back to the flattened PNG for a crop outside the asset or a negative radius", () => {
    const bad = (patch: (item: any) => void) =>
      parseCanvasDoc(
        JSON.stringify(
          (() => {
            const d = JSON.parse(JSON.stringify(buildCanvasDoc(withImages, base)));
            patch(d.items[1]);
            return d;
          })(),
        ),
      );
    expect(bad((i) => (i.crop = { x: 0.6, y: 0, w: 0.5, h: 1 }))).toBeNull();
    expect(bad((i) => (i.crop = { x: -0.1, y: 0, w: 0.5, h: 1 }))).toBeNull();
    expect(bad((i) => (i.crop = { x: 0, y: 0, w: 0, h: 1 }))).toBeNull();
    expect(bad((i) => (i.crop = { x: "0", y: 0, w: 1, h: 1 }))).toBeNull();
    expect(bad((i) => (i.radius = -1))).toBeNull();
    expect(bad((i) => (i.radius = "12"))).toBeNull();
    expect(bad(() => {})).not.toBeNull();
  });
});
