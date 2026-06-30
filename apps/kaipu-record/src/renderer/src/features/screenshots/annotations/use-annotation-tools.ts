import { useState } from "react";
import { ANNOTATION_COLORS, type AnnotationTool } from "./tools";

export interface AnnotationToolsController {
  tool: AnnotationTool;
  setTool(tool: AnnotationTool): void;
  /** Selected drawing colour (hex). */
  color: string;
  setColor(color: string): void;
  /** Stroke level — an index into STROKE_WIDTHS (0–2). */
  stroke: number;
  setStroke(level: number): void;
  /** Text-size level — an index into TEXT_SIZES (0–2). */
  textSize: number;
  setTextSize(level: number): void;
}

/** Toolbar state for the annotation tools. (Drawing the shapes is a later slice.) */
export function useAnnotationTools(): AnnotationToolsController {
  const [tool, setTool] = useState<AnnotationTool>("select");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0].value);
  const [stroke, setStroke] = useState<number>(1);
  const [textSize, setTextSize] = useState<number>(1);

  return { tool, setTool, color, setColor, stroke, setStroke, textSize, setTextSize };
}
