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
 */
import { ZOOM_DEFAULTS, ZOOM_LIMITS, type ZoomSegment } from "./zoom/zoom-model";
import { clampIntensity, REDACTION, type NormRect, type Redaction } from "./privacy/redaction";
import type {
  ArrowOverlay,
  BoxOverlay,
  ClipItem,
  MutedRange,
  SlideItem,
  TextOverlay,
  TrackItem,
  VideoOverlay,
  VideoScene,
} from "./scene";

export interface VideoEditSession {
  version: 1;
  scene: VideoScene;
  /**
   * False when the saved JSON predates v2 (no `zoomSegments` key). The loader then runs
   * detection once, exactly like a fresh open — see plans/video-editor-v2/07.
   */
  hasZoomData: boolean;
}

export function serializeSession(scene: VideoScene): string {
  return JSON.stringify({ version: 1, scene });
}

/**
 * Parse and validate a session JSON string. Returns `null` for any of:
 * - invalid JSON
 * - wrong `version`
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

  if (r["version"] !== 1) return null;

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

  return {
    version: 1,
    scene: { items, overlays, zoomSegments, redactions, zoomSensitivity, audioMuted, mutedRanges },
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
  if (end - start < ZOOM_LIMITS.minSeconds) return null;
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
