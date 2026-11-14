/**
 * The worker inputs a GIF job and a still capture share: overlays rasterized at SOURCE
 * size, the slide bitmaps the plan uses, and COPIES of the camera arrays (transferring the
 * preview's own buffers would detach them). Lives outside `use-gif-export.ts` so the still
 * capture reuses it without pulling in the GIF hook.
 */
import type { SlideAssetStore } from "../slide-assets";
import type { VideoScene } from "../scene";
import type { CameraPath } from "../zoom/camera-path";
import type { CameraPathMessage } from "./export-messages";
import type { ExportPlan } from "./export-plan";
import { floatingAssetIds } from "./floating-frame";
import { rasterizeOverlays } from "./overlay-raster";

export interface JobInputArgs {
  scene: VideoScene;
  /** Native size of the source video (the MP4 export's output size). */
  videoWidth: number;
  videoHeight: number;
  /** Displayed px of the preview video box — overlay strokes scale true-to-preview. */
  previewWidth: number;
  slideAssets: SlideAssetStore;
  cameraPath: CameraPath | null;
}

export interface WorkerInputs {
  overlays: Array<{ overlayId: string; bitmap: ImageBitmap }>;
  slides: Array<{ assetId: string; bitmap: ImageBitmap }>;
  /** The floating images' bitmaps (decoded apart from `slides`); empty without floating items. */
  mediaImages: Array<{ assetId: string; bitmap: ImageBitmap }>;
  camera: CameraPathMessage | null;
  transfer: Transferable[];
}

export async function prepareWorkerInputs(
  args: JobInputArgs,
  plan: ExportPlan,
): Promise<WorkerInputs> {
  const rasterized = await rasterizeOverlays(
    args.scene.overlays,
    args.videoWidth,
    args.videoHeight,
    args.previewWidth,
  );
  const usedOverlayIds = new Set(plan.overlayWindows.map((w) => w.overlayId));
  for (const r of rasterized) if (!usedOverlayIds.has(r.overlayId)) r.bitmap.close();
  const overlays = rasterized
    .filter((r) => usedOverlayIds.has(r.overlayId))
    .map((r) => ({ overlayId: r.overlayId, bitmap: r.bitmap }));
  const usedAssetIds = new Set(
    plan.segments.filter((s) => s.kind === "slide").map((s) => s.assetId),
  );
  const slides = await Promise.all(
    args.slideAssets
      .entries()
      .filter((asset) => usedAssetIds.has(asset.assetId))
      .map(async (asset) => ({
        assetId: asset.assetId,
        bitmap: await createImageBitmap(new Blob([asset.bytes], { type: asset.mimeType })),
      })),
  );
  const mediaIds = floatingAssetIds(plan.floating);
  const mediaImages = await Promise.all(
    args.slideAssets
      .entries()
      .filter((asset) => mediaIds.has(asset.assetId))
      .map(async (asset) => ({
        assetId: asset.assetId,
        bitmap: await createImageBitmap(new Blob([asset.bytes], { type: asset.mimeType })),
      })),
  );
  const camera =
    plan.hasZoom && args.cameraPath
      ? {
          fps: args.cameraPath.fps,
          cx: args.cameraPath.cx.slice(),
          cy: args.cameraPath.cy.slice(),
          scale: args.cameraPath.scale.slice(),
        }
      : null;
  const transfer: Transferable[] = [
    ...overlays.map((o) => o.bitmap),
    ...slides.map((s) => s.bitmap),
    ...mediaImages.map((m) => m.bitmap),
    ...(camera ? [camera.cx.buffer, camera.cy.buffer, camera.scale.buffer] : []),
  ];
  return { overlays, slides, mediaImages, camera, transfer };
}
