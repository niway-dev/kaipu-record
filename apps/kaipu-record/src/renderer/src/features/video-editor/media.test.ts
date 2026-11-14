import { describe, expect, it } from "vitest";
import type { ImageMediaItem, TrackItem } from "./scene";
import { toLayout } from "./timeline";
import {
  addImageMedia,
  boxFitted,
  boxInCorner,
  mediaAt,
  mediaBoxPx,
  mediaRows,
  moveMedia,
  placeMedia,
  removeMedia,
  reorderMedia,
  resizeMediaEdge,
  setMediaBox,
  setMediaFades,
  MEDIA_DEFAULT_DURATION,
  MEDIA_DEFAULT_FADE_MS,
  MEDIA_MIN_DURATION,
} from "./media";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});
const slide = (id: string, duration: number): TrackItem => ({
  id,
  kind: "slide",
  assetId: `asset-${id}`,
  duration,
  naturalWidth: 100,
  naturalHeight: 100,
});

/** A source anchor at `time`, floating for `duration` s. */
const img = (id: string, time: number, duration: number, z: number): ImageMediaItem => ({
  id,
  kind: "image",
  assetId: `asset-${id}`,
  naturalWidth: 1600,
  naturalHeight: 900,
  anchor: { kind: "source", time },
  duration,
  box: { x: 0.5, y: 0.5, width: 1 },
  z,
  fadeInMs: 0,
  fadeOutMs: 0,
});

const items: TrackItem[] = [clip("a", 0, 60)];
const layout = toLayout(items);

describe("placeMedia", () => {
  it("places an item at the timeline time of its anchor, for its duration", () => {
    const [placed] = placeMedia([img("m", 5, 10, 0)], layout);
    expect([placed.start, placed.end]).toEqual([5, 15]);
  });

  it("clamps the end to the end of the timeline", () => {
    const [placed] = placeMedia([img("m", 55, 10, 0)], layout);
    expect(placed.end).toBe(60);
  });

  it("drops an item whose footage is deleted, and brings it back with the footage", () => {
    const media = [img("m", 20, 5, 0)];
    const cut = toLayout([clip("a", 0, 10), clip("b", 30, 60)]);
    expect(placeMedia(media, cut)).toEqual([]);
    expect(placeMedia(media, layout)).toHaveLength(1);
  });

  it("keeps the item over the same second after a trim, a split and an insert before it", () => {
    const media = [img("m", 40, 5, 0)];
    const trimmed = toLayout([clip("a", 10, 60)]);
    expect(placeMedia(media, trimmed)[0].start).toBe(30);
    const split = toLayout([clip("a1", 0, 20), clip("a2", 20, 60)]);
    expect(placeMedia(media, split)[0].start).toBe(40);
    const inserted = toLayout([slide("intro", 3), ...items]);
    expect(placeMedia(media, inserted)[0].start).toBe(43);
  });

  it("follows a reordered sequence", () => {
    const media = [img("m", 5, 2, 0)];
    const reordered = toLayout([clip("b", 30, 60), clip("a", 0, 30)]);
    expect(placeMedia(media, reordered)[0].start).toBe(35);
  });

  it("is sorted by z, lowest first, whatever the array order", () => {
    const placed = placeMedia([img("front", 0, 5, 2), img("back", 0, 5, 1)], layout);
    expect(placed.map((p) => p.item.id)).toEqual(["back", "front"]);
  });

  it("is empty for no media", () => {
    expect(placeMedia(undefined, layout)).toEqual([]);
  });
});

