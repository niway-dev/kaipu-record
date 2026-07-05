/**
 * Edit-session serialization for the video editor. `serializeSession` collapses the
 * current scene into a JSON string; `parseSession` validates it structurally (field by
 * field — no zod, consistent with the rest of this codebase) and returns null for
 * anything invalid so the caller can silently fall back to a fresh scene.
 *
 * The version field is an intentional break point: if the shape ever changes in an
 * incompatible way we bump `version` and old sessions are ignored (parse returns null).
 */
import type {
  ArrowOverlay,
  BoxOverlay,
  ClipItem,
  SlideItem,
  TextOverlay,
  TrackItem,
  VideoOverlay,
  VideoScene,
} from "./scene";

export interface VideoEditSession {
  version: 1;
  scene: VideoScene;
}

export function serializeSession(scene: VideoScene): string {
  const session: VideoEditSession = { version: 1, scene };
  return JSON.stringify(session);
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

  return { version: 1, scene: { items, overlays } };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
    } satisfies TextOverlay;
  }

  // Unknown overlay kind — reject so the worker never receives a type it can't stamp.
  return null;
}
