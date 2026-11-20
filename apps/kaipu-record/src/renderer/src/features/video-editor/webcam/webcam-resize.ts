/**
 * The math behind dragging a corner of the camera bubble in the preview (NIW2-888): pure, so the
 * layer only turns pointer events into these calls. Everything is in OUTPUT-FRAME units (the
 * decoded frame's pixels; only the ratios matter), converted from client pixels by the layer.
 *
 * The bubble's own size is `layout.size` (its height as a share of the frame), but what is
 * drawn is that times the camera path's zoom factor ({@link webcamZoomFactor}) and limited by the
 * frame ({@link webcamRect}). A drag moves the DRAWN corner, so the pointer's change is turned
 * back into the layout's own size by dividing the zoom factor out, or the bubble would jump the
 * moment a drag starts inside a zoom with "shrink during zoom" on.
 */
import { cameraShapeAspect } from "@shared/camera-bubble";
import type { Corner } from "../media-box-drag";
import {
  clampWebcamCenter,
  type FrameSize,
  type WebcamRect,
  webcamRect,
  webcamZoomFactor,
} from "./webcam-layout";
import {
  WEBCAM_LIMITS,
  webcamOverrideAt,
  webcamSizePreset,
  type WebcamLayout,
  type WebcamScene,
} from "./webcam-model";

/** The Camera panel's two tabs: the part at the playhead, or the look every stretch shares. */
export type WebcamPanelTab = "part" | "whole";

/** What a drag starts from: the layout in force and the box drawn when the press landed. */
export interface WebcamResizeStart {
  layout: Pick<WebcamLayout, "shape" | "size" | "scaleDuringZoom">;
  /** The box as drawn at the press (slide and frame limits included), in frame units. */
  rect: WebcamRect;
  /** The camera path's scale at that moment: the zoom factor's input. */
  cameraScale: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampSize = (size: number): number =>
  clamp(size, WEBCAM_LIMITS.minSize, WEBCAM_LIMITS.maxSize);

/** The slider's own step, so a dragged size reads the same on the slider and can equal a preset. */
const roundSize = (size: number): number => Math.round(size * 100) / 100;

/**
 * Resize from a corner with the aspect locked (circle and square 1:1, rectangle 3/4). The pointer
 * moved `deltaX`, `deltaY` frame units since the press; whichever axis it moved further along
 * (compared in height terms) decides, with its sign, so an inward move on one axis shrinks the
 * bubble while the other stays put.
 *
 * `anchor: "opposite"` (the default) keeps the opposite corner of the DRAWN box where it is and
 * returns the centre that gives, pulled back inside the frame. `"center"` keeps the centre and
 * grows every side, for a drag whose position cannot be written (the caller says so).
 *
 * Returns the layout's `size` (limited by {@link WEBCAM_LIMITS}, at the slider's 1% step) and the
 * normalized centre to write with it.
 */
export function resizeWebcamFromCorner({
  start,
  corner,
  deltaX,
  deltaY,
  frame,
  anchor = "opposite",
}: {
  start: WebcamResizeStart;
  corner: Corner;
  deltaX: number;
  deltaY: number;
  frame: FrameSize;
  anchor?: "opposite" | "center";
}): { size: number; position: { x: number; y: number } } {
  const { layout, rect, cameraScale } = start;
  const aspect = cameraShapeAspect(layout.shape);
  const east = corner === "ne" || corner === "se";
  const south = corner === "sw" || corner === "se";
  // Around the centre both sides move, so the same pointer travel is twice the change.
  const spread = anchor === "center" ? 2 : 1;
  const outX = ((east ? 1 : -1) * deltaX * spread) / aspect;
  const outY = (south ? 1 : -1) * deltaY * spread;
  const change = Math.abs(outX) >= Math.abs(outY) ? outX : outY;
  const zoomAt = (size: number): number =>
    webcamZoomFactor(layout.scaleDuringZoom, cameraScale, size);
  // From the height the layout asks for, not the drawn one: a frame that limited the box (a tall
  // bubble on a narrow frame) must not make the first move shrink the layout's own size.
  const startHeight = layout.size * frame.height * zoomAt(layout.size);
  const wanted = Math.max(1, startHeight + change);
  // The zoom factor itself depends on the size (the shrink fades out for large bubbles), so
  // settle on the size whose drawn height is `wanted`: a few rounds are plenty.
  let size = clampSize(wanted / (frame.height * zoomAt(layout.size)));
  for (let i = 0; i < 4; i++) size = clampSize(wanted / (frame.height * zoomAt(size)));
  size = roundSize(clampSize(size));

  const box = webcamRect(
    {
      shape: layout.shape,
      size,
      scaleDuringZoom: layout.scaleDuringZoom,
      position: { x: 0.5, y: 0.5 },
    },
    frame,
    cameraScale,
  );
  if (!box) return { size, position: { x: 0.5, y: 0.5 } };
  const centre =
    anchor === "center"
      ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      : {
          // The corner that stays put: the box grows or shrinks away from it.
          x: (east ? rect.x : rect.x + rect.width) + (east ? 1 : -1) * (box.width / 2),
          y: (south ? rect.y : rect.y + rect.height) + (south ? 1 : -1) * (box.height / 2),
        };
  const position = clampWebcamCenter(
    { x: centre.x / frame.width, y: centre.y / frame.height },
    box,
    frame,
  );
  return { size, position };
}

/**
 * "28% · L": the size as the sliders write it, plus the preset letter when it is exactly one.
 * Digits and a letter only, so it needs no translation.
 */
export function webcamSizeLabel(size: number): string {
  const percent = `${Math.round(size * 100)}%`;
  const preset = webcamSizePreset(size);
  return preset ? `${percent} · ${preset}` : percent;
}

/**
 * Where a corner drag writes, from the Camera panel's tab. "This part" edits the part at the
 * playhead (or the whole video's layout where none is in force, which is what the bubble shows
 * there); "Whole video" edits the whole video's layout.
 *
 * With "Whole video" open while a part at the playhead has a position of its own, the bubble is
 * drawn at that position and a new whole-video position would change nothing on screen, so the
 * drag grows around the centre instead of anchoring a corner it could not hold.
 */
export function webcamResizeTarget(
  webcam: WebcamScene,
  tab: WebcamPanelTab,
  sourceTime: number | null,
): { whole: boolean; anchor: "opposite" | "center" } {
  if (tab === "part") return { whole: false, anchor: "opposite" };
  const covered = webcamOverrideAt(webcam, sourceTime)?.layout?.position !== undefined;
  return { whole: true, anchor: covered ? "center" : "opposite" };
}
