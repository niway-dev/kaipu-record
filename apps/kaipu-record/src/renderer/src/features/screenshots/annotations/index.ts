export { AnnotationToolbar } from "./annotation-toolbar";
export { AnnotationOptions } from "./annotation-options";
export { AnnotationLayer } from "./annotation-layer";
export { useAnnotationTools, type AnnotationToolsController } from "./use-annotation-tools";
export { useEditorScene, type EditorScene } from "./use-editor-scene";
export {
  compositeScene,
  compositeSceneAt,
  clampRasterScale,
  MAX_RASTER_SIDE,
  type CompositeOptions,
  type CompositeResult,
} from "./compositor";
export type { Scene, Annotation, CropRect, MeasureAnnotation } from "./scene";
export { nextAnnotationId } from "./scene";
export { measureLabel, measureLength } from "./measure";
export {
  annotationBounds,
  contentExtents,
  extentsToDisplay,
  hasExtents,
  canvasLayout,
  frameToWorld,
  worldToFrame,
  intersectFrame,
  defaultTextMeasure,
  ZERO_EXTENTS,
  type Bounds,
  type Extents,
  type TextMeasure,
  type CanvasGeom,
  type CanvasLayout,
} from "./canvas-geometry";
export {
  ANNOTATION_COLORS,
  STROKE_WIDTHS,
  TEXT_SIZES,
  TEXT_PX,
  HAND_FONT,
  // Text geometry, shared with the video editor's overlays so a label breaks, measures
  // and exports the same way in both editors.
  TEXT_LINE_HEIGHT,
  textLines,
  textBoxPx,
  resolveFontPx,
  clampFontPx,
  type AnnotationTool,
  type AnnotationColor,
} from "./tools";
export { roughRect, roughArrow } from "./rough";
export {
  annotationBox,
  handlesFor,
  hitHandle,
  resizeAnnotation,
  handleCursor,
  type HandleId,
} from "./handles";