describe("mediaRows", () => {
  const rows = (media: ImageMediaItem[]): Record<string, number> =>
    Object.fromEntries(mediaRows(placeMedia(media, layout)));

  it("puts a single image on row 1, above the sequence (row 0)", () => {
    expect(rows([img("a", 0, 5, 0)])).toEqual({ a: 1 });
  });

  it("shares one row between images that do not overlap in time", () => {
    expect(rows([img("a", 0, 5, 0), img("b", 5, 5, 1)])).toEqual({ a: 1, b: 1 });
  });

  it("puts overlapping images on two rows, the one in front above", () => {
    expect(rows([img("a", 0, 10, 0), img("b", 5, 10, 1)])).toEqual({ a: 1, b: 2 });
    expect(rows([img("a", 0, 10, 1), img("b", 5, 10, 0)])).toEqual({ a: 2, b: 1 });
  });

  it("stacks three images that all overlap on three rows", () => {
    expect(rows([img("a", 0, 10, 0), img("b", 2, 10, 1), img("c", 4, 10, 2)])).toEqual({
      a: 1,
      b: 2,
      c: 3,
    });
  });

  it("is a function of time and z only, never of the array order", () => {
    const a = img("a", 0, 10, 0);
    const b = img("b", 5, 10, 1);
    expect(rows([a, b])).toEqual(rows([b, a]));
  });
});

describe("mediaAt", () => {
  it("returns the visible items in z order, back first", () => {
    const media = [img("front", 0, 10, 1), img("back", 0, 10, 0)];
    expect(mediaAt({ media }, layout, 5).map((v) => v.item.id)).toEqual(["back", "front"]);
  });

  it("includes an item from its start up to, not including, its end", () => {
    const media = [img("m", 10, 5, 0)];
    expect(mediaAt({ media }, layout, 9.99)).toEqual([]);
    expect(mediaAt({ media }, layout, 10)).toHaveLength(1);
    expect(mediaAt({ media }, layout, 14.99)).toHaveLength(1);
    expect(mediaAt({ media }, layout, 15)).toEqual([]);
  });

  it("is empty with no media or no layout", () => {
    expect(mediaAt({}, layout, 5)).toEqual([]);
    expect(mediaAt({ media: [img("m", 0, 5, 0)] }, [], 1)).toEqual([]);
  });

  it("is fully opaque with no fades", () => {
    expect(mediaAt({ media: [img("m", 0, 10, 0)] }, layout, 3)[0].opacity).toBe(1);
  });

  it("ramps the fade in and the fade out linearly", () => {
    const item = { ...img("m", 10, 10, 0), fadeInMs: 200, fadeOutMs: 400 };
    const at = (t: number): number | undefined => mediaAt({ media: [item] }, layout, t)[0]?.opacity;
    expect(at(10)).toBeUndefined(); // opacity 0 draws nothing
    expect(at(10.1)).toBeCloseTo(0.5);
    expect(at(10.2)).toBeCloseTo(1);
    expect(at(15)).toBe(1);
    expect(at(19.8)).toBeCloseTo(0.5);
  });

  it("never lets the two ramps cross on a short item", () => {
    const item = { ...img("m", 10, 0.5, 0), fadeInMs: 2000, fadeOutMs: 2000 };
    const peak = Math.max(
      ...[10.05, 10.1, 10.2, 10.25, 10.3, 10.4, 10.45].map(
        (t) => mediaAt({ media: [item] }, layout, t)[0]?.opacity ?? 0,
      ),
    );
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.9); // the ramps meet at the middle, scaled to fit
  });

  it("does not extend past the end of the timeline", () => {
    const media = [img("m", 58, 10, 0)];
    expect(mediaAt({ media }, layout, 59)).toHaveLength(1);
    expect(mediaAt({ media }, layout, 60)).toEqual([]);
  });

  it("does not draw an item whose footage is deleted", () => {
    const cut = toLayout([clip("a", 0, 10)]);
    expect(mediaAt({ media: [img("m", 30, 5, 0)] }, cut, 5)).toEqual([]);
  });
});

