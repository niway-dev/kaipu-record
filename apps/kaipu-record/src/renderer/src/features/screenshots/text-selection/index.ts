export {
  assetRectToWorld,
  blockRedactionRect,
  pixelRectToNorm,
  nearestBlock,
  nearestWord,
  textBlocks,
  redactionRectsInPixels,
  selectableWords,
  wordBoxNorm,
  wordRange,
  type NormPoint,
  type PixelRect,
  type PixelSize,
  type TextBlock,
} from "./geometry";
export { distinctLineCount, lineBoxesNorm, type LineBox } from "./lines";
export { useRecognizedText, type RecognizedText } from "./use-recognized-text";
export {
  useTextSelection,
  useTextSelectionKeys,
  type TextLayerModel,
  type TextToolStatus,
  type TextSelection,
} from "./use-text-selection";
export { TextNotice, TextShimmer, useTextNoticeState } from "./text-notice";
