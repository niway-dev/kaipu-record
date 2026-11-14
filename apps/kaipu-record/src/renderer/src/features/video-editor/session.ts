/**
 * Edit-session serialization for the video editor. `serializeSession` collapses the
 * current scene into a JSON string; `parseSession` validates it structurally (field by
 * field — no zod, consistent with the rest of this codebase) and returns null for
 * anything invalid so the caller can silently fall back to a fresh scene.
 *
 * The version field is an intentional break point: if the shape ever changes in an
 * incompatible way we bump `version` and old sessions are ignored (parse returns null).
 *
 * v2 fields (`zoomSegments`, `redactions`, `zoomSensitivity`) are ADDITIVE inside
 * version 1: missing → defaults (a session saved before v2 still opens). Structural
 * damage (wrong type, unknown enum member, a zoom under the minimum length) returns
 * null like any other invalid field; an out-of-range NUMBER is clamped instead, because
 * a weakened blur or an over-scaled zoom must not be honoured either. Overlapping zooms
 * are dropped, not rejected. Older app builds ignore the new keys, so opening a v2
 * session in an old build is safe (it just shows no zooms).
 *
 * `webcam` (ADR 0038) is additive the same way: absent or null → no layer; a wrong type
 * drops the layer (the session loads, the sidecar re-seeds it); numbers clamp; overlapping and
 * invalid segments are dropped individually. Whether the recording HAS a webcam is the sidecar's call, not
 * this file's: see `reconcileWebcam` in scene.ts.
 *
 * `background` (ADR 0051) is additive too: absent or damaged → the default (none, 0, 0, 0), an
 * unknown preset → none, numbers clamp to the screenshot editor's PADDING/RADIUS/SHADOW ranges.
 * Older builds ignore the key, so a session with a background opens there without one.
 *
 * `sources` (ADR 0058) is the one NOT additive: a scene that joined recordings is written as
 * version 2, because an older build that ignored the key would play the joined clips' seconds
 * against the opened recording's file. Version 2 requires valid, non-overlapping sources and a
 * damaged table rejects the session (the clips are meaningless without it); a scene without
 * sources is still written as version 1, byte for byte as before.
 */
import { ZOOM_DEFAULTS, ZOOM_LIMITS, type ZoomSegment } from "./zoom/zoom-model";
import { clampIntensity, REDACTION, type NormRect, type Redaction } from "./privacy/redaction";
import { CAMERA_BUBBLE_SHAPES } from "@shared/camera-bubble";
import {
  WEBCAM_DEFAULTS,
  WEBCAM_MIN_SEGMENT_SECONDS,
  clampWebcamPatch,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
} from "./webcam/webcam-model";
import type {
  ArrowOverlay,
  BoxOverlay,
  ClipItem,
  ImageMediaItem,
  MediaAnchor,
  MutedRange,
  SceneSource,
  SlideItem,
  TextOverlay,
  TrackItem,
  VideoOverlay,
  VideoScene,
} from "./scene";

/**
 * `dragRangeEdge` clamps to `start + minSeconds`, which in floats can come back a hair under
 * the minimum (16.190612791990475 − 15.190612791990477 < 1); a saved drag must still load.
 */
const MIN_LENGTH_TOLERANCE = 1e-6;

export interface VideoEditSession {
  version: 1 | 2;
  scene: VideoScene;
  /**
   * False when the saved JSON predates v2 (no `zoomSegments` key). The loader then runs
   * detection once, exactly like a fresh open — see plans/video-editor-v2/07.
   */
  hasZoomData: boolean;
}

import { parseCursorSettings } from "./cursor/cursor-model";
import { parseBackground } from "./background";
import { MEDIA_MAX_FADE_MS } from "./media";

export function serializeSession(scene: VideoScene): string {
  if (scene.sources && scene.sources.length > 0) return JSON.stringify({ version: 2, scene });
  // No joins: version 1 and no `sources` key, exactly as it was written before they existed.
  if (scene.sources !== undefined) {
    const { sources: _empty, ...withoutSources } = scene;
    return JSON.stringify({ version: 1, scene: withoutSources });
  }
  return JSON.stringify({ version: 1, scene });
}

