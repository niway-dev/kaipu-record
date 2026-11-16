import type { WebcamTrackMeta } from "@shared/webcam-track";
import {
  drawWebcamLayer,
  planWebcamDraw,
  type WebcamCtx,
} from "@renderer/features/video-editor/export/compose-webcam";
import {
  openWebcamSource,
  type WebcamSource,
} from "@renderer/features/video-editor/export/webcam-source";
import {
  seedWebcamScene,
  type WebcamScene,
} from "@renderer/features/video-editor/webcam/webcam-model";
import { generateThumbnail } from "@renderer/lib/generate-thumbnail";
import { mediaUrl } from "@renderer/lib/media-url";

/**
 * The recorder grabs its screen thumbnail about this long after the take starts
 * (`captureThumbnail` waits 150 ms for a first frame). The bubble is drawn from the webcam
 * frame on screen at that moment, so the thumbnail reads as the first seconds of the take.
 */
export const THUMBNAIL_SOURCE_SECONDS = 0.15;
/** Same quality as the recorder's own thumbnail and `generateThumbnail`. */
const JPEG_QUALITY = 0.7;

/** A 2D context that can draw the bubble and the screen frame under it. */
type ThumbnailCtx = WebcamCtx & {
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
};

export interface ThumbnailCanvas {
  ctx: ThumbnailCtx;
  /** The canvas as a JPEG (quality 0.7), or null when it cannot be encoded. */
  encode(): Promise<ArrayBuffer | null>;
}

/** What the composition reads and draws through; the browser's by default, a fake in tests. */
export interface ComposeIo {
  /** The screen thumbnail as an image. */
  loadScreen(input: ComposeWebcamThumbnailInput): Promise<ScreenImage>;
  /** The webcam file's decoder, or null when there is nothing to decode. */
  openWebcam(input: ComposeWebcamThumbnailInput, scene: WebcamScene): Promise<WebcamSource | null>;
  createCanvas(width: number, height: number): ThumbnailCanvas;
}

export interface ScreenImage {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export interface ComposeWebcamThumbnailInput {
  /** The recording's id (its media URLs). */
  id: string;
  /** The current thumbnail, when the item has one; without it the screen frame is decoded. */
  screenUrl: string | null;
  /** The take's webcam track: its offset and the bubble as it was recorded. */
  webcam: WebcamTrackMeta;
}

/**
 * A recording's thumbnail with the webcam bubble drawn over the screen frame (NIW2-845).
 * Since ADR 0037 the bubble is excluded from the screen capture and recorded as its own
 * file, so the poster alone cannot tell the owner the take used the webcam.
 *
 * The screen frame is the existing thumbnail, kept at its size; the face is the webcam
 * frame shown ~150 ms into the take (the first frame when that one cannot be decoded),
 * placed by the layout the take was RECORDED with, not by any later editor session
 * (`seedWebcamScene`). Camera-off periods are ignored: the take used the webcam, and the
 * poster is there to say so. The video files are never touched.
 *
 * Rejects when no webcam frame can be decoded, so the caller keeps the plain poster.
 */
export async function composeWebcamThumbnail(
  input: ComposeWebcamThumbnailInput,
  io: ComposeIo = browserIo,
): Promise<ArrayBuffer> {
  const seeded = seedWebcamScene(input.webcam);
  if (!seeded) throw new Error("webcam thumbnail: no webcam track");
  const scene: WebcamScene = { ...seeded, segments: [] };

  const screen = await io.loadScreen(input);
  const source = await io.openWebcam(input, scene);
  if (!source) throw new Error("webcam thumbnail: the webcam file has no video");
  try {
    const frame =
      (await firstFrame(source, THUMBNAIL_SOURCE_SECONDS)) ??
      (await firstFrame(source, input.webcam.startOffsetMs / 1000));
    if (!frame) throw new Error("webcam thumbnail: no webcam frame to draw");

    const size = { width: screen.width, height: screen.height };
    const plan = planWebcamDraw(scene, 0, size, 1, frame);
    if (!plan) throw new Error("webcam thumbnail: the bubble has no room on the frame");

    const canvas = io.createCanvas(size.width, size.height);
    canvas.ctx.drawImage(screen.image, 0, 0, size.width, size.height);
    drawWebcamLayer(canvas.ctx, frame.image, plan);
    const jpeg = await canvas.encode();
    if (!jpeg) throw new Error("webcam thumbnail: could not encode the JPEG");
    return jpeg;
  } finally {
    source.dispose();
  }
}

/** The webcam frame on screen at `sourceSeconds`, or null when there is none (or no decode). */
async function firstFrame(source: WebcamSource, sourceSeconds: number) {
  for await (const image of source.framesAt([sourceSeconds])) return image;
  return null;
}

async function bytesToImage(blob: Blob): Promise<ScreenImage> {
  const bitmap = await createImageBitmap(blob);
  return { image: bitmap, width: bitmap.width, height: bitmap.height };
}

const browserIo: ComposeIo = {
  async loadScreen({ id, screenUrl }) {
    if (screenUrl) {
      const response = await fetch(screenUrl);
      if (response.ok) return bytesToImage(await response.blob());
    }
    // No thumbnail on disk: decode the screen frame from the recording itself.
    const video = await (await fetch(mediaUrl("recording", id))).blob();
    const jpeg = await generateThumbnail(video, THUMBNAIL_SOURCE_SECONDS);
    if (!jpeg) throw new Error("webcam thumbnail: no screen frame");
    return bytesToImage(new Blob([jpeg], { type: "image/jpeg" }));
  },
  async openWebcam({ id, webcam }, scene) {
    const response = await fetch(mediaUrl("webcam", id));
    if (!response.ok) throw new Error(`webcam thumbnail: webcam file ${response.status}`);
    return openWebcamSource(
      { blob: await response.blob(), startOffsetMs: webcam.startOffsetMs },
      scene,
    );
  },
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("webcam thumbnail: no 2D context");
    return {
      ctx,
      encode: async () => {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
        );
        return blob ? blob.arrayBuffer() : null;
      },
    };
  },
};
