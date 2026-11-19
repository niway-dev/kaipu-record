import { BASE_IMAGE_ID, cropTarget, imageCropPatch, type BaseFields } from "./image-crop";
import type { Annotation, CropRect, ImageAnnotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";

/**
 * What the image actions (Crop, Corners, Reset; NIW2-876) show for the selected image, base or
 * added. Pure, no React: the floating bar and the Tool tab read the same answer.
 */
export interface ImageActionState {
  id: string;
  /** The image has a crop to remove. */
  hasCrop: boolean;
  /** Its own corner radius in source px; absent = it follows the Beautify slider. */
  radius?: number;
  /** The largest useful radius in source px: half the shorter VISIBLE side. */
  maxRadius: number;
}

function maxRadiusOf(pixelW: number, pixelH: number, crop: CropRect | undefined): number {
  const w = crop ? crop.w * pixelW : pixelW;
  const h = crop ? crop.h * pixelH : pixelH;
  return Math.max(0, Math.floor(Math.min(w, h) / 2));
}

/**
 * The actions' state for `selectedId`, or null when it is not an image. The base needs the
 * asset's size (`natural`): without it the base is not selectable either.
 */
export function imageActionState(
  selectedId: string | null,
  annotations: readonly Annotation[],
  base: BaseFields,
  natural: { w: number; h: number } | undefined,
): ImageActionState | null {
  if (selectedId === null) return null;
  if (selectedId === BASE_IMAGE_ID) {
    if (!natural || natural.w <= 0 || natural.h <= 0) return null;
    return {
      id: BASE_IMAGE_ID,
      hasCrop: base.baseCrop !== undefined,
      ...(base.baseRadius !== undefined ? { radius: base.baseRadius } : {}),
      maxRadius: maxRadiusOf(natural.w, natural.h, base.baseCrop),
    };
  }
  const a = annotations.find(
    (x): x is ImageAnnotation => x.id === selectedId && x.kind === "image",
  );
  if (!a) return null;
  return {
    id: a.id,
    hasCrop: a.crop !== undefined,
    ...(a.radius !== undefined ? { radius: a.radius } : {}),
    maxRadius: maxRadiusOf(a.pixelWidth, a.pixelHeight, a.crop),
  };
}

/**
 * What the Beautify radius slider gives an image, in source px. The slider is in the shot's
 * displayed px; an image's own `radius` is in source px, so Corners shows both in one unit.
 */
export function followRadiusSource(
  sliderRadius: number,
  naturalW: number,
  displayW: number,
): number {
  if (!(naturalW > 0) || !(displayW > 0) || !Number.isFinite(sliderRadius)) return 0;
  return Math.round((sliderRadius * naturalW) / displayW);
}

type Writer = Pick<EditorScene, "annotations" | "commitBase" | "commitAnnotation">;

/**
 * Reset: remove the crop of `id` in ONE commit (one undo step). The base drops `baseCrop`; an
 * added image grows back to its whole asset. A no-op when there is no crop or no such image;
 * a crop that is not a real window is left alone (fail closed, like crop mode).
 */
export function resetImageCrop(scene: Writer, base: BaseFields, id: string): void {
  if (id === BASE_IMAGE_ID) {
    if (base.baseCrop) scene.commitBase({ baseCrop: undefined });
    return;
  }
  const a = scene.annotations.find((x): x is ImageAnnotation => x.id === id && x.kind === "image");
  if (!a?.crop) return;
  try {
    const target = cropTarget(id, scene.annotations, base);
    if (target) scene.commitAnnotation(id, imageCropPatch(target, target.full));
  } catch {
    // Not a real window: nothing to restore from.
  }
}

/** Corners: set the image's own radius (source px), or `undefined` to follow the slider again. */
export function setImageRadius(
  scene: Pick<EditorScene, "commitBase" | "commitAnnotation">,
  id: string,
  radius: number | undefined,
): void {
  if (id === BASE_IMAGE_ID) scene.commitBase({ baseRadius: radius });
  else scene.commitAnnotation(id, { radius });
}
