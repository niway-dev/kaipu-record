import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_INSPECT_SETTINGS,
  MAX_RECENT_COLORS,
  pickColor,
  sanitizeImageInspectSettings,
  sanitizePickedColor,
  type ImageInspectSettings,
  type PickedColor,
} from "./image-inspect-settings";

const px = (r: number, g: number, b: number, a = 255): PickedColor => ({ color: { r, g, b, a } });
const RED = px(255, 0, 82);
const GREEN = px(0, 200, 0);
const BLUE = px(0, 0, 255);
const GRAY = px(128, 128, 128);
const WHITE = px(255, 255, 255);

describe("pickColor", () => {
  it("fills the box on the first pick and leaves the recents empty", () => {
    const next = pickColor(DEFAULT_IMAGE_INSPECT_SETTINGS, RED);
    expect(next.picked).toEqual(RED);
    expect(next.recents).toEqual([]);
  });

  it("replaces the picked color and sends the old one to the front of the recents", () => {
    let s: ImageInspectSettings = pickColor(DEFAULT_IMAGE_INSPECT_SETTINGS, RED);
    s = pickColor(s, GREEN);
    s = pickColor(s, BLUE);
    expect(s.picked).toEqual(BLUE);
    expect(s.recents).toEqual([GREEN, RED]);
  });

  it("keeps three recents and drops the oldest", () => {
    let s: ImageInspectSettings = DEFAULT_IMAGE_INSPECT_SETTINGS;
    for (const c of [RED, GREEN, BLUE, GRAY, WHITE]) s = pickColor(s, c);
    expect(MAX_RECENT_COLORS).toBe(3);
    expect(s.picked).toEqual(WHITE);
    expect(s.recents).toEqual([GRAY, BLUE, GREEN]);
  });

  it("changes nothing when the picked color is picked again", () => {
    const s = pickColor(pickColor(DEFAULT_IMAGE_INSPECT_SETTINGS, RED), GREEN);
    expect(pickColor(s, px(0, 200, 0))).toBe(s);
  });

  it("updates the stored pick when a click repeats its sRGB value with other captured bytes", () => {
    const first: PickedColor = { ...RED, captured: { r: 250, g: 10, b: 90, a: 255 } };
    const again: PickedColor = {
      ...RED,
      captured: { r: 251, g: 11, b: 91, a: 255 },
      outOfGamut: true,
    };
    const s = pickColor(pickColor(DEFAULT_IMAGE_INSPECT_SETTINGS, GREEN), first);
    const next = pickColor(s, again);
    expect(next.picked).toEqual(again);
    expect(next.recents).toEqual(s.recents);
    expect(pickColor(next, { ...again })).toBe(next);
  });

  it("never lists the same color twice in a row, whatever is clicked", () => {
    let s: ImageInspectSettings = DEFAULT_IMAGE_INSPECT_SETTINGS;
    for (const c of [RED, RED, GREEN, GREEN, RED, RED, BLUE, BLUE, GREEN]) {
      s = pickColor(s, c);
      const row = [s.picked as PickedColor, ...s.recents];
      row.forEach((entry, i) => {
        if (i > 0) expect(entry.color).not.toEqual(row[i - 1].color);
      });
    }
  });

  it("does not push the old pick when it already heads the recents (a stored state)", () => {
    const stored: ImageInspectSettings = { picked: RED, recents: [RED, GREEN], loupe: true };
    expect(pickColor(stored, BLUE).recents).toEqual([RED, GREEN]);
  });

  it("keeps the loupe switch as it was", () => {
    const s = pickColor({ ...DEFAULT_IMAGE_INSPECT_SETTINGS, loupe: false }, RED);
    expect(s.loupe).toBe(false);
  });
});

describe("sanitize", () => {
  it("falls back to the defaults for anything that is not an object", () => {
    expect(sanitizeImageInspectSettings(undefined)).toEqual(DEFAULT_IMAGE_INSPECT_SETTINGS);
    expect(sanitizeImageInspectSettings("x")).toEqual(DEFAULT_IMAGE_INSPECT_SETTINGS);
  });

  it("drops unreadable colors and keeps the readable ones, at most three recents", () => {
    const out = sanitizeImageInspectSettings({
      picked: { color: { r: 1, g: 2, b: 3, a: 255 }, captured: { r: 4, g: 5, b: 6, a: 255 } },
      recents: [RED, { color: { r: 999, g: 0, b: 0, a: 255 } }, GREEN, BLUE, GRAY],
      loupe: false,
    });
    expect(out.picked).toEqual({
      color: { r: 1, g: 2, b: 3, a: 255 },
      captured: { r: 4, g: 5, b: 6, a: 255 },
    });
    expect(out.recents).toEqual([RED, GREEN, BLUE]);
    expect(out.loupe).toBe(false);
  });

  it("defaults the loupe to on when the stored value is not a boolean", () => {
    expect(sanitizeImageInspectSettings({ loupe: "no" }).loupe).toBe(true);
  });

  it("rejects non-integer and out-of-range channels", () => {
    expect(sanitizePickedColor({ color: { r: 1.5, g: 0, b: 0, a: 255 } })).toBeNull();
    expect(sanitizePickedColor({ color: { r: 0, g: 0, b: -1, a: 255 } })).toBeNull();
    expect(sanitizePickedColor({ color: { r: 0, g: 0, b: 0 } })).toBeNull();
    expect(sanitizePickedColor(null)).toBeNull();
  });

  it("keeps out-of-gamut only when it is a boolean", () => {
    expect(sanitizePickedColor({ ...RED, outOfGamut: true })?.outOfGamut).toBe(true);
    expect(sanitizePickedColor({ ...RED, outOfGamut: 1 })?.outOfGamut).toBeUndefined();
  });
});
