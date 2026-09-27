/**
 * Overlay rasterization for export — renders each timeline overlay to a full-frame
 * transparent bitmap at the source video's native resolution, so the export worker
 * (Task 3, which has no DOM) can stamp them with a trivial `drawImage(bitmap, 0, 0)`.
 * Geometry/shape math (roughRect/roughArrow/HAND_FONT) is shared with the live
 * preview (video-annotation-layer's OverlayShape) and with the screenshot export
 * compositor (features/screenshots/annotations/compositor.ts), which solved the
 * same "native-scale strokes + arrow jitter" problem this module mirrors.
 */
import {
  HAND_FONT,
  STROKE_WIDTHS,
  TEXT_PX,
  roughArrow,
  roughRect,
  TEXT_LINE_HEIGHT,
  textLines,
} from "@renderer/features/screenshots/annotations";
import type { VideoOverlay } from "../scene";

export interface RasterizedOverlay {
  overlayId: string;
  bitmap: ImageBitmap;
}

/**
 * @param videoWidth native pixels of the source video track
 * @param videoHeight native pixels of the source video track
 * @param previewWidth displayed px of the preview video box (for scale-true strokes)
 */
export async function rasterizeOverlays(
  overlays: VideoOverlay[],
  videoWidth: number,
  videoHeight: number,
  previewWidth: number,
): Promise<RasterizedOverlay[]> {
  const scale = previewWidth > 0 ? videoWidth / previewWidth : 1;
  return Promise.all(
    overlays.map(async (overlay) => ({
      overlayId: overlay.id,
      bitmap: await rasterize(
        overlaySvg(overlay, videoWidth, videoHeight, scale),
        videoWidth,
        videoHeight,
      ),
    })),
  );
}

/** Builds one full-frame transparent SVG for a single overlay. Exported for tests. */
export function overlaySvg(o: VideoOverlay, W: number, H: number, scale: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${shapeSvg(o, W, H, scale)}</svg>`;
}

function shapeSvg(o: VideoOverlay, W: number, H: number, scale: number): string {
  if (o.kind === "box") {
    // Geometry is normalized 0–1 of the video frame — multiply directly by the
    // native dimensions (no beautify padding here, that's a screenshot-only concept).
    const bw = o.w * W;
    const bh = o.h * H;
    const sw = STROKE_WIDTHS[o.stroke] * scale;
    const p1 = roughRect(bw, bh, 14 * scale, o.seed);
    const p2 = roughRect(bw, bh, 14 * scale, o.seed + 19);
    return (
      `<g transform="translate(${o.x * W},${o.y * H})">` +
      `<path d="${p1}" fill="${o.color}2e" stroke="none"/>` +
      `<path d="${p1}" fill="none" stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${p2}" fill="none" stroke="${o.color}" stroke-width="${sw * 0.7}" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>` +
      `</g>`
    );
  }

  if (o.kind === "arrow") {
    const x1 = o.x1 * W;
    const y1 = o.y1 * H;
    const x2 = o.x2 * W;
    const y2 = o.y2 * H;
    const sw = STROKE_WIDTHS[o.stroke] * scale;
    // `scale` keeps the arrow's jitter/curve/arrowhead proportional at native
    // resolution — the "arrow-scale fix" the compositor already solved.
    return (
      `<path d="${roughArrow(x1, y1, x2, y2, o.seed, scale)}" fill="none" stroke="${o.color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${roughArrow(x1, y1, x2, y2, o.seed + 19, scale)}" fill="none" stroke="${o.color}" stroke-width="${sw * 0.7}" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>`
    );
  }

  // text — `size` is an index into TEXT_PX (see TextOverlay.size and
  // TEXT_SIZES/TEXT_PX in tools.ts), not a display-px value. Look up the px
  // size first, then scale it the same way strokes are scaled — mirrors the
  // screenshot compositor's `TEXT_PX[a.size] * scale`.
  const fs = TEXT_PX[o.size] * scale;
  const tx = o.x * W;
  // One tspan per line. SVG `<text>` neither wraps nor honours a newline, so a label
  // written across two lines in the editor would export as one run of text with the
  // break silently gone — found only after the export, which is the worst moment.
  // Mirrors the screenshot compositor; `textLines` and TEXT_LINE_HEIGHT are its own.
  const tspans = textLines(o.text)
    .map(
      (line, i) =>
        `<tspan x="${tx}" dy="${i === 0 ? 0 : fs * TEXT_LINE_HEIGHT}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  return `<text x="${tx}" y="${o.y * H}" fill="${o.color}" font-family="${HAND_FONT}" font-size="${fs}" font-weight="600" dominant-baseline="hanging">${tspans}</text>`;
}

function escapeXml(s: string): string {
  const map: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  };
  return s.replace(/[<>&'"]/g, (c) => map[c]);
}

function rasterize(svg: string, width: number, height: number): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("overlay-raster: no 2D context"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      createImageBitmap(canvas).then(resolve, reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("overlay-raster: SVG rasterize failed"));
    };
    img.src = url;
  });
}
