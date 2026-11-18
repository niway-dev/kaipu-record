/**
 * Where the webcam layer sits in a frame (ADR 0038): the box the bubble occupies, in the
 * OUTPUT frame's pixels, for a layout and the camera path's scale at that instant. The
 * preview turns it into percentages of its stage; the export composer will draw it as is.
 *
 * WORKER-BUNDLE INVARIANT, like compose-frame.ts: pure and DOM-free. It reads nothing but
 * the layout's own fields, so the export worker can import it.
 */
import {
  type CameraBubbleShape,
  cameraShapeAspect,
  clampCameraCornerRadius,
  clampCameraPan,
  clampCameraZoom,
} from "@shared/camera-bubble";
import { EASING_PEAK_OVERSHOOT } from "./easing";
import { webcamRoute, webcamRoutePoint } from "./webcam-route";
import { WEBCAM_LIMITS, type WebcamLayout, type WebcamState } from "./webcam-model";

export interface WebcamRect {
  /** Left edge, in the frame's units (pixels for a pixel frame). */
  x: number;
  /** Top edge. */
  y: number;
  /** The circle and the square are as wide as tall; the rectangle 3/4 as wide (ADR 0041). */
  width: number;
  height: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

/**
 * The camera path's scale at which the bubble has fully shrunk to `scaleDuringZoom`. Below
 * it the bubble shrinks in proportion, so it eases with the camera's own spring instead of
 * snapping the moment a zoom starts (spec open question 3).
 */
export const WEBCAM_SHRINK_FULL_AT_SCALE = 1.5;

/** Bubble size up to which the zoom shrink applies in full; above it the shrink fades out. */
export const WEBCAM_SHRINK_FADE_FROM_SIZE = 0.42;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * The factor the bubble's side is multiplied by at camera scale `cameraScale`: 1 without a
 * zoom, `scaleDuringZoom` from {@link WEBCAM_SHRINK_FULL_AT_SCALE} up, linear in between.
 * The shrink fades out for large bubbles: full up to {@link WEBCAM_SHRINK_FADE_FROM_SIZE},
 * linearly gone at the maximum size, so a big bubble stays big inside a zoom.
 */
export function webcamZoomFactor(
  scaleDuringZoom: number,
  cameraScale: number,
  size: number,
): number {
  const scale = Number.isFinite(cameraScale) ? cameraScale : 1;
  const progress = clamp((scale - 1) / (WEBCAM_SHRINK_FULL_AT_SCALE - 1), 0, 1);
  const today = 1 - (1 - clamp(scaleDuringZoom, 0, 1)) * progress;
  const weight = clamp(
    (WEBCAM_LIMITS.maxSize - size) / (WEBCAM_LIMITS.maxSize - WEBCAM_SHRINK_FADE_FROM_SIZE),
    0,
    1,
  );
  return 1 - (1 - today) * weight;
}

/**
 * A centre (normalized, 0–1) moved just enough that a bubble of `box` pixels stays inside
 * the frame. A bubble wider than the frame (a tall bubble on a very narrow frame) is centred.
 */
export function clampWebcamCenter(
  center: { x: number; y: number },
  box: { width: number; height: number },
  frame: FrameSize,
): { x: number; y: number } {
  const axis = (value: number, side: number, length: number): number => {
    if (length <= 0) return 0.5;
    const half = side / 2 / length;
    return half >= 0.5 ? 0.5 : clamp(value, half, 1 - half);
  };
  return {
    x: axis(center.x, box.width, frame.width),
    y: axis(center.y, box.height, frame.height),
  };
}

/**
 * The bubble's box in `frame`, or null for an empty frame. Height = `size` × frame height ×
 * the zoom factor, width = height × the shape's aspect; never wider than the frame nor taller
 * (a 0.6 bubble on a Vertical 1080×1920 export would be 1152 px wide otherwise), the aspect
 * kept. The centre is the layout's, clamped so the whole box stays inside.
 */
export function webcamRect(
  layout: Pick<WebcamLayout, "shape" | "size" | "position" | "scaleDuringZoom">,
  frame: FrameSize,
  cameraScale = 1,
): WebcamRect | null {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  const aspect = cameraShapeAspect(layout.shape);
  const height = Math.min(
    layout.size * frame.height * webcamZoomFactor(layout.scaleDuringZoom, cameraScale, layout.size),
    frame.width / aspect,
    frame.height,
  );
  const width = height * aspect;
  const center = clampWebcamCenter(layout.position, { width, height }, frame);
  return {
    x: center.x * frame.width - width / 2,
    y: center.y * frame.height - height / 2,
    width,
    height,
  };
}

/**
 * The bubble's box for a {@link WebcamState}: {@link webcamRect} of the layout when nothing
 * moves, otherwise the centre moved along the curved route from the previous layout's clamped
 * centre to this one's ({@link webcamRoute}: the boxes are the same size, only the position
 * differs). `state.progress` is the EASED progress and `state.easing` gives the peak a Bounce
 * overshoot is fitted by. This is the ONE function the preview, its marks and the export all
 * read, so the three draw the same route. The result never leaves the frame at any progress.
 */
export function webcamStateRect(
  state: WebcamState,
  frame: FrameSize,
  cameraScale = 1,
): WebcamRect | null {
  const target = webcamRect(state.layout, frame, cameraScale);
  if (!target || !state.from) return target;
  const origin = webcamRect(state.from, frame, cameraScale);
  if (!origin) return target;
  const { width, height } = target;
  const end = { x: target.x + width / 2, y: target.y + height / 2 };
  const start = { x: origin.x + width / 2, y: origin.y + height / 2 };
  // The range the bubble's centre can reach: the frame minus half the box on each side.
  const reach = {
    minX: width / 2,
    maxX: frame.width - width / 2,
    minY: height / 2,
    maxY: frame.height - height / 2,
  };
  const route = webcamRoute(start, end, frame, reach);
  const center = webcamRoutePoint(
    route,
    state.progress,
    EASING_PEAK_OVERSHOOT[state.easing],
    reach,
  );
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
  };
}

