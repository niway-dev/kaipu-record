/**
 * Pure colour maths for Inspect mode (NIW2-699). No DOM.
 *
 * The pixel buffer is read as sRGB (ADR 0054), so every value shown is sRGB. The only
 * Display P3 -> sRGB conversion lives here, once, so the "is this colour outside sRGB" mark
 * has a single reference-tested implementation.
 */

export type Rgb = [number, number, number];
export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0-255. */
  a: number;
}

// CSS Color 4 matrices (D65), linear light.
const P3_TO_XYZ = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0.0, 0.04511338185890264, 1.043944368900976],
] as const;
const XYZ_TO_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
] as const;

/**
 * How far past 0 or 255 (in 8-bit units) a converted channel may land before the colour is
 * called out of sRGB. The M0 spike measured up to 3 units of quantization error on #00ff00
 * through an 8-bit P3 buffer, so a smaller margin would flag in-gamut colours.
 */
export const OUT_OF_GAMUT_TOLERANCE = 4;

/** Shared sRGB / Display P3 transfer function (decode, 0-1). Sign-extended by the callers. */
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function toGamma(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}
const signed = (fn: (c: number) => number) => (c: number) => Math.sign(c) * fn(Math.abs(c));
const toLinearSigned = signed(toLinear);
const toGammaSigned = signed(toGamma);

function mul(m: readonly (readonly number[])[], v: readonly number[]): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

const clamp255 = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));

/** Display P3 bytes (0-255) to sRGB, clipped, plus whether clipping lost real colour. */
export function p3ToSrgb(p3: Rgb): { rgb: Rgb; outOfGamut: boolean } {
  const linearP3 = p3.map((c) => toLinear(c / 255));
  const linearSrgb = mul(XYZ_TO_SRGB, mul(P3_TO_XYZ, linearP3));
  const encoded = linearSrgb.map((c) => toGammaSigned(c) * 255);
  const outOfGamut = encoded.some(
    (c) => c < -OUT_OF_GAMUT_TOLERANCE || c > 255 + OUT_OF_GAMUT_TOLERANCE,
  );
  return { rgb: [clamp255(encoded[0]), clamp255(encoded[1]), clamp255(encoded[2])], outOfGamut };
}

/** The inverse, for tests and fixtures: Display P3 channels (0-255, unrounded and unclipped). */
export function srgbToP3(rgb: Rgb): Rgb {
  const p3FromXyz = invert3(P3_TO_XYZ);
  const srgbToXyz = invert3(XYZ_TO_SRGB);
  const linear = rgb.map((c) => toLinearSigned(c / 255));
  const p3 = mul(p3FromXyz, mul(srgbToXyz, linear)).map((c) => toGammaSigned(c) * 255);
  return [p3[0], p3[1], p3[2]];
}

function invert3(m: readonly (readonly number[])[]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

export function srgbToHsl([r, g, b]: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

/** OKLCH from sRGB (Björn Ottosson's OKLab). L 0-1, chroma, hue in degrees 0-360. */
export function srgbToOklch([r, g, b]: Rgb): { l: number; c: number; h: number } {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(a, bb);
  let h = c < 1e-4 ? 0 : (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

export const COLOR_FORMATS = ["hex", "rgb", "hsl", "oklch"] as const;
export type ColorFormat = (typeof COLOR_FORMATS)[number];

/**
 * Alpha as CSS prints it: two decimals when they round-trip to the same 8-bit value (128 → 0.5),
 * three otherwise (1 → 0.004, 254 → 0.996), trailing zeros trimmed.
 */
function alphaText(a: number): string {
  const two = Number((a / 255).toFixed(2));
  return String(Math.round(two * 255) === a ? two : Number((a / 255).toFixed(3)));
}
const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

export function formatColor(color: Rgba, format: ColorFormat): string {
  const { r, g, b, a } = color;
  const translucent = a < 255;
  switch (format) {
    case "hex":
      return `#${hex2(r)}${hex2(g)}${hex2(b)}${translucent ? hex2(a) : ""}`;
    case "rgb":
      return translucent ? `rgba(${r}, ${g}, ${b}, ${alphaText(a)})` : `rgb(${r}, ${g}, ${b})`;
    case "hsl": {
      const { h, s, l } = srgbToHsl([r, g, b]);
      const body = `${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%`;
      return translucent ? `hsla(${body}, ${alphaText(a)})` : `hsl(${body})`;
    }
    case "oklch": {
      const { l, c, h } = srgbToOklch([r, g, b]);
      const body = `${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)}`;
      return translucent ? `oklch(${body} / ${alphaText(a)})` : `oklch(${body})`;
    }
  }
}

/**
 * "As captured" bytes are in the display's own profile, not sRGB, so hsl and oklch (both
 * defined from sRGB) would mislabel them: only hex and rgb are honest. Everything else
 * falls back to the rgb form.
 */
export function capturedFormat(format: ColorFormat): ColorFormat {
  return format === "hex" ? "hex" : "rgb";
}

export function formatCaptured(raw: Rgba, format: ColorFormat): string {
  return formatColor(raw, capturedFormat(format));
}
