/**
 * The webcam layer's data (ADR 0038): one global layout plus source-anchored segments that
 * hide it or override part of it. Pure and import-light on purpose: scene.ts, the export
 * worker and the session parser all read it, so it takes nothing but constants and types.
 *
 * Every time here is SOURCE seconds, like zoom segments: a cut never moves a segment. The
 * position is the bubble's centre in the OUTPUT frame, and the size a fraction of the output's
 * height, so the layer means the same thing on every preset. Drawing (the rectangle in pixels,
 * the clamp that keeps the bubble inside the frame) belongs to the preview and the composer.
 */
import {
  DEFAULT_CAMERA_CORNER_RADIUS,
  clampCameraCornerRadius,
  clampCameraPan,
  clampCameraZoom,
  type CameraBubbleShape,
} from "@shared/camera-bubble";
import type { WebcamGap, WebcamTrackMeta } from "@shared/webcam-track";
import { ZOOM_LIMITS } from "../zoom/zoom-model";
import { EASING_PRESETS, easeValue, type EasingPreset } from "./easing";

export interface WebcamLayout {
  shape: CameraBubbleShape;
  /**
   * Bubble HEIGHT as a fraction of the OUTPUT frame's height, {@link WEBCAM_LIMITS}. The width
   * follows the shape: the same for the circle and the square, 3/4 of it for the rectangle.
   */
  size: number;
  /** Corner radius of the square and the rectangle, a share of the shorter side (ADR 0041). */
  cornerRadius: number;
  /** Normalized centre in the OUTPUT frame, 0–1. */
  position: { x: number; y: number };
  mirrored: boolean;
  /** Same ranges as `CameraBubbleSettings.framing`; zoom 1 and pan 0 show the whole image. */
  framing: { zoom: number; x: number; y: number };
  /** 1 = same size inside a zoom; 0.7 = Cap's default. */
  scaleDuringZoom: number;
  shadow: boolean;
}

export const WEBCAM_EASINGS = EASING_PRESETS;

export type WebcamEasing = EasingPreset;

/**
 * How a block's start (and its return to the default layout) plays (ADR 0039). `cut` is an
 * instant change. `ms` is the duration before the half-block cap of
 * {@link webcamEffectiveTransitionMs}.
 */
export interface WebcamTransition {
  kind: "slide" | "cut";
  ms: number;
  easing: WebcamEasing;
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
  /**
   * `override` only. Absent is a Cut, so a session saved before transitions existed opens
   * with every block changing at once, as it always did.
   */
  transition?: WebcamTransition;
}

export interface WebcamScene {
  layout: WebcamLayout;
  segments: WebcamSegment[];
}

export const WEBCAM_LIMITS = {
  minSize: 0.12,
  maxSize: 0.9,
  /** A bubble can shrink to under a third of its size inside a zoom, never vanish. */
  minScaleDuringZoom: 0.3,
  maxScaleDuringZoom: 1,
} as const;

export const WEBCAM_TRANSITION_DEFAULTS: WebcamTransition = {
  kind: "slide",
  ms: 700,
  easing: "back",
};

export const WEBCAM_TRANSITION_LIMITS = { minMs: 200, maxMs: 2000 } as const;

/**
 * A transition from untrusted fields (a saved session, an inspector control): each field
 * that is missing or invalid takes the default's value, and the duration is rounded and
 * held inside {@link WEBCAM_TRANSITION_LIMITS}.
 */
export function clampWebcamTransition(partial: {
  kind?: unknown;
  ms?: unknown;
  easing?: unknown;
}): WebcamTransition {
  const { kind, ms, easing } = partial;
  return {
    kind: kind === "slide" || kind === "cut" ? kind : WEBCAM_TRANSITION_DEFAULTS.kind,
    ms: clamp(
      Math.round(
        typeof ms === "number" && Number.isFinite(ms) ? ms : WEBCAM_TRANSITION_DEFAULTS.ms,
      ),
      WEBCAM_TRANSITION_LIMITS.minMs,
      WEBCAM_TRANSITION_LIMITS.maxMs,
    ),
    easing: (WEBCAM_EASINGS as readonly unknown[]).includes(easing)
      ? (easing as WebcamEasing)
      : WEBCAM_TRANSITION_DEFAULTS.easing,
  };
}

/**
 * The inspector's Size label: the stored range 0.12–0.90 shown as 10–90, so the owner's
 * wording stays while the slider moves linearly over the stored size.
 */
export function webcamSizeLabel(size: number): number {
  const { minSize, maxSize } = WEBCAM_LIMITS;
  return Math.round(10 + ((size - minSize) / (maxSize - minSize)) * 80);
}

