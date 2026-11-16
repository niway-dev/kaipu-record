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