/**
 * Parse and validate a session JSON string. Returns `null` for any of:
 * - invalid JSON
 * - wrong `version` (1 and 2 are read), or version 2 without valid sources
 * - missing `items`/`overlays` arrays
 * - item with unknown `kind`
 * - overlay with unknown `kind`
 * - any required field that is non-numeric when a number is expected
 */
export function parseSession(json: string): VideoEditSession | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }

  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const version = r["version"];
  if (version !== 1 && version !== 2) return null;

  if (typeof r["scene"] !== "object" || r["scene"] === null) return null;
  const sceneRaw = r["scene"] as Record<string, unknown>;

  if (!Array.isArray(sceneRaw["items"])) return null;
  if (!Array.isArray(sceneRaw["overlays"])) return null;

  const items: TrackItem[] = [];
  for (const item of sceneRaw["items"] as unknown[]) {
    const validated = validateItem(item);
    if (validated === null) return null;
    items.push(validated);
  }

  const overlays: VideoOverlay[] = [];
  for (const overlay of sceneRaw["overlays"] as unknown[]) {
    const validated = validateOverlay(overlay);
    if (validated === null) return null;
    overlays.push(validated);
  }

  const zoomSegments: ZoomSegment[] = [];
  const hasZoomData = sceneRaw["zoomSegments"] !== undefined;
  if (hasZoomData) {
    if (!Array.isArray(sceneRaw["zoomSegments"])) return null;
    const parsed: ZoomSegment[] = [];
    for (const segment of sceneRaw["zoomSegments"] as unknown[]) {
      const validated = validateZoomSegment(segment);
      if (validated === null) return null;
      parsed.push(validated);
    }
    parsed.sort((a, b) => a.start - b.start);
    // The camera assumes exactly ONE active segment at a time (plans 05 and 06), and
    // nothing downstream re-checks it. A hand-edited file can break that, so drop the
    // overlapping segments rather than rejecting the session: the user's cuts and
    // redactions are worth far more than a stray zoom.
    for (const segment of parsed) {
      const previous = zoomSegments[zoomSegments.length - 1];
      if (previous && segment.start < previous.end) continue;
      zoomSegments.push(segment);
    }
  }

  const redactions: Redaction[] = [];
  if (sceneRaw["redactions"] !== undefined) {
    if (!Array.isArray(sceneRaw["redactions"])) return null;
    for (const redaction of sceneRaw["redactions"] as unknown[]) {
      const validated = validateRedaction(redaction);
      if (validated === null) return null;
      redactions.push(validated);
    }
  }

  // Audio edits are additive too: a session saved before muting existed has
  // neither key and loads as "nothing muted" rather than failing.
  let audioMuted = false;
  if (sceneRaw["audioMuted"] !== undefined) {
    if (typeof sceneRaw["audioMuted"] !== "boolean") return null;
    audioMuted = sceneRaw["audioMuted"];
  }

  const mutedRanges: MutedRange[] = [];
  if (sceneRaw["mutedRanges"] !== undefined) {
    if (!Array.isArray(sceneRaw["mutedRanges"])) return null;
    for (const raw of sceneRaw["mutedRanges"] as unknown[]) {
      const validated = validateMutedRange(raw);
      if (validated === null) return null;
      mutedRanges.push(validated);
    }
  }

  let zoomSensitivity: number = ZOOM_DEFAULTS.sensitivity;
  if (sceneRaw["zoomSensitivity"] !== undefined) {
    if (!isNum(sceneRaw["zoomSensitivity"])) return null;
    zoomSensitivity = Math.min(100, Math.max(0, sceneRaw["zoomSensitivity"] as number));
  }

  let webcam: WebcamScene | null = null;
  if (sceneRaw["webcam"] !== undefined && sceneRaw["webcam"] !== null) {
    // An invalid layer is dropped, not the session: the sidecar re-seeds it
    // (`reconcileWebcam`), whereas rejecting would cost the user's cuts, zooms and redactions,
    // and a later build adding a shape or mode would make this one reject its sessions.
    webcam = validateWebcam(sceneRaw["webcam"]);
  }

  const media = parseMedia(sceneRaw["media"]);

  // Only a version 2 file carries a source table; version 1 never did, so a stray key is ignored.
  let sources: SceneSource[] | undefined;
  if (version === 2) {
    sources = parseSources(sceneRaw["sources"]) ?? undefined;
    if (!sources) return null;
  }

  return {
    version,
    scene: {
      items,
      cursor: parseCursorSettings(sceneRaw["cursor"]),
      overlays,
      zoomSegments,
      redactions,
      zoomSensitivity,
      audioMuted,
      mutedRanges,
      webcam,
      // Additive like `webcam`: absent, a wrong shape or an unknown preset is the default,
      // never a rejected session; the numbers clamp to the screenshot editor's ranges.
      background: parseBackground(sceneRaw["background"]),
      // Additive too, and only present when the session had some: a session from before
      // floating images has no key, so it opens exactly as it did.
      ...(media ? { media } : {}),
      ...(sources ? { sources } : {}),
    },
    hasZoomData,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A muted range is only trusted when it names a real, forward span. A zero-width
 * or reversed one would silence nothing while still rendering a handle on the
 * timeline, so it is rejected rather than repaired.
 */
function validateMutedRange(raw: unknown): MutedRange | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r["id"]) || !isNum(r["sourceStart"]) || !isNum(r["sourceEnd"])) return null;
  const sourceStart = r["sourceStart"] as number;
  const sourceEnd = r["sourceEnd"] as number;
  if (sourceStart < 0 || sourceEnd <= sourceStart) return null;
  return { id: r["id"] as string, sourceStart, sourceEnd };
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function validateItem(raw: unknown): TrackItem | null {
  const i = obj(raw);
  if (!i) return null;
  if (!isStr(i["id"])) return null;

  if (i["kind"] === "clip") {
    if (!isNum(i["sourceStart"]) || !isNum(i["sourceEnd"])) return null;
    return {
      id: i["id"] as string,
      kind: "clip",
      sourceStart: i["sourceStart"] as number,
      sourceEnd: i["sourceEnd"] as number,
    } satisfies ClipItem;
  }

  if (i["kind"] === "slide") {
    if (!isStr(i["assetId"])) return null;
    if (!isNum(i["duration"]) || !isNum(i["naturalWidth"]) || !isNum(i["naturalHeight"]))
      return null;
    return {
      id: i["id"] as string,
      kind: "slide",
      assetId: i["assetId"] as string,
      duration: i["duration"] as number,
      naturalWidth: i["naturalWidth"] as number,
      naturalHeight: i["naturalHeight"] as number,
    } satisfies SlideItem;
  }

  // Unknown item kind — reject to avoid the worker receiving a shape it can't render.
  return null;
}

