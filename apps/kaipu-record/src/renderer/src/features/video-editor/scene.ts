import { DEFAULT_CURSOR, type CursorSettings } from "./cursor/cursor-model";
import type { MutedRange } from "./audio-edits";
/**
 * Video-editor scene model. All overlay geometry is normalized 0–1 of the VIDEO frame
 * (same convention as screenshot annotations); all times are seconds. Overlays are
 * anchored to TIMELINE time (the edited result), not source time — see the design spec.
 * Zoom segments and redactions (v2) are the exception: they are anchored to SOURCE time
 * — see plans/video-editor-v2/06.
 */
import { ZOOM_DEFAULTS, type ZoomSegment } from "./zoom/zoom-model";
import type { Redaction } from "./privacy/redaction";
import { seedWebcamScene, type WebcamScene } from "./webcam/webcam-model";
import { DEFAULT_BACKGROUND, type VideoBackground } from "./background";
import type { WebcamTrackMeta } from "@shared/webcam-track";

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

/**
 * What a floating item is tied to. A join or an insert shifts the recording, so a timeline
 * time would end up over another moment: the item follows the footage under its start
 * (ADR 0057). `resolveAnchor` in timeline.ts turns it back into a timeline time.
 */
export type MediaAnchor =
  | { kind: "source"; time: number } // seconds into the recording, inside a clip
  | { kind: "item"; itemId: string; offset: number }; // seconds into a slide of the sequence

/** Centre and width of a floating item, as 0–1 of the picture (the webcam layer's space). */
export interface MediaBox {
  x: number;
  y: number;
  width: number;
}

/** A floating image over the Clips sequence: a box in the frame, a stacking order, fades. */
export interface ImageMediaItem {
  id: string;
  kind: "image";
  /** Stored exactly as a slide's asset is, in the same asset store. */
  assetId: string;
  naturalWidth: number;
  naturalHeight: number;
  anchor: MediaAnchor;
  /** Timeline seconds; the end is clamped to the end of the timeline when drawn. */
  duration: number;
  box: MediaBox;
  /** Unique within the scene; higher is in front. */
  z: number;
  fadeInMs: number;
  fadeOutMs: number;
}

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
  /** Index into TEXT_PX — the XS/S/M/L presets. Superseded by `fontPx` when set. */
  size: number;
  /**
   * Wrap width in normalized units, set by dragging a side. The text reflows by
   * words to fit it, so the BOX governs the text rather than the other way round.
   * Absent = auto width: break only where the user pressed Enter.
   */
  width?: number;
  /**
   * Free font size in px, set by dragging a corner. Wins over `size`, which is why a
   * corner drag is continuous instead of snapping between four levels; the size
   * control reads "Custom" while it is set and clearing it returns to the presets.
   */
  fontPx?: number;
}

export type VideoOverlay = BoxOverlay | ArrowOverlay | TextOverlay;

export type { MutedRange } from "./audio-edits";

export interface VideoScene {
  cursor?: CursorSettings;
  /** The main track in playback order; uncovered source footage is deleted footage. */
  items: TrackItem[];
  overlays: VideoOverlay[];
  /** Source-anchored, sorted by start, never overlapping. */
  zoomSegments: ZoomSegment[];
  /** Source-anchored privacy regions; may overlap. */
  redactions: Redaction[];
  /** Detection sensitivity 0–100; regenerates `origin: "auto"` segments. */
  zoomSensitivity: number;
  /**
   * The whole recording is silent — the export drops the audio track rather than
   * writing a silent one. Separate from `mutedRanges` on purpose: see audio-edits.ts.
   */
  audioMuted: boolean;
  /** Source-anchored silenced spans; may overlap, and are never merged on input. */
  mutedRanges: MutedRange[];
  /**
   * The webcam layer (ADR 0038): a global layout plus source-anchored hide/override
   * segments. `null` = this recording has no webcam track; the sidecar decides, never the
   * session (see `reconcileWebcam`).
   */
  webcam: WebcamScene | null;
  /**
   * The picture's background, padding, corner radius and shadow (ADR 0051): drawn around
   * the composed picture as the outermost step of the preview, the MP4 and the GIF. Absent
   * (a scene or a session from before backgrounds) = `DEFAULT_BACKGROUND`, today's picture.
   */
  background?: VideoBackground;
  /**
   * Floating images above the Clips sequence (ADR 0057). Absent = none, which is every scene
   * saved before this field: it opens unchanged.
   */
  media?: ImageMediaItem[];
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
export function initialScene(
  durationSeconds: number,
  webcam: WebcamTrackMeta | null = null,
): VideoScene {
  return {
    items: [{ id: newId(), kind: "clip", sourceStart: 0, sourceEnd: durationSeconds }],
    cursor: { ...DEFAULT_CURSOR },
    overlays: [],
    zoomSegments: [],
    redactions: [],
    zoomSensitivity: ZOOM_DEFAULTS.sensitivity,
    audioMuted: false,
    mutedRanges: [],
    webcam: seedWebcamScene(webcam, durationSeconds),
    background: { ...DEFAULT_BACKGROUND },
  };
}

/** The scene's background, or the default for a scene that never set one. */
export function backgroundOf(scene: Pick<VideoScene, "background">): VideoBackground {
  return scene.background ?? DEFAULT_BACKGROUND;
}

/**
 * A saved scene against the recording it belongs to: the sidecar has the last word on whether
 * a webcam exists. Without a track the saved layer is dropped (its file is gone or never
 * was); with one and no saved layer (a session from before the webcam) the layer is seeded
 * from the recording, like a fresh scene. A saved layer on a recording that still has its
 * track is the user's edit and stays. Returns the same scene when nothing changes.
 * `durationSeconds` (the recording's) keeps a seeded gap inside it, as `initialScene` does.
 */
export function reconcileWebcam(
  scene: VideoScene,
  webcam: WebcamTrackMeta | null,
  durationSeconds: number,
): VideoScene {
  if (!webcam) return scene.webcam === null ? scene : { ...scene, webcam: null };
  return scene.webcam ? scene : { ...scene, webcam: seedWebcamScene(webcam, durationSeconds) };
}
