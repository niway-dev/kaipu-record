export { AnnotationToolbar } from "./annotation-toolbar";
export {
  AnnotationOptions,
  annotationOptionsState,
  type AnnotationOptionsState,
} from "./annotation-options";
export { AnnotationLayer } from "./annotation-layer";
export { useAnnotationTools, type AnnotationToolsController } from "./use-annotation-tools";
export { useEditorScene, type EditorScene } from "./use-editor-scene";
export {
  compositeScene,
  compositeSceneAt,
  clampRasterScale,
  cropWindow,
  exportPixelSize,
  MAX_RASTER_SIDE,
  type CompositeOptions,
  type CompositeResult,
} from "./compositor";
export type { Scene, Annotation, CropRect, ImageAnnotation, MeasureAnnotation } from "./scene";
export { nextAnnotationId, fullRect, baseFullRect, baseVisibleRect } from "./scene";
export type { BasePlacement, NormalizedRect } from "./scene";
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
  TEXT_SELECT_TOOL,
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
export type { RedactionStyle, BlurAnnotation } from "./scene";
export { reserveAnnotationIds } from "./scene";
export {
  REDACTION_MIN_BLOCK_PX,
  REDACTION_SOLID_RGB,
  redactionBlockSize,
  redactRegion,
  bakeRedactions,
  bakeCanvasRedactions,
  withoutRedactedText,
  type CanvasAssets,
  type PixelRegion,
} from "./redaction";
export {
  CANVAS_DOC_VERSION,
  BASE_ASSET_ID,
  buildCanvasDoc,
  parseCanvasDoc,
  type CanvasImageItem,
  type CanvasDocV1,
  type CanvasDocV2,
  type ParsedCanvasDoc,
} from "./canvas-doc";