function clampUnit(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function validateMediaItem(raw: unknown): ImageMediaItem | null {
  const m = obj(raw);
  if (!m || m["kind"] !== "image") return null;
  if (!isStr(m["id"]) || !isStr(m["assetId"])) return null;
  if (!isNum(m["naturalWidth"]) || !isNum(m["naturalHeight"]) || !isNum(m["duration"])) {
    return null;
  }
  if (m["naturalWidth"] <= 0 || m["naturalHeight"] <= 0 || m["duration"] <= 0) return null;
  const a = obj(m["anchor"]);
  let anchor: MediaAnchor;
  if (a && a["kind"] === "source" && isNum(a["time"])) {
    anchor = { kind: "source", time: a["time"] };
  } else if (a && a["kind"] === "item" && isStr(a["itemId"]) && isNum(a["offset"])) {
    anchor = { kind: "item", itemId: a["itemId"], offset: Math.max(0, a["offset"]) };
  } else {
    return null;
  }
  const b = obj(m["box"]);
  if (!b || !isNum(b["x"]) || !isNum(b["y"]) || !isNum(b["width"]) || b["width"] <= 0) return null;
  const fade = (v: unknown): number =>
    isNum(v) ? Math.min(MEDIA_MAX_FADE_MS, Math.max(0, Math.round(v))) : 0;
  return {
    id: m["id"],
    kind: "image",
    assetId: m["assetId"],
    naturalWidth: m["naturalWidth"],
    naturalHeight: m["naturalHeight"],
    anchor,
    duration: m["duration"],
    box: {
      x: clampUnit(b["x"]),
      y: clampUnit(b["y"]),
      // A valid width is kept, even below the drag minimum: a tall image fitted to the picture
      // is narrower than that, like `setMediaBox` keeps it. Zero or negative was rejected above.
      width: Math.min(1, b["width"]),
    },
    z: isNum(m["z"]) ? m["z"] : 0,
    fadeInMs: fade(m["fadeInMs"]),
    fadeOutMs: fade(m["fadeOutMs"]),
  };
}

/**
 * Floating images are additive, like `webcam` and `background`: a missing or wrongly-shaped
 * list is "none", and one bad item is dropped without costing the user's cuts and zooms. `z`
 * comes back unique (the saved front-to-back order, ties by position) because stacking and the
 * timeline rows rely on it.
 */
function parseMedia(raw: unknown): ImageMediaItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const items: ImageMediaItem[] = [];
  for (const entry of raw as unknown[]) {
    const item = validateMediaItem(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const byZ = items
    .map((item, position) => ({ item, position }))
    .sort((a, b) => a.item.z - b.item.z || a.position - b.position);
  const zById = new Map(byZ.map(({ item }, z) => [item.id, z]));
  return items.map((item) => ({ ...item, z: zById.get(item.id)! }));
}

function validateSource(raw: unknown): SceneSource | null {
  const s = obj(raw);
  if (!s) return null;
  if (!isStr(s["id"]) || !isStr(s["assetId"]) || !isStr(s["title"])) return null;
  if (!isNum(s["offset"]) || !isNum(s["durationSeconds"])) return null;
  if (!isNum(s["width"]) || !isNum(s["height"])) return null;
  // A joined range never starts at 0: that is the opened recording's (ADR 0058).
  if (s["offset"] <= 0 || s["durationSeconds"] <= 0 || s["width"] < 0 || s["height"] < 0) {
    return null;
  }
  return {
    id: s["id"],
    assetId: s["assetId"],
    title: s["title"],
    offset: s["offset"],
    durationSeconds: s["durationSeconds"],
    width: s["width"],
    height: s["height"],
  };
}

/**
 * The joined recordings of a version 2 session (ADR 0058), in the saved order. Null when the
 * list is missing, empty or damaged, when two entries share an id, when a range starts at 0 or
 * when two ranges overlap or touch:
 * every joined clip's seconds are read through this table, so a repaired one would put footage
 * under the wrong recording.
 */
function parseSources(raw: unknown): SceneSource[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const sources: SceneSource[] = [];
  for (const entry of raw as unknown[]) {
    const validated = validateSource(entry);
    if (!validated) return null;
    sources.push(validated);
  }
  if (new Set(sources.map((s) => s.id)).size !== sources.length) return null;
  const byOffset = [...sources].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < byOffset.length; i++) {
    const previous = byOffset[i - 1];
    // Ranges never touch: `recordingAt` includes both ends, so a shared second is ambiguous.
    if (byOffset[i].offset <= previous.offset + previous.durationSeconds) return null;
  }
  return sources;
}

function validateOverlay(raw: unknown): VideoOverlay | null {
  const o = obj(raw);
  if (!o) return null;
  if (!isStr(o["id"]) || !isStr(o["color"])) return null;
  if (!isNum(o["start"]) || !isNum(o["end"])) return null;

  if (o["kind"] === "box") {
    if (
      !isNum(o["x"]) ||
      !isNum(o["y"]) ||
      !isNum(o["w"]) ||
      !isNum(o["h"]) ||
      !isNum(o["stroke"]) ||
      !isNum(o["seed"])
    )
      return null;
    return {
      id: o["id"] as string,
      kind: "box",
      start: o["start"] as number,
      end: o["end"] as number,
      color: o["color"] as string,
      x: o["x"] as number,
      y: o["y"] as number,
      w: o["w"] as number,
      h: o["h"] as number,
      stroke: o["stroke"] as number,
      seed: o["seed"] as number,
    } satisfies BoxOverlay;
  }

  if (o["kind"] === "arrow") {
    if (
      !isNum(o["x1"]) ||
      !isNum(o["y1"]) ||
      !isNum(o["x2"]) ||
      !isNum(o["y2"]) ||
      !isNum(o["stroke"]) ||
      !isNum(o["seed"])
    )
      return null;
    return {
      id: o["id"] as string,
      kind: "arrow",
      start: o["start"] as number,
      end: o["end"] as number,
      color: o["color"] as string,
      x1: o["x1"] as number,
      y1: o["y1"] as number,
      x2: o["x2"] as number,
      y2: o["y2"] as number,
      stroke: o["stroke"] as number,
      seed: o["seed"] as number,
    } satisfies ArrowOverlay;
  }

  if (o["kind"] === "text") {
    if (!isNum(o["x"]) || !isNum(o["y"]) || !isStr(o["text"]) || !isNum(o["size"])) return null;
    return {
      id: o["id"] as string,
      kind: "text",
      start: o["start"] as number,
      end: o["end"] as number,
      color: o["color"] as string,
      x: o["x"] as number,
      y: o["y"] as number,
      text: o["text"] as string,
      size: o["size"] as number,
      // Optional on purpose: absent in every session written before the box governed
      // the text, and absent means exactly the old behaviour.
      ...(typeof o["width"] === "number" ? { width: o["width"] } : {}),
      ...(typeof o["fontPx"] === "number" ? { fontPx: o["fontPx"] } : {}),
    } satisfies TextOverlay;
  }

  // Unknown overlay kind — reject so the worker never receives a type it can't stamp.
  return null;
}

function validatePoint(raw: unknown): { x: number; y: number } | null {
  const p = obj(raw);
  if (!p || !isNum(p["x"]) || !isNum(p["y"])) return null;
  return { x: p["x"] as number, y: p["y"] as number };
}

function validateZoomSegment(raw: unknown): ZoomSegment | null {
  const z = obj(raw);
  if (!z) return null;
  if (!isStr(z["id"]) || !isNum(z["start"]) || !isNum(z["end"])) return null;
  if (!isNum(z["scale"]) || !isNum(z["smoothing"])) return null;
  const start = z["start"] as number;
  const end = z["end"] as number;
  // `end > start` is not enough: a segment under the minimum has no draggable block on
  // the timeline and the camera would flicker through it.
  if (end - start < ZOOM_LIMITS.minSeconds - MIN_LENGTH_TOLERANCE) return null;
  if (z["mode"] !== "follow" && z["mode"] !== "fixed") return null;
  if (z["origin"] !== "auto" && z["origin"] !== "manual") return null;
  const trigger = z["trigger"] ?? null;
  if (trigger !== null && trigger !== "click" && trigger !== "dwell") return null;
  let anchor: { x: number; y: number } | null = null;
  if (z["anchor"] !== null && z["anchor"] !== undefined) {
    anchor = validatePoint(z["anchor"]);
    if (!anchor) return null;
  }
  return {
    id: z["id"] as string,
    start,
    end,
    scale: Math.min(ZOOM_LIMITS.maxScale, Math.max(ZOOM_LIMITS.minScale, z["scale"] as number)),
    mode: z["mode"],
    anchor,
    smoothing: Math.min(100, Math.max(0, z["smoothing"] as number)),
    origin: z["origin"],
    trigger,
  };
}

const WEBCAM_SHAPES = CAMERA_BUBBLE_SHAPES;

/**
 * The layout fields present in `raw`, validated by type and clamped; null when one is the
 * wrong type. With `complete`, every field must be there (the global layout); without, any
 * subset is fine (an override).
 */
function validateWebcamLayout(raw: unknown, complete: boolean): Partial<WebcamLayout> | null {
  const l = obj(raw);
  if (!l) return null;
  const patch: Partial<WebcamLayout> = {};
  const has = (key: string): boolean => l[key] !== undefined;
  if (has("shape")) {
    if (!(WEBCAM_SHAPES as readonly unknown[]).includes(l["shape"])) return null;
    patch.shape = l["shape"] as WebcamLayout["shape"];
  }
  for (const key of ["size", "scaleDuringZoom", "cornerRadius"] as const) {
    if (!has(key)) continue;
    if (!isNum(l[key])) return null;
    patch[key] = l[key];
  }
  for (const key of ["mirrored", "shadow"] as const) {
    if (!has(key)) continue;
    if (typeof l[key] !== "boolean") return null;
    patch[key] = l[key];
  }
  if (has("position")) {
    const position = validatePoint(l["position"]);
    if (!position) return null;
    patch.position = position;
  }
  if (has("framing")) {
    const f = obj(l["framing"]);
    if (!f || !isNum(f["zoom"]) || !isNum(f["x"]) || !isNum(f["y"])) return null;
    patch.framing = { zoom: f["zoom"], x: f["x"], y: f["y"] };
  }
  if (complete) {
    const keys: Array<keyof WebcamLayout> = [
      "shape",
      "size",
      "position",
      "mirrored",
      "framing",
      "scaleDuringZoom",
      "shadow",
    ];
    if (keys.some((key) => patch[key] === undefined)) return null;
    // Sessions saved before the corner slider (ADR 0041) have none: today's 18 %.
    patch.cornerRadius ??= WEBCAM_DEFAULTS.cornerRadius;
  }
  return clampWebcamPatch(patch);
}

function validateWebcamSegment(raw: unknown): WebcamSegment | null {
  const g = obj(raw);
  if (!g) return null;
  if (!isStr(g["id"]) || !isNum(g["start"]) || !isNum(g["end"])) return null;
  const start = g["start"] as number;
  const end = g["end"] as number;
  // Same floor as a zoom: a shorter one has no block the user could grab on the timeline.
  if (end - start < WEBCAM_MIN_SEGMENT_SECONDS - MIN_LENGTH_TOLERANCE) return null;
  if (g["mode"] === "hidden") return { id: g["id"] as string, start, end, mode: "hidden" };
  if (g["mode"] !== "override") return null;
  const segment: WebcamSegment = { id: g["id"] as string, start, end, mode: "override" };
  if (g["layout"] !== undefined) {
    const layout = validateWebcamLayout(g["layout"], false);
    if (!layout) return null;
    segment.layout = layout;
  }
  return segment;
}

function validateWebcam(raw: unknown): WebcamScene | null {
  const w = obj(raw);
  if (!w) return null;
  const layout = validateWebcamLayout(w["layout"], true) as WebcamLayout | null;
  if (!layout) return null;
  const parsed: WebcamSegment[] = [];
  if (w["segments"] !== undefined) {
    if (!Array.isArray(w["segments"])) return null;
    for (const segment of w["segments"] as unknown[]) {
      const validated = validateWebcamSegment(segment);
      if (validated) parsed.push(validated);
    }
  }
  parsed.sort((a, b) => a.start - b.start);
  // Exactly one layout is in force at a time (`webcamAt` takes the first match), so overlaps
  // are dropped on load rather than rejecting the session, like zoom segments.
  const segments: WebcamSegment[] = [];
  for (const segment of parsed) {
    const previous = segments[segments.length - 1];
    if (previous && segment.start < previous.end) continue;
    segments.push(segment);
  }
  return { layout, segments };
}

function validateRect(raw: unknown): NormRect | null {
  const r = obj(raw);
  if (!r || !isNum(r["x"]) || !isNum(r["y"]) || !isNum(r["w"]) || !isNum(r["h"])) return null;
  if ((r["w"] as number) <= 0 || (r["h"] as number) <= 0) return null;
  return { x: r["x"] as number, y: r["y"] as number, w: r["w"] as number, h: r["h"] as number };
}

function validateRedaction(raw: unknown): Redaction | null {
  const r = obj(raw);
  if (!r) return null;
  if (!isStr(r["id"]) || !isNum(r["start"]) || !isNum(r["end"])) return null;
  const start = r["start"] as number;
  const end = r["end"] as number;
  if (end <= start) return null;
  const rect = validateRect(r["rect"]);
  if (!rect) return null;
  const base = { id: r["id"] as string, start, end, rect };

  if (r["kind"] === "blur") {
    if (!isNum(r["intensity"])) return null;
    if (r["style"] !== "gaussian" && r["style"] !== "pixelate") return null;
    // Clamp on load too: a hand-edited session must never produce a weak, reversible blur.
    return {
      ...base,
      kind: "blur",
      intensity: clampIntensity(r["intensity"] as number),
      style: r["style"],
    };
  }
  if (r["kind"] === "cover") {
    if (!isStr(r["fill"]) || !isStr(r["label"])) return null;
    const fill = (REDACTION.coverFills as readonly string[]).includes(r["fill"] as string)
      ? (r["fill"] as string)
      : REDACTION.coverFills[0];
    return { ...base, kind: "cover", fill, label: r["label"] as string };
  }
  return null;
}
