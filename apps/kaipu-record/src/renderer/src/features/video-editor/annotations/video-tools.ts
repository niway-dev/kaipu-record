/**
 * Video annotation tool state — the toolbar's current tool + drawing options
 * (color/stroke/text size). Mirrors the screenshot editor's use-annotation-tools.ts
 * (same defaults, same state shape) reduced to the tools this feature supports: no
 * pen/blur/crop, only the time-ranged box/arrow/text overlays (see scene.ts).
 *
 * Color/stroke/text-size VALUES are imported from the screenshot feature (the single
 * source of truth for the drawing palette) rather than redefined here.
 */

import { useState } from "react";
import { ANNOTATION_COLORS } from "@renderer/features/screenshots/annotations";

export const VIDEO_TOOLS = ["select", "box", "arrow", "text"] as const;
export type VideoTool = (typeof VIDEO_TOOLS)[number];

/**
 * Default visibility-window length (seconds) for a freshly drawn overlay — long
 * enough to read a label/box without scrubbing, short enough not to blanket the
 * whole timeline by default.
 */
export const DEFAULT_OVERLAY_SECONDS = 3;

export interface VideoToolState {
  tool: VideoTool;
  /** Selected drawing colour (hex) — see ANNOTATION_COLORS. */
  color: string;
  /** Stroke level — an index into STROKE_WIDTHS (0–2). */
  stroke: number;
  /** Text-size level — an index into TEXT_SIZES/TEXT_PX (0–3). */
  textSize: number;
}

export interface VideoToolsController extends VideoToolState {
  setTool(tool: VideoTool): void;
  setColor(color: string): void;
  setStroke(level: number): void;
  setTextSize(level: number): void;
}

/** Toolbar state for the video-editor annotation tools. */
export function useVideoTools(): VideoToolsController {
  const [tool, setTool] = useState<VideoTool>("select");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value);
  const [stroke, setStroke] = useState<number>(1);
  const [textSize, setTextSize] = useState<number>(1);

  return { tool, setTool, color, setColor, stroke, setStroke, textSize, setTextSize };
}
