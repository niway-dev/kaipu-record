import { CanvasSink } from "mediabunny";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import {
  drawWebcamLayer,
  planWebcamDraw,
  type WebcamCtx,
  type WebcamImage,
} from "@renderer/features/video-editor/export/compose-webcam";
import {
  seedWebcamScene,
  type WebcamScene,
} from "@renderer/features/video-editor/webcam/webcam-model";
import { mediaUrl } from "@renderer/lib/media-url";
import { openRecordingInput } from "@renderer/lib/open-recording-input";

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
  /**
   * ONE frame of the webcam file, the one on screen at `webcamSeconds` of the file's own
   * timeline (read by range, never the whole file), or null when it has none there or the
   * file cannot be decoded.
   */
  decodeWebcamFrame(
    input: ComposeWebcamThumbnailInput,
    webcamSeconds: number,
  ): Promise<WebcamImage | null>;
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
  // The webcam file's time for the take's ~150 ms (its time 0 is `startOffsetMs` into the
  // take, so a webcam that started later has no frame yet and shows its first one).
  const wanted = webcamFrameSeconds(input.webcam.startOffsetMs);
  const frame =
    (await io.decodeWebcamFrame(input, wanted)) ??
    (wanted > 0 ? await io.decodeWebcamFrame(input, 0) : null);
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
}

/** The webcam file's time that shows what the recorder's thumbnail showed: never negative. */
export function webcamFrameSeconds(startOffsetMs: number): number {
  return Math.max(0, THUMBNAIL_SOURCE_SECONDS - startOffsetMs / 1000);
}

/** `seconds` held inside [0, duration): a time past the last frame asks for the last one. */
export function clampIntoDuration(seconds: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(seconds, duration - 0.001));
}

async function bytesToImage(blob: Blob): Promise<ScreenImage> {
  const bitmap = await createImageBitmap(blob);
  return { image: bitmap, width: bitmap.width, height: bitmap.height };
}

/** Poster width when the screen frame is decoded from the recording (as `generateThumbnail`). */
const FALLBACK_POSTER_WIDTH = 640;

/**
 * One frame of a vault video at `seconds`, by Range requests through `UrlSource`: only the
 * container metadata and the packets that frame needs are read, so a one-hour take is not
 * loaded into memory. The Input is disposed as soon as the frame is drawn into its canvas.
 */
async function decodeFrameAt(
  url: string,
  seconds: number,
  width?: number,
): Promise<WebcamImage | null> {
  const input = openRecordingInput(url);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const at = clampIntoDuration(seconds, await track.computeDuration());
    const sink = new CanvasSink(track, width ? { width } : undefined);
    const wrapped = await sink.getCanvas(at);
    if (!wrapped) return null;
    const canvas = wrapped.canvas as HTMLCanvasElement;
    return { image: canvas, width: canvas.width, height: canvas.height };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

const browserIo: ComposeIo = {
  async loadScreen({ id, screenUrl }) {
    if (screenUrl) {
      const response = await fetch(screenUrl);
      if (response.ok) return bytesToImage(await response.blob());
    }
    // No thumbnail on disk: the screen frame comes from the recording, by range as well.
    const url = mediaUrl("recording", id);
    const frame =
      (await decodeFrameAt(url, THUMBNAIL_SOURCE_SECONDS, FALLBACK_POSTER_WIDTH)) ??
      (await decodeFrameAt(url, 0, FALLBACK_POSTER_WIDTH));
    if (!frame) throw new Error("webcam thumbnail: no screen frame");
    return frame;
  },
  decodeWebcamFrame: ({ id }, webcamSeconds) =>
    decodeFrameAt(mediaUrl("webcam", id), webcamSeconds),
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
