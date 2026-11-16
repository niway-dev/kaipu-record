/**
 * Pure scene edits for the webcam layer (ADR 0038). Each returns the SAME scene object when
 * the edit changes nothing: `commit` and `endInteract` no-op on reference equality, so a
 * no-op never pushes an undo step, never marks the editor dirty and never wakes the autosave.
 * A recording without a webcam has no layer to edit, so every edit passes the scene through.
 */
import { newId, type VideoScene } from "../scene";
import { dragRangeEdge, freeWindowAt } from "../source-time";
import {
  WEBCAM_MIN_SEGMENT_SECONDS,
  WEBCAM_TRANSITION_DEFAULTS,
  clampWebcamPatch,
  clampWebcamTransition,
  webcamAt,
  type WebcamLayout,
  type WebcamScene,
  type WebcamSegment,
  type WebcamTransition,
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
    /** `override` only. Absent is a Cut. */
    transition?: Partial<WebcamTransition>;
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
  if (input.mode === "override" && input.transition) {
    segment.transition = clampWebcamTransition(input.transition);
  }
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

/**
 * "Change camera from here" outside every block: a block from the playhead to the next block
 * or the end of the recording, holding the position the bubble has there. The position is
 * stored explicitly, so a later change of the default position does not move the block, and
 * the transition starts as the default slide. Refused (the scene back, `id: null`) inside a
 * block or with less than the minimum length before the next block or the end.
 */
export function createWebcamBlock(
  scene: VideoScene,
  at: number,
  sourceDurationSeconds: number,
): { scene: VideoScene; id: string | null } {
  const webcam = scene.webcam;
  if (!webcam) return { scene, id: null };
  const window = freeWindowAt(
    webcam.segments,
    at,
    Number.POSITIVE_INFINITY,
    sourceDurationSeconds,
    WEBCAM_MIN_SEGMENT_SECONDS,
  );
  if (!window) return { scene, id: null };
  const { position } = webcamAt(scene, at) ?? webcam.layout;
  return addWebcamSegment(
    scene,
    {
      ...window,
      mode: "override",
      layout: { position: { ...position } },
      transition: WEBCAM_TRANSITION_DEFAULTS,
    },
    sourceDurationSeconds,
  );
}

/**
 * "Change camera from here" inside a block: the block ends at the playhead and a new block
 * runs from there to the old end. The new block starts with the same position and fields
 * (its own copy, so editing one never edits the other) and the default transition; the
 * left part keeps the id and the transition. Refused when either part would be shorter than
 * the minimum, so blocks keep never overlapping and never vanish on reload.
 */
export function splitWebcamBlock(
  scene: VideoScene,
  at: number,
): { scene: VideoScene; id: string | null } {
  const webcam = scene.webcam;
  const block = webcam?.segments.find((s) => s.mode === "override" && at > s.start && at < s.end);
  if (
    !webcam ||
    !block ||
    at - block.start < WEBCAM_MIN_SEGMENT_SECONDS ||
    block.end - at < WEBCAM_MIN_SEGMENT_SECONDS
  ) {
    return { scene, id: null };
  }
  const copy = block.layout
    ? (JSON.parse(JSON.stringify(block.layout)) as typeof block.layout)
    : {};
  const position = block.layout?.position ?? webcam.layout.position;
  const right: WebcamSegment = {
    id: newId(),
    start: at,
    end: block.end,
    mode: "override",
    layout: { ...copy, position: { ...position } },
    transition: { ...WEBCAM_TRANSITION_DEFAULTS },
  };
  return {
    scene: withWebcam(scene, {
      ...webcam,
      segments: webcam.segments.flatMap((s) =>
        s.id === block.id ? [{ ...s, end: at }, right] : [s],
      ),
    }),
    id: right.id,
  };
}

export type ChangeWebcamResult =
  | { ok: true; kind: "create" | "split"; id: string; scene: VideoScene }
  | { ok: false; reason: "hidden" | "no-room"; id: null; scene: VideoScene };

/**
 * What "Change camera from here" does at source time `at`: split the block under the
 * playhead, or create one outside every block. A hidden range has no camera to move, so it is
 * refused with its own reason; every other refusal is "no-room".
 */
export function changeWebcamFrom(
  scene: VideoScene,
  at: number,
  sourceDurationSeconds: number,
): ChangeWebcamResult {
  const webcam = scene.webcam;
  if (!webcam) return { ok: false, reason: "no-room", id: null, scene };
  const inside = webcam.segments.find((s) => at >= s.start && at < s.end);
  if (inside?.mode === "hidden") return { ok: false, reason: "hidden", id: null, scene };
  const result = inside
    ? splitWebcamBlock(scene, at)
    : createWebcamBlock(scene, at, sourceDurationSeconds);
  return result.id
    ? { ok: true, kind: inside ? "split" : "create", id: result.id, scene: result.scene }
    : { ok: false, reason: "no-room", id: null, scene };
}

/**
 * Change a block's transition: kind, duration or easing, over what it has now (a block with
 * none is a Cut with the default duration and easing, so switching it to Slide gives the
 * defaults). The duration is clamped to its limits. Duration and easing stay stored while the
 * block is a Cut, so switching back restores them. Hidden blocks have no transition.
 */
export function setWebcamTransition(
  scene: VideoScene,
  id: string,
  patch: Partial<WebcamTransition>,
): VideoScene {
  const webcam = scene.webcam;
  const block = webcam?.segments.find((s) => s.id === id);
  if (!webcam || !block || block.mode !== "override") return scene;
  const current = block.transition ?? { ...WEBCAM_TRANSITION_DEFAULTS, kind: "cut" as const };
  const next = clampWebcamTransition({ ...current, ...patch });
  if (sameValue(next, current)) return scene;
  return withWebcam(scene, {
    ...webcam,
    segments: webcam.segments.map((s) => (s.id === id ? { ...s, transition: next } : s)),
  });
}
