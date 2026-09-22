/**
 * Video-editor scene model. All overlay geometry is normalized 0–1 of the VIDEO frame
 * (same convention as screenshot annotations); all times are seconds. Overlays are
 * anchored to TIMELINE time (the edited result), not source time — see the design spec.
 * Zoom segments and redactions (v2) are the exception: they are anchored to SOURCE time
 * — see plans/video-editor-v2/06.
 */
import { ZOOM_DEFAULTS, type ZoomSegment } from "./zoom/zoom-model";
import type { Redaction } from "./privacy/redaction";

export interface ClipItem {
  id: string;
  kind: "clip";
  /** Seconds into the source recording. */
  sourceStart: number;
  /** Exclusive end, always > sourceStart. */
  sourceEnd: number;
}

export interface SlideItem {
  id: string;
  kind: "slide";
  /** Image stored as an edit-session asset in the vault (plan 06 persists it). */
  assetId: string;
  /** Seconds the image is held on screen. */
  duration: number;
  naturalWidth: number;
  naturalHeight: number;
}

export type TrackItem = ClipItem | SlideItem;

interface OverlayBase {
  id: string;
  /** Visibility window in timeline seconds. */
  start: number;
  end: number;
  color: string;
}

export interface BoxOverlay extends OverlayBase {
  kind: "box";
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: number;
  seed: number;
}

export interface ArrowOverlay extends OverlayBase {
  kind: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: number;
  seed: number;
}

export interface TextOverlay extends OverlayBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  /** Display px at preview scale, snapped to TEXT_PX levels like screenshots. */
  size: number;
}

export type VideoOverlay = BoxOverlay | ArrowOverlay | TextOverlay;

export interface VideoScene {
  /** The main track in playback order; uncovered source footage is deleted footage. */
  items: TrackItem[];
  overlays: VideoOverlay[];
  /** Source-anchored, sorted by start, never overlapping. */
  zoomSegments: ZoomSegment[];
  /** Source-anchored privacy regions; may overlap. */
  redactions: Redaction[];
  /** Detection sensitivity 0–100; regenerates `origin: "auto"` segments. */
  zoomSensitivity: number;
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * The scene for a recording opened without a saved session: no zooms yet. The detector's
 * proposal is folded in afterwards by `withInitialZooms` (initial-zooms.ts), still as
 * part of the INITIAL scene and never as a commit, so opening and leaving the editor does
 * not count as an unsaved edit.
 *
 * `ZOOM_DEFAULTS` comes from zoom-model.ts rather than from the detector: scene.ts is
 * reachable from the export worker, and a VALUE import of detect-zoom-segments.ts would
 * pull the whole detector into that bundle.
 */
export function initialScene(durationSeconds: number): VideoScene {
  return {
    items: [{ id: newId(), kind: "clip", sourceStart: 0, sourceEnd: durationSeconds }],
    overlays: [],
    zoomSegments: [],
    redactions: [],
    zoomSensitivity: ZOOM_DEFAULTS.sensitivity,
  };
}
