/**
 * What the image editor's Inspect mode remembers between sessions (NIW2-911): the color picked
 * with a click, the last few colors it replaced, and whether the loupe shows. Pure and
 * import-free on purpose, like `capture-widget-settings.ts`: main (the settings merge), the
 * preload bundle (through `types/ipc.ts`) and the renderer all read it, and this directory must
 * never take a value import from a workspace package.
 *
 * A color is stored as the raw values Inspect read, not as text: the box and the chips format
 * them again whenever the Format control or As captured changes.
 */

export interface InspectChannels {
  r: number;
  g: number;
  b: number;
  /** 0-255. */
  a: number;
}

/** A pixel Inspect picked. */
export interface PickedColor {
  /** The pixel as sRGB: what every format shows unless As captured is on. */
  color: InspectChannels;
  /** The raw display-profile bytes, when the probe had read them at the time of the click. */
  captured?: InspectChannels;
  outOfGamut?: boolean;
}

export interface ImageInspectSettings {
  /** The color the last click picked; null until one is. */
  picked: PickedColor | null;
  /** The colors the picks replaced, newest first. */
  recents: PickedColor[];
  /** Whether the magnifier follows the pointer. */
  loupe: boolean;
}

/** Recents kept; the oldest is dropped past this. */
export const MAX_RECENT_COLORS = 3;

export const DEFAULT_IMAGE_INSPECT_SETTINGS: ImageInspectSettings = {
  picked: null,
  recents: [],
  loupe: true,
};

function sanitizeChannels(value: unknown): InspectChannels | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const out: number[] = [];
  for (const key of ["r", "g", "b", "a"] as const) {
    const n = v[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 255) return null;
    out.push(n);
  }
  return { r: out[0], g: out[1], b: out[2], a: out[3] };
}

/** A stored (possibly stale or hand-edited) picked color; anything unreadable is dropped. */
export function sanitizePickedColor(value: unknown): PickedColor | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const color = sanitizeChannels(v.color);
  if (!color) return null;
  const picked: PickedColor = { color };
  const captured = sanitizeChannels(v.captured);
  if (captured) picked.captured = captured;
  if (typeof v.outOfGamut === "boolean") picked.outOfGamut = v.outOfGamut;
  return picked;
}

export function sanitizeImageInspectSettings(value: unknown): ImageInspectSettings {
  const safe = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const recents: PickedColor[] = [];
  if (Array.isArray(safe.recents)) {
    for (const entry of safe.recents) {
      const color = sanitizePickedColor(entry);
      if (color) recents.push(color);
      if (recents.length === MAX_RECENT_COLORS) break;
    }
  }
  return {
    picked: sanitizePickedColor(safe.picked),
    recents,
    loupe: typeof safe.loupe === "boolean" ? safe.loupe : DEFAULT_IMAGE_INSPECT_SETTINGS.loupe,
  };
}

/** Whether two picks are the same pixel value (the sRGB bytes decide; the rest follows them). */
export function samePickedColor(a: PickedColor, b: PickedColor): boolean {
  return (
    a.color.r === b.color.r &&
    a.color.g === b.color.g &&
    a.color.b === b.color.b &&
    a.color.a === b.color.a
  );
}

/**
 * The settings after a click picked `next`: it replaces the picked color and the one it
 * replaces goes to the front of the recents, which keep `MAX_RECENT_COLORS` (the oldest drops).
 * Picking the color that is already picked changes nothing, and a color is not pushed next to
 * an equal one, so the recents never show the same color twice in a row.
 */
export function pickColor(settings: ImageInspectSettings, next: PickedColor): ImageInspectSettings {
  const { picked, recents } = settings;
  if (picked && samePickedColor(picked, next)) return settings;
  const pushed =
    picked && !(recents[0] && samePickedColor(recents[0], picked)) ? [picked, ...recents] : recents;
  return { ...settings, picked: next, recents: pushed.slice(0, MAX_RECENT_COLORS) };
}
