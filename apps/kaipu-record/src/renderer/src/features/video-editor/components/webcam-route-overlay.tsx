/**
 * The route the camera bubble slides along, drawn over the preview: a dotted curve with an
 * arrowhead, a tag at its start and a chip at its middle, plus an optional faded ghost bubble
 * where it starts. The drop card draws it from "Now" to the dropped place and the paused
 * preview's marks draw it from where a part's camera comes from, so both share this file.
 *
 * The curve is `webcamRoute`'s, in frame pixels; the caller measures the preview in CSS px
 * (`size`) and this scales between the two. It draws nothing when the bubble would hardly
 * move. EDITOR ONLY: the export never imports it.
 */
import type { CSSProperties } from "react";
import type { WebcamRoute } from "../webcam/webcam-route";
import type { FrameSize } from "../webcam/webcam-layout";
import styles from "./webcam-route-overlay.module.css";

/** A route shorter than this (px on screen) draws nothing: the bubble would not move. */
export const MIN_ROUTE_PX = 10;

export interface RouteGhost {
  /** The bubble's box, in frame pixels. */
  box: { width: number; height: number };
  /** CSS `clip-path` of the bubble's shape. */
  clipPath: string;
}

export function WebcamRouteOverlay({
  route,
  frame,
  size,
  boxHeight,
  fromTag,
  chip,
  ghost,
  testId,
}: {
  route: WebcamRoute;
  frame: FrameSize;
  /** The preview in CSS px, as measured by the caller. */
  size: { w: number; h: number };
  /** The bubble's height in frame pixels: the arrowhead stops short of the bubble. */
  boxHeight: number;
  /** The tag at the route's start ("Now", "Original", "Before"). */
  fromTag: string;
  chip: React.ReactNode;
  ghost?: RouteGhost;
  /** Prefix of the test ids: `<id>-arrow`, `<id>-from`, `<id>-chip`, `<id>-ghost`. */
  testId: string;
}): React.JSX.Element | null {
  const scale = frame.width > 0 ? size.w / frame.width : 0;
  if (!(scale > 0) || size.h <= 0) return null;
  const start = { x: route.start.x * scale, y: route.start.y * scale };
  const control = { x: route.control.x * scale, y: route.control.y * scale };
  const target = { x: route.end.x * scale, y: route.end.y * scale };
  if (Math.hypot(target.x - start.x, target.y - start.y) < MIN_ROUTE_PX) return null;
  const radius = (boxHeight / 2) * scale;
  const middle = {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * target.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * target.y,
  };
  const angle = Math.atan2(target.y - control.y, target.x - control.x);
  // The arrowhead stops short of the new bubble, which would cover it.
  const tip = {
    x: target.x - Math.cos(angle) * (radius + 8),
    y: target.y - Math.sin(angle) * (radius + 8),
  };
  const curve = `M${start.x} ${start.y} Q ${control.x} ${control.y} ${target.x} ${target.y}`;
  const ghostStyle: CSSProperties | null = ghost
    ? {
        left: start.x - (ghost.box.width * scale) / 2,
        top: start.y - (ghost.box.height * scale) / 2,
        width: ghost.box.width * scale,
        height: ghost.box.height * scale,
      }
    : null;
  return (
    <>
      {ghostStyle && (
        <span className={styles.ghost} style={ghostStyle} data-testid={`${testId}-ghost`}>
          <span className={styles.ghostFace} style={{ clipPath: ghost?.clipPath }} />
        </span>
      )}
      <svg className={styles.route} width={size.w} height={size.h} aria-hidden="true">
        <path className={styles.routeShadow} d={curve} />
        <path className={styles.routeLine} d={curve} />
        <path
          className={`${styles.routeLine} ${styles.arrow}`}
          d="M-9 -6 L0 0 L-9 6"
          transform={`translate(${tip.x} ${tip.y}) rotate(${(angle * 180) / Math.PI})`}
          data-testid={`${testId}-arrow`}
        />
      </svg>
      <span
        className={styles.tag}
        style={{
          left: start.x,
          top: start.y > size.h / 2 ? start.y - radius - 26 : start.y + radius + 6,
        }}
        data-testid={`${testId}-from`}
      >
        {fromTag}
      </span>
      <span
        className={styles.chip}
        style={{ left: middle.x, top: middle.y - 13 }}
        data-testid={`${testId}-chip`}
      >
        {chip}
      </span>
    </>
  );
}