/**
 * CSS `clip-path` for the bubble's shape, relative to its own box. The corner is a share of
 * the shorter side; in `inset(… round h% / v%)` the horizontal radius is a percentage of the
 * width and the vertical one of the height, so each is scaled by its axis to stay circular.
 */
export function webcamClipPath(shape: CameraBubbleShape, cornerRadius: number): string {
  if (shape === "circle") return "circle(50% at 50% 50%)";
  const aspect = cameraShapeAspect(shape);
  const radius = clampCameraCornerRadius(cornerRadius);
  // Shorter side = width when aspect ≤ 1: r = radius·width → h = radius, v = radius·aspect.
  const h = aspect <= 1 ? radius : radius / aspect;
  const v = aspect <= 1 ? radius * aspect : radius;
  const pct = (value: number): string => `${Math.round(value * 10000) / 100}%`;
  return `inset(0 round ${pct(h)} / ${pct(v)})`;
}

/**
 * The part of the webcam image the bubble shows, in the image's own pixels: the centred
 * window `object-fit: cover` puts in a box of `aspect` (width / height), narrowed and panned
 * by the framing. The export draws exactly this window into the bubble's box; the preview gets the same
 * window from CSS (`object-fit: cover` plus `framingTransform`), so the two agree.
 *
 * Derivation from `framingTransform`: the view is the element scaled by `zoom` about its
 * centre and translated by `−pan · (zoom − 1) / (2·zoom)` of its own width (x) or height (y),
 * so it shows a window of `1/zoom` of the cover window whose centre sits
 * `pan · (zoom − 1) / (2·zoom)` of that window from the middle, toward the pan. The mirror flips the image before that, so in the raw
 * (unmirrored) image a mirrored bubble's window moves the other way on x; the caller then
 * draws the window flipped. Zoom and pan are clamped exactly as `framingTransform` does.
 */
export function webcamSourceRect(
  image: FrameSize,
  framing: { zoom: number; x: number; y: number },
  mirrored: boolean,
  aspect = 1,
): { sx: number; sy: number; sw: number; sh: number } {
  // The preview's own clamps (`framingTransform`): the 3× cap, the zoom step and the pan's
  // two decimals, so a hand-edited session never frames the export differently.
  const zoom = clampCameraZoom(Number.isFinite(framing.zoom) ? framing.zoom : 1);
  const pan = (value: number): number => clampCameraPan(Number.isFinite(value) ? value : 0);
  // The cover window: the largest box of `aspect` the image holds, centred.
  const coverW = Math.min(image.width, image.height * aspect);
  const coverH = coverW / aspect;
  const reach = (zoom - 1) / (2 * zoom);
  const cx = image.width / 2 + (mirrored ? -1 : 1) * pan(framing.x) * reach * coverW;
  const cy = image.height / 2 + pan(framing.y) * reach * coverH;
  const sw = coverW / zoom;
  const sh = coverH / zoom;
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}

/**
 * The bubble's drop shadow as a share of its height, matching the preview's
 * `drop-shadow(0 2px 8px rgba(0, 0, 0, 0.35))` on a bubble of about 90 CSS px (a 0.22 bubble
 * on a ~400 px tall stage). Relative, so a 4K export does not get a hairline shadow.
 */
export const WEBCAM_SHADOW = { blur: 0.09, offsetY: 0.022, color: "rgba(0, 0, 0, 0.35)" } as const;
