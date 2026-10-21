/**
 * Rendering for one video overlay (box/arrow/text) plus its resize handles — the
 * video-editor sibling of the screenshot editor's Shape/Handles (see
 * screenshots/annotations/annotation-layer.tsx). Reduced to the three kinds this
 * feature supports (no pen/blur/path). Geometry drawing (roughRect/roughArrow),
 * text metrics (HAND_FONT/TEXT_PX) and handle placement (handlesFor/handleCursor)
 * are imported from the screenshot feature — the single source for that math —
 * never re-derived here.
 */

import {
  HAND_FONT,
  STROKE_WIDTHS,
  resolveFontPx,
  handleCursor,
  handlesFor,
  roughArrow,
  roughRect,
  TEXT_LINE_HEIGHT,
  textBoxPx,
  textLines,
} from "@renderer/features/screenshots/annotations";
import type { VideoOverlay } from "../scene";
import styles from "./video-annotation-layer.module.css";

export interface Size {
  w: number;
  h: number;
}

/** Side of a resize handle in px — see HANDLE_HIT_PX in video-annotation-layer.tsx
 *  for the (larger) click tolerance around it. */
const HANDLE_PX = 10;

export function OverlayShape({
  o,
  size,
  selected,
  opacity = 1,
}: {
  o: VideoOverlay;
  size: Size;
  selected: boolean;
  /** 1 for an overlay inside its visibility window, ~0.35 for the selected one
   *  rendered outside it (see video-annotation-layer.tsx). */
  opacity?: number;
}): React.JSX.Element {
  const { w: W, h: H } = size;

  if (o.kind === "box") {
    const bw = o.w * W;
    const bh = o.h * H;
    const sw = STROKE_WIDTHS[o.stroke];
    const path = roughRect(bw, bh, 14, o.seed);
    return (
      <g transform={`translate(${o.x * W},${o.y * H})`} opacity={opacity}>
        <path d={path} fill={`${o.color}2e`} stroke="none" />
        <path
          d={path}
          fill="none"
          stroke={o.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={roughRect(bw, bh, 14, o.seed + 19)}
          fill="none"
          stroke={o.color}
          strokeWidth={sw * 0.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
        />
        {selected && (
          <rect className={styles.selOutline} x={-4} y={-4} width={bw + 8} height={bh + 8} />
        )}
      </g>
    );
  }

  if (o.kind === "arrow") {
    const x1 = o.x1 * W;
    const y1 = o.y1 * H;
    const x2 = o.x2 * W;
    const y2 = o.y2 * H;
    const sw = STROKE_WIDTHS[o.stroke];
    return (
      <g opacity={opacity}>
        <path
          d={roughArrow(x1, y1, x2, y2, o.seed)}
          fill="none"
          stroke={o.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={roughArrow(x1, y1, x2, y2, o.seed + 19)}
          fill="none"
          stroke={o.color}
          strokeWidth={sw * 0.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
        {selected && <line className={styles.selOutline} x1={x1} y1={y1} x2={x2} y2={y2} />}
      </g>
    );
  }

  // text
  const tx = o.x * W;
  const ty = o.y * H;
  const fs = resolveFontPx(o.size, o.fontPx);
  // The box governs the text: a width set by dragging a side wraps it by words.
  const wrapPx = o.width ? o.width * W : undefined;
  const box = textBoxPx(o.text, fs, wrapPx);
  return (
    <g opacity={opacity}>
      <text
        x={tx}
        y={ty}
        fill={o.color}
        fontFamily={HAND_FONT}
        fontSize={fs}
        fontWeight={600}
        dominantBaseline="hanging"
        style={{ userSelect: "none" }}
      >
        {/* One tspan per line: SVG text does not honour a newline on its own. */}
        {textLines(o.text, fs, wrapPx).map((line, i) => (
          <tspan key={i} x={tx} dy={i === 0 ? 0 : fs * TEXT_LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
      {selected && (
        // Sized by the shared helper rather than `text.length` and a copy of the
        // advance constant: a two-line label used to draw an outline twice as wide as
        // the text and only one line tall, so half of it was not selectable.
        <rect
          className={styles.selOutline}
          x={tx - 4}
          y={ty - 4}
          width={box.w + 8}
          height={box.h + 8}
        />
      )}
    </g>
  );
}

/** Resize handles for the selected overlay. Hit-testing is geometric (done in the
 *  layer's onPointerDown), so these are purely visual + carry the resize cursor. */
export function OverlayHandles({ o, size }: { o: VideoOverlay; size: Size }): React.JSX.Element {
  const { w: W, h: H } = size;
  return (
    <g>
      {handlesFor(o, size).map((h) => (
        <rect
          key={h.id}
          className={styles.handle}
          x={h.x * W - HANDLE_PX / 2}
          y={h.y * H - HANDLE_PX / 2}
          width={HANDLE_PX}
          height={HANDLE_PX}
          rx={2}
          style={{ cursor: handleCursor(h.id) }}
        />
      ))}
    </g>
  );
}
