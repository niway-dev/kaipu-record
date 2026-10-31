/**
 * Pure scene edits for the webcam layer (ADR 0038). Each returns the SAME scene object when
 * the edit changes nothing: `commit` and `endInteract` no-op on reference equality, so a
 * no-op never pushes an undo step, never marks the editor dirty and never wakes the autosave.
 * A recording without a webcam has no layer to edit, so every edit passes the scene through.
 */
import { newId, type VideoScene } from "../scene";
import { dragRangeEdge } from "../source-time";
import {
  WEBCAM_MIN_SEGMENT_SECONDS,
  clampWebcamPatch,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
} from "./webcam-model";

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when `patch` would not change `layout` (every given field already holds that value). */
function changesNothing(layout: Partial<WebcamLayout>, patch: Partial<WebcamLayout>): boolean {
  return (Object.keys(patch) as Array<keyof WebcamLayout>).every((key) =>
    sameValue(layout[key], patch[key]),
  );
}

const withWebcam = (scene: VideoScene, webcam: WebcamScene): VideoScene => ({ ...scene, webcam });

/** Change fields of the global layout (the inspector's controls, dragging the bubble). */
export function setWebcamLayout(scene: VideoScene, patch: Partial<WebcamLayout>): VideoScene {
  if (!scene.webcam) return scene;
  const clamped = clampWebcamPatch(patch);
  if (changesNothing(scene.webcam.layout, clamped)) return scene;
  return withWebcam(scene, {
    ...scene.webcam,
    layout: { ...scene.webcam.layout, ...clamped },
  });
}

/**
 * Add a segment over source seconds [start, end). Refused (the scene back, `id: null`) when
 * there is no webcam, the window is under the minimum length, leaves [0, duration] or overlaps
 * a segment: the caller finds a free window with `freeWindowAt`. A `hidden` segment keeps no
 * layout.
 */
export function addWebcamSegment(
  scene: VideoScene,
  input: {
    start: number;
    end: number;
    mode: WebcamSegment["mode"];
    layout?: Partial<WebcamLayout>;
  },
  sourceDurationSeconds: number,
): { scene: VideoScene; id: string | null } {
  const webcam = scene.webcam;
  const { start, end } = input;
  const valid =
    webcam !== null &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end <= sourceDurationSeconds &&
    end - start >= WEBCAM_MIN_SEGMENT_SECONDS &&
    !webcam.segments.some((s) => start < s.end && end > s.start);
  if (!valid) return { scene, id: null };
  const segment: WebcamSegment = { id: newId(), start, end, mode: input.mode };
  if (input.mode === "override" && input.layout) segment.layout = clampWebcamPatch(input.layout);
  return {
    scene: withWebcam(scene, {
      ...webcam,
      segments: [...webcam.segments, segment].sort((a, b) => a.start - b.start),
    }),
    id: segment.id,
  };
}

/**
 * Change a segment's mode, or merge layout fields into an override. Times are not patchable
 * here: they have to respect the neighbours and the minimum, which only
 * {@link dragWebcamSegmentEdge} knows how to enforce. Becoming `hidden` drops the layout.
 */
export function updateWebcamSegment(
  scene: VideoScene,
  id: string,
  patch: { mode?: WebcamSegment["mode"]; layout?: Partial<WebcamLayout> },
): VideoScene {
  const webcam = scene.webcam;
  const segment = webcam?.segments.find((s) => s.id === id);
  if (!webcam || !segment) return scene;
  const mode = patch.mode ?? segment.mode;
  let next: WebcamSegment;
  if (mode === "hidden") {
    if (segment.mode === "hidden") return scene;
    next = { id, start: segment.start, end: segment.end, mode: "hidden" };
  } else {
    const clamped = patch.layout ? clampWebcamPatch(patch.layout) : {};
    if (segment.mode === "override" && changesNothing(segment.layout ?? {}, clamped)) return scene;
    next = { ...segment, mode: "override", layout: { ...segment.layout, ...clamped } };
  }
  return withWebcam(scene, {
    ...webcam,
    segments: webcam.segments.map((s) => (s.id === id ? next : s)),
  });
}

/**
 * Timeline edge drag. The same rule as zooms (`dragRangeEdge`): stay inside
 * [0, sourceDuration], keep the minimum length, never cross a neighbouring segment.
 */
export function dragWebcamSegmentEdge(
  scene: VideoScene,
  id: string,
  edge: "start" | "end",
  to: number,
  sourceDurationSeconds: number,
): VideoScene {
  const webcam = scene.webcam;
  if (!webcam?.segments.some((s) => s.id === id)) return scene;
  const { start, end } = dragRangeEdge(
    webcam.segments,
    id,
    edge,
    to,
    sourceDurationSeconds,
    WEBCAM_MIN_SEGMENT_SECONDS,
  );
  const current = webcam.segments.find((s) => s.id === id)!;
  if (start === current.start && end === current.end) return scene;
  return withWebcam(scene, {
    ...webcam,
    segments: webcam.segments.map((s) => (s.id === id ? { ...s, start, end } : s)),
  });
}

export function removeWebcamSegment(scene: VideoScene, id: string): VideoScene {
  const webcam = scene.webcam;
  if (!webcam?.segments.some((s) => s.id === id)) return scene;
  return withWebcam(scene, { ...webcam, segments: webcam.segments.filter((s) => s.id !== id) });
}