describe("box geometry", () => {
  const picture = { width: 1600, height: 900 };

  it("fits a 16:9 image to the whole picture", () => {
    expect(boxFitted(1600, 900, picture)).toEqual({ x: 0.5, y: 0.5, width: 1 });
  });

  it("fits a square image to the picture height, centred", () => {
    const box = boxFitted(500, 500, picture);
    expect(box.width).toBeCloseTo(900 / 1600);
    expect([box.x, box.y]).toEqual([0.5, 0.5]);
  });

  it("fits a tall image to the picture height", () => {
    const box = boxFitted(900, 1800, picture);
    expect(
      mediaBoxPx({ ...img("m", 0, 1, 0), naturalWidth: 900, naturalHeight: 1800, box }, picture)
        .height,
    ).toBeCloseTo(900);
  });

  it("puts the 40 % box at the bottom right, inside the picture", () => {
    const box = boxInCorner(1600, 900, picture);
    expect(box.width).toBe(0.4);
    const px = mediaBoxPx({ ...img("m", 0, 1, 0), box }, picture);
    expect(px.x + px.width).toBeLessThanOrEqual(1600);
    expect(px.y + px.height).toBeLessThanOrEqual(900);
    expect(px.x + px.width).toBeGreaterThan(1600 * 0.9);
    expect(px.y + px.height).toBeGreaterThan(900 * 0.9);
  });

  it("derives the height from the width and the image aspect, in picture pixels", () => {
    const px = mediaBoxPx(
      {
        ...img("m", 0, 1, 0),
        naturalWidth: 400,
        naturalHeight: 200,
        box: { x: 0.5, y: 0.5, width: 0.5 },
      },
      picture,
    );
    expect(px).toEqual({ x: 400, y: 250, width: 800, height: 400 });
  });
});

