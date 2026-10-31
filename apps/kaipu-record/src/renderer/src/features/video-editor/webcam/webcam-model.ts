/**
 * The webcam layer's data (ADR 0033): one global layout plus source-anchored segments that
 * hide it or override part of it. Pure and import-light on purpose: scene.ts, the export
 * worker and the session parser all read it, so it takes nothing but constants and types.
 *
 * Every time here is SOURCE seconds, like zoom segments: a cut never moves a segment. The
 * position is the bubble's centre in the OUTPUT frame, and the size a fraction of the output's
 * height, so the layer means the same thing on every preset. Drawing (the rectangle in pixels,
 * the clamp that keeps the bubble inside the frame) belongs to the preview and the composer.
 */
import { clampCameraPan, clampCameraZoom, type CameraBubbleShape } from "@shared/camera-bubble";
import type { WebcamGap, WebcamTrackMeta } from "@shared/webcam-track";
import { ZOOM_LIMITS } from "../zoom/zoom-model";

export interface WebcamLayout {
  shape: CameraBubbleShape;
  /** Bubble side as a fraction of the OUTPUT frame's height, {@link WEBCAM_LIMITS}. */
  size: number;
  /** Normalized centre in the OUTPUT frame, 0–1. */
  position: { x: number; y: number };
  mirrored: boolean;
  /** Same ranges as `CameraBubbleSettings.framing`; zoom 1 and pan 0 show the whole image. */
  framing: { zoom: number; x: number; y: number };
  /** 1 = same size inside a zoom; 0.7 = Cap's default. */
  scaleDuringZoom: number;
  shadow: boolean;
}

export interface WebcamSegment {
  id: string;
  /** SOURCE seconds, sorted, non-overlapping, at least `ZOOM_LIMITS.minSeconds` long. */
  start: number;
  /** Exclusive. */
  end: number;
  mode: "hidden" | "override";
  /** `override` only: the fields that differ from the global layout. */
  layout?: Partial<WebcamLayout>;
}

export interface WebcamScene {
  layout: WebcamLayout;
  segments: WebcamSegment[];
}

export const WEBCAM_LIMITS = {
  minSize: 0.1,
  maxSize: 0.6,
  /** A bubble can shrink to under a third of its size inside a zoom, never vanish. */
  minScaleDuringZoom: 0.3,
  maxScaleDuringZoom: 1,
} as const;

/** The bubble's default look: bottom-left, where the recorder starts it. */
export const WEBCAM_DEFAULTS: WebcamLayout = {
  shape: "circle",
  size: 0.22,
  position: { x: 0.12, y: 0.82 },
  mirrored: true,
  framing: { zoom: 1, x: 0, y: 0 },
  scaleDuringZoom: 0.7,
  shadow: true,
};

/** The frame height, in DIP, a bubble recorded without a size fraction is assumed to sit in. */
const NOMINAL_FRAME_DIP = 1080;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const unit = (value: number): number => clamp(value, 0, 1);

/** The given layout fields held inside their ranges; absent ones stay absent. */
export function clampWebcamPatch(patch: Partial<WebcamLayout>): Partial<WebcamLayout> {
  const next: Partial<WebcamLayout> = { ...patch };
  if (patch.size !== undefined) {
    next.size = clamp(patch.size, WEBCAM_LIMITS.minSize, WEBCAM_LIMITS.maxSize);
  }
  if (patch.position) next.position = { x: unit(patch.position.x), y: unit(patch.position.y) };
  if (patch.scaleDuringZoom !== undefined) {
    next.scaleDuringZoom = clamp(
      patch.scaleDuringZoom,
      WEBCAM_LIMITS.minScaleDuringZoom,
      WEBCAM_LIMITS.maxScaleDuringZoom,
    );
  }
  if (patch.framing) {
    next.framing = {
      zoom: clampCameraZoom(patch.framing.zoom),
      x: clampCameraPan(patch.framing.x),
      y: clampCameraPan(patch.framing.y),
    };
  }
  return next;
}

