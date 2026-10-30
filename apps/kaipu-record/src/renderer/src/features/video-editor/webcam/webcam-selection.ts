/**
 * What a webcam selection means for the preview and the inspector (ADR 0033). Pure, so the
 * page's two rules are pinned by tests instead of living inline in JSX.
 */
import { WEBCAM_LAYER_SELECTION } from "../editor-selection";
import { webcamOverrideAt, type WebcamScene, type WebcamSegment } from "./webcam-model";

/**
 * Whether the preview outlines the bubble: for the layer and for an override (both are the
 * bubble's look), not for a hidden range, which has nothing on screen to outline.
 */
export function webcamOutlined(webcam: WebcamScene, selectedId: string | null): boolean {
  if (selectedId === WEBCAM_LAYER_SELECTION) return true;
  return webcam.segments.some((s) => s.id === selectedId && s.mode === "override");
}

export type WebcamInspectorTarget = { kind: "layer" } | { kind: "segment"; segment: WebcamSegment };

/**
 * What the inspector edits. A selected segment is itself. The layer is the global layout —
 * except while the playhead (`playheadSource`, null over a slide) sits inside a visible
 * override: the preview shows that override there, so the inspector edits it too, the same
 * rule a drag of the bubble follows.
 */
export function webcamInspectorTarget(
  webcam: WebcamScene,
  visibleSegments: WebcamSegment[],
  selectedId: string | null,
  playheadSource: number | null,
): WebcamInspectorTarget | null {
  if (selectedId === null) return null;
  if (selectedId !== WEBCAM_LAYER_SELECTION) {
    const segment = visibleSegments.find((s) => s.id === selectedId);
    return segment ? { kind: "segment", segment } : null;
  }
  const override = webcamOverrideAt(webcam, playheadSource);
  return override && visibleSegments.includes(override)
    ? { kind: "segment", segment: override }
    : { kind: "layer" };
}