/** The bubble's default look: bottom-left, where the recorder starts it. */
export const WEBCAM_DEFAULTS: WebcamLayout = {
  shape: "circle",
  size: 0.22,
  cornerRadius: DEFAULT_CAMERA_CORNER_RADIUS,
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
  if (patch.cornerRadius !== undefined) {
    next.cornerRadius = clampCameraCornerRadius(patch.cornerRadius);
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
    // A sidecar from before the corner slider has none: the clamp gives today's 18 %.
    cornerRadius: clampCameraCornerRadius(recorded.cornerRadius),
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

/**
 * What the bubble does at one source instant: the layout in force, and while it is moving
 * there, the layout it moves from. The two differ in `position` only (this version animates
 * position; every other field applies at once). The module has no frame, so the rectangles
 * and the overshoot limit belong to `webcamStateRect`.
 */
export interface WebcamState {
  layout: WebcamLayout;
  /** The layout the bubble slides from; null when no transition is active. */
  from: WebcamLayout | null;
  /**
   * The EASED progress from `from.position` to `layout.position`: 0 at the start of the
   * transition and 1 at its end. `back` passes 1 in between. 1 when `from` is null.
   */
  progress: number;
  /** The preset behind `progress`; `webcamStateRect` needs its peak to fit the overshoot. */
  easing: WebcamEasing;
}

/** Segment ends and starts this close count as touching (float noise from edge drags). */
const ADJACENT_EPSILON = 1e-6;

/** The part of a block (seconds long, `ms` asked for) a transition may use: half of it. */
export function webcamEffectiveTransitionMs(segmentLength: number, ms: number): number {
  return Math.min(ms, (segmentLength * 1000) / 2);
}

const samePosition = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

/** The position an override segment puts the bubble at (its own, else the default's). */
const segmentPosition = (webcam: WebcamScene, segment: WebcamSegment) =>
  segment.layout?.position ?? webcam.layout.position;

function settled(layout: WebcamLayout): WebcamState {
  return { layout, from: null, progress: 1, easing: "linear" };
}

/**
 * The slide from `fromPosition` to `layout`'s, `elapsed` seconds into a window of `windowMs`
 * (already capped); settled outside the window and when nothing would move.
 */
function slideState(
  layout: WebcamLayout,
  fromPosition: { x: number; y: number },
  transition: WebcamTransition,
  windowMs: number,
  elapsed: number,
): WebcamState {
  const windowSeconds = windowMs / 1000;
  if (!(windowSeconds > 0) || elapsed >= windowSeconds) return settled(layout);
  if (samePosition(fromPosition, layout.position)) return settled(layout);
  return {
    layout,
    from: { ...layout, position: { ...fromPosition } },
    progress: easeValue(transition.easing, elapsed / windowSeconds),
    easing: transition.easing,
  };
}

/**
 * The bubble at SOURCE time `t`: {@link webcamAt}'s layout plus the slide in progress, if
 * any. A pure function of `t`, so scrubbing backwards shows what playing forwards did (ADR
 * 0039). Null when there is no webcam or a hidden segment covers `t`.
 *
 * - A block's slide plays at its start, over {@link webcamEffectiveTransitionMs}, from the
 *   previous block's position when that block ends exactly where this one starts, otherwise
 *   from the default layout (also after a hidden segment).
 * - A block that ends into a gap returns to the default layout over its OWN transition,
 *   capped at half the gap. When the next segment starts at its end the next block's start
 *   governs instead, so there is no return.
 * - A Cut, or no transition, changes at once.
 */
export function webcamStateAt(
  scene: { webcam: WebcamScene | null },
  t: number,
): WebcamState | null {
  const webcam = scene.webcam;
  if (!webcam) return null;
  const { segments } = webcam;
  const index = segments.findIndex((s) => t >= s.start && t < s.end);
  if (index >= 0) {
    const segment = segments[index]!;
    if (segment.mode === "hidden") return null;
    const layout = webcamAt(scene, t)!;
    const transition = segment.transition;
    if (!transition || transition.kind !== "slide") return settled(layout);
    const previous = segments[index - 1];
    const touching = previous && Math.abs(previous.end - segment.start) <= ADJACENT_EPSILON;
    const fromPosition =
      touching && previous.mode === "override"
        ? segmentPosition(webcam, previous)
        : webcam.layout.position;
    const windowMs = webcamEffectiveTransitionMs(segment.end - segment.start, transition.ms);
    return slideState(layout, fromPosition, transition, windowMs, t - segment.start);
  }
  const layout = webcam.layout;
  let before = -1;
  for (let i = 0; i < segments.length && segments[i]!.end <= t; i++) before = i;
  const ended = segments[before];
  const transition = ended?.transition;
  if (!ended || ended.mode !== "override" || !transition || transition.kind !== "slide") {
    return settled(layout);
  }
  const next = segments[before + 1];
  const gap = next ? next.start - ended.end : Infinity;
  if (gap <= ADJACENT_EPSILON) return settled(layout);
  const windowMs = webcamEffectiveTransitionMs(gap, transition.ms);
  return slideState(layout, segmentPosition(webcam, ended), transition, windowMs, t - ended.end);
}

/** The override segment in force at source time `t` (null `t`: over a slide), if any. */
export function webcamOverrideAt(webcam: WebcamScene, t: number | null): WebcamSegment | null {
  if (t === null) return null;
  return webcam.segments.find((s) => s.mode === "override" && t >= s.start && t < s.end) ?? null;
}

/** The shortest segment the timeline can draw, shared with zoom segments. */
export const WEBCAM_MIN_SEGMENT_SECONDS = ZOOM_LIMITS.minSeconds;
