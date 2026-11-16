/**
 * The name of a camera place ("Bottom left", "Center"), for the Camera lane's blocks and, later,
 * the panel (camera parts, drag-first). A DESCRIPTION computed from where the bubble's centre
 * is, never a choice: the range the centre can reach (the frame minus half the bubble on each
 * side) is cut into thirds on each axis, and the third the centre falls in names the place.
 *
 * Pure and import-light: the id is a plain union and the components turn it into the
 * translated string, so the editor's language never reaches this file.
 */
import type { FrameSize } from "./webcam-layout";

export type WebcamPositionName =
  | "topLeft"
  | "topMiddle"
  | "topRight"
  | "middleLeft"
  | "center"
  | "middleRight"
  | "bottomLeft"
  | "bottomMiddle"
  | "bottomRight";

type Third = 0 | 1 | 2;

/**
 * Which third of `[min, max]` the value is in. Exactly on a boundary counts as the middle, as
 * the owner's mock does. A range with no width (a bubble as big as the frame) has only a middle.
 */
function thirdOf(value: number, min: number, max: number): Third {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(value)) return 1;
  const share = (value - min) / span;
  if (share < 1 / 3 - 1e-9) return 0;
  if (share > 2 / 3 + 1e-9) return 2;
  return 1;
}

/** Row (top, middle, bottom) by column (left, middle, right). */
const NAMES: readonly (readonly WebcamPositionName[])[] = [
  ["topLeft", "topMiddle", "topRight"],
  ["middleLeft", "center", "middleRight"],
  ["bottomLeft", "bottomMiddle", "bottomRight"],
];

/**
 * The name of the place whose bubble centre is `position` (normalized, 0–1 over the frame)
 * for a bubble of `box` pixels in `frame`. The reach is the frame minus half the box on each
 * side, so a big bubble has a short range and a small one almost the whole frame.
 */
export function webcamPositionName(
  position: { x: number; y: number },
  frame: FrameSize,
  box: { width: number; height: number },
): WebcamPositionName {
  const column = thirdOf(position.x * frame.width, box.width / 2, frame.width - box.width / 2);
  const row = thirdOf(position.y * frame.height, box.height / 2, frame.height - box.height / 2);
  return NAMES[row]![column]!;
}
