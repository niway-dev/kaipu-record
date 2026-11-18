import type { WebcamEasing } from "../webcam/webcam-model";
import type { WebcamPositionName } from "../webcam/webcam-names";

/** The message key of each place's name, shared by the Camera lane and the Camera panel. */
export const NAME_LABEL = {
  topLeft: "webcamNameTopLeft",
  topMiddle: "webcamNameTopMiddle",
  topRight: "webcamNameTopRight",
  middleLeft: "webcamNameMiddleLeft",
  center: "webcamNameCenter",
  middleRight: "webcamNameMiddleRight",
  bottomLeft: "webcamNameBottomLeft",
  bottomMiddle: "webcamNameBottomMiddle",
  bottomRight: "webcamNameBottomRight",
} as const satisfies Record<WebcamPositionName, string>;

/** The message key of each motion's name, shared by the Camera lane's hover card. */
export const EASING_LABEL = {
  "ease-in-out": "webcamEasingEaseInOut",
  linear: "webcamEasingLinear",
  "ease-out": "webcamEasingEaseOut",
  back: "webcamEasingBack",
} as const satisfies Record<WebcamEasing, string>;
