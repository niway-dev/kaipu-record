/**
 * The preview's CSS for the video background (ADR 0051): the same `backgroundFrame` the
 * composer draws with, applied at the stage's displayed size in display px. Pure — the stage
 * measures itself and calls this — so the preview and the export are two renderings of one
 * set of numbers, and a test can hold them to it.
 */
import type { CSSProperties } from "react";
import {
  backgroundPaint,
  type BackgroundId,
  type BackgroundPaint,
} from "../../screenshots/beautify/backgrounds";
import { backgroundFrame, hasBackground, type VideoBackground } from "../background";

export interface PreviewBackgroundStyle {
  /** The frame: the preset's paint behind the picture. Empty with `none`. */
  frame: CSSProperties;
  /** The picture: inset, rounded and shadowed. Empty with `none`, where it fills the frame. */
  picture: CSSProperties;
}

const NEUTRAL: PreviewBackgroundStyle = { frame: {}, picture: {} };

/**
 * The CSS `background` of a preset's PAINT: a hex for a solid one, and for a gradient the
 * 135° `linear-gradient(from, to)` the composer draws (its isolines are perpendicular to the
 * diagonal, so the end colours meet at the two corners whatever the aspect).
 *
 * It is built from `paint`, not from the preset's `css`: the screenshot editor's Dark and
 * Carbon `css` are THEME TOKENS (`var(--bg-app)`, `var(--bg-card)`) that follow the app's
 * theme, while the MP4 and the GIF hold the fixed `paint` colours. The video preview must
 * show what the file holds, so it never reads a token: it is the same in either theme.
 * (The screenshot editor keeps `css`; its frame is a live preview of a theme-following look.)
 */
function paintCss(paint: BackgroundPaint): string | null {
  if (paint.kind === "solid") return paint.color;
  if (paint.kind === "gradient") return `linear-gradient(135deg, ${paint.from}, ${paint.to})`;
  return null;
}

/** The video frame's CSS for preset `id`; null for `none`, which paints nothing. */
export function previewFrameBackground(id: BackgroundId): string | null {
  return paintCss(backgroundPaint(id));
}

/** `background` around a picture drawn into a stage of `width × height` display px. */
export function previewBackgroundStyle(
  background: VideoBackground,
  width: number,
  height: number,
): PreviewBackgroundStyle {
  if (!hasBackground(background) || !(width > 0) || !(height > 0)) return NEUTRAL;
  const paint = previewFrameBackground(background.bg);
  if (paint === null) return NEUTRAL;
  const { picture, radius, shadow } = backgroundFrame(background, width, height);
  return {
    // A custom property, read by `.frame { background: var(--frame-bg) }`: the paint's CSS
    // is a whole `background` value (a hex or a gradient), and this keeps it verbatim.
    frame: { "--frame-bg": paint } as CSSProperties,
    picture: {
      left: `${picture.x}px`,
      top: `${picture.y}px`,
      width: `${picture.width}px`,
      height: `${picture.height}px`,
      borderRadius: `${radius}px`,
      boxShadow: shadow
        ? `0 ${shadow.offsetY}px ${shadow.blur}px rgba(0, 0, 0, ${shadow.alpha})`
        : undefined,
    },
  };
}