/**
 * The scene's webcam for a recording: `null` without a webcam track (the sidecar decides),
 * otherwise the layout seeded from the bubble as it was recorded, so the first preview matches
 * what the user saw. A bubble that was never recorded gets the defaults. The size is the
 * fraction main measured; a take from before main measured it falls back to the DIP size over
 * a nominal 1080-DIP frame. The file is raw, so framing only carries over while it was on.
 *
 * Each period the camera was off during the take (`gaps`) is seeded as a hidden segment: the
 * webcam file holds its last frame there, so the lane shows it striped and the export leaves
 * the face out. `durationSeconds`, when known, keeps a stretched gap inside the recording.
 */
export function seedWebcamScene(
  webcam: WebcamTrackMeta | null | undefined,
  durationSeconds?: number,
): WebcamScene | null {
  if (!webcam) return null;
  const segments = gapSegments(webcam.gaps ?? [], durationSeconds);
  const recorded = webcam.recordedLayout;
  if (!recorded) return { layout: { ...WEBCAM_DEFAULTS }, segments };
  const framing = recorded.framing.enabled
    ? { zoom: recorded.framing.zoom, x: recorded.framing.x, y: recorded.framing.y }
    : { ...WEBCAM_DEFAULTS.framing };
  const layout: WebcamLayout = {
    ...WEBCAM_DEFAULTS,
    shape: recorded.shape,
    mirrored: recorded.mirrored,
    ...clampWebcamPatch({
      size: recorded.sizeFraction ?? recorded.size / NOMINAL_FRAME_DIP,
      position: recorded.position ?? WEBCAM_DEFAULTS.position,
      framing,
    }),
  };
  return { layout, segments };
}

/**
 * Gaps (screen ms, sorted, apart) as hidden segments (source seconds). One shorter than a
 * segment can be is stretched to that length (the session drops a shorter one on reload), from
 * its start, or back from the recording's end; those that then overlap are merged.
 */
function gapSegments(gaps: WebcamGap[], durationSeconds?: number): WebcamSegment[] {
  const segments: WebcamSegment[] = [];
  for (const gap of gaps) {
    let start = gap.startMs / 1000;
    let end = Math.max(gap.endMs / 1000, start + WEBCAM_MIN_SEGMENT_SECONDS);
    if (
      durationSeconds !== undefined &&
      Number.isFinite(durationSeconds) &&
      end > durationSeconds
    ) {
      end = durationSeconds;
      start = Math.max(0, Math.min(start, end - WEBCAM_MIN_SEGMENT_SECONDS));
    }
    // Only a recording shorter than a segment leaves one too short (1e-6: float noise).
    if (end - start < WEBCAM_MIN_SEGMENT_SECONDS - 1e-6) continue;
    const previous = segments[segments.length - 1];
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
      continue;
    }
    // An id from where it starts (segments are apart, so it is unique): seeding the same take
    // twice gives the same layer, and Share's fingerprint of it (`wholeFingerprint`) stays.
    segments.push({ id: `gap-${Math.round(start * 1000)}`, start, end, mode: "hidden" });
  }
  return segments;
}

/**
 * The layout in force at source time `t`: null when there is no webcam or a hidden segment
 * covers `t`; the global layout with an override's fields over it inside an override; the
 * global layout (the same object) otherwise. Segments are [start, end).
 */
export function webcamAt(scene: { webcam: WebcamScene | null }, t: number): WebcamLayout | null {
  const webcam = scene.webcam;
  if (!webcam) return null;
  const segment = webcam.segments.find((s) => t >= s.start && t < s.end);
  if (!segment) return webcam.layout;
  if (segment.mode === "hidden") return null;
  return segment.layout ? { ...webcam.layout, ...segment.layout } : webcam.layout;
}

/** The shortest segment the timeline can draw, shared with zoom segments. */
export const WEBCAM_MIN_SEGMENT_SECONDS = ZOOM_LIMITS.minSeconds;