describe("edits", () => {
  const add = (media: ImageMediaItem[] | undefined, playhead: number): ImageMediaItem[] =>
    addImageMedia(media, layout, {
      assetId: "asset-new",
      naturalWidth: 1600,
      naturalHeight: 900,
      playhead,
      picture: { width: 1600, height: 900 },
      id: `m${playhead}`,
    });

  it("adds an image at the playhead for 10 s, fitted and in front", () => {
    const first = add(undefined, 5);
    const second = add(first, 7);
    const added = second[1];
    expect(added.anchor).toEqual({ kind: "source", time: 7 });
    expect(added.duration).toBe(MEDIA_DEFAULT_DURATION);
    expect(added.box).toEqual({ x: 0.5, y: 0.5, width: 1 });
    expect(added.z).toBeGreaterThan(first[0].z);
    expect(added.fadeInMs).toBe(MEDIA_DEFAULT_FADE_MS);
    expect(added.fadeOutMs).toBe(MEDIA_DEFAULT_FADE_MS);
  });

  it("lasts to the end of the video when fewer than 10 s remain", () => {
    expect(add(undefined, 55)[0].duration).toBe(5);
  });

  it("starts early enough at the very end to be visible", () => {
    const [added] = add(undefined, 60);
    expect(added.duration).toBeGreaterThanOrEqual(MEDIA_MIN_DURATION);
    const [placed] = placeMedia([added], layout);
    expect(placed.end - placed.start).toBeGreaterThanOrEqual(MEDIA_MIN_DURATION);
  });

  it("does not change the sequence length", () => {
    expect(toLayout(items)).toEqual(layout);
  });

  it("moves an item to a timeline time, keeping its duration and rewriting the anchor", () => {
    const moved = moveMedia([img("m", 5, 10, 0)], layout, "m", 20);
    expect(moved[0].anchor).toEqual({ kind: "source", time: 20 });
    expect(moved[0].duration).toBe(10);
  });

  it("keeps a moved item inside the timeline with its full duration", () => {
    const moved = moveMedia([img("m", 5, 10, 0)], layout, "m", 59);
    expect(moved[0].anchor).toEqual({ kind: "source", time: 50 });
    expect(moveMedia([img("m", 5, 10, 0)], layout, "m", -4)[0].anchor).toEqual({
      kind: "source",
      time: 0,
    });
  });

  it("anchors an item moved onto a slide to that slide", () => {
    const withSlide = toLayout([clip("a", 0, 10), slide("s", 5)]);
    const moved = moveMedia([img("m", 1, 2, 0)], withSlide, "m", 12);
    expect(moved[0].anchor).toEqual({ kind: "item", itemId: "s", offset: 2 });
  });

  it("changes the duration from the right edge and leaves the anchor", () => {
    const resized = resizeMediaEdge([img("m", 5, 10, 0)], layout, "m", "end", 9);
    expect(resized[0].duration).toBe(4);
    expect(resized[0].anchor).toEqual({ kind: "source", time: 5 });
  });

  it("changes the anchor and duration together from the left edge, keeping the end", () => {
    const resized = resizeMediaEdge([img("m", 5, 10, 0)], layout, "m", "start", 8);
    expect(resized[0].anchor).toEqual({ kind: "source", time: 8 });
    expect(resized[0].duration).toBe(7);
  });

  it("stops either edge at the minimum duration", () => {
    expect(resizeMediaEdge([img("m", 5, 10, 0)], layout, "m", "end", 5.1)[0].duration).toBe(
      MEDIA_MIN_DURATION,
    );
    const left = resizeMediaEdge([img("m", 5, 10, 0)], layout, "m", "start", 14.9)[0];
    expect(left.duration).toBe(MEDIA_MIN_DURATION);
    expect(left.anchor).toEqual({ kind: "source", time: 14.5 });
  });

  it("stops the right edge at the end of the timeline", () => {
    expect(resizeMediaEdge([img("m", 5, 10, 0)], layout, "m", "end", 999)[0].duration).toBe(55);
  });

  it("sets the box, keeping the width in a usable range", () => {
    const box = { x: 0.3, y: 0.4, width: 0.5 };
    expect(setMediaBox([img("m", 0, 5, 0)], "m", box)[0].box).toEqual(box);
    expect(
      setMediaBox([img("m", 0, 5, 0)], "m", { ...box, width: 0 })[0].box.width,
    ).toBeGreaterThan(0);
    expect(setMediaBox([img("m", 0, 5, 0)], "m", { ...box, width: 9 })[0].box.width).toBe(1);
  });

  it("clamps each fade to 0–2000 ms independently", () => {
    const faded = setMediaFades([img("m", 0, 5, 0)], "m", { fadeInMs: 5000, fadeOutMs: -3 })[0];
    expect([faded.fadeInMs, faded.fadeOutMs]).toEqual([2000, 0]);
    const one = setMediaFades([faded], "m", { fadeOutMs: 700 })[0];
    expect([one.fadeInMs, one.fadeOutMs]).toEqual([2000, 700]);
  });

  it("removes an item", () => {
    expect(removeMedia([img("m", 0, 5, 0), img("n", 0, 5, 1)], "m").map((m) => m.id)).toEqual([
      "n",
    ]);
  });

  describe("bring forward and send backward", () => {
    const front = (media: ImageMediaItem[]): string => {
      const visible = mediaAt({ media }, layout, 6);
      return visible[visible.length - 1].item.id;
    };
    const a = img("a", 0, 10, 0);
    const b = img("b", 5, 10, 1);

    it("swaps which of two overlapping images is in front", () => {
      expect(front(reorderMedia([a, b], layout, "a", "forward"))).toBe("a");
      expect(front(reorderMedia([a, b], layout, "b", "backward"))).toBe("a");
    });

    it("is a no-op, the same array, at the front or the back", () => {
      const media = [a, b];
      expect(reorderMedia(media, layout, "b", "forward")).toBe(media);
      expect(reorderMedia(media, layout, "a", "backward")).toBe(media);
    });

    it("is a no-op for an image that overlaps nothing in front of it", () => {
      const media = [img("a", 0, 5, 0), img("b", 20, 5, 1)];
      expect(reorderMedia(media, layout, "a", "forward")).toBe(media);
    });

    it("keeps z unique", () => {
      const out = reorderMedia([a, b, img("c", 30, 5, 2)], layout, "a", "forward");
      expect(new Set(out.map((m) => m.z)).size).toBe(3);
    });

    it("does not change which of two other overlapping images is in front", () => {
      // c overlaps b only, with z between a and b; moving a above b must not put c over b.
      const aa = img("a", 0, 6, 0);
      const cc = img("c", 8, 6, 1);
      const bb = img("b", 4, 10, 2);
      const out = reorderMedia([aa, cc, bb], layout, "a", "forward");
      const z = Object.fromEntries(out.map((m) => [m.id, m.z]));
      expect(z.b).toBeGreaterThan(z.c);
      expect(z.a).toBeGreaterThan(z.b);
    });
  });
});
