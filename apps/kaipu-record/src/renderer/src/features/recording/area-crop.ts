/**
 * How a recording area is encoded (ADR 0030): which physical pixels of the captured display
 * track to draw, and at what size. Pure, so the DPI arithmetic is tested without a canvas.
 */
import { cropForSize, type Rectangle, type Size } from "@shared/capture-geometry";
import { fitToCap } from "@shared/recording-quality";
import type { RecordingArea } from "@shared/types/ipc";

export interface AreaEncodePlan {
  /** Physical pixels of the track to draw. */
  source: Rectangle;
  /** The encoded frame: the source's aspect, capped in height, never upscaled, even. */
  target: Size;
}

/**
 * The scale comes from the track the capture actually delivered (`trackSize` over the
 * display's DIP size), so a track narrower than native still crops the right region.
 */
export function areaEncodePlan(
  trackSize: Size,
  area: RecordingArea,
  capHeight: number,
): AreaEncodePlan {
  const source = cropForSize(trackSize, area.displaySize, area.rect);
  return { source, target: fitToCap(source.width, source.height, capHeight) };
}
