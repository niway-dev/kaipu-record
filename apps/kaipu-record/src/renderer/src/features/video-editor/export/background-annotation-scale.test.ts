import { describe, expect, it } from "vitest";
import { STROKE_WIDTHS, resolveFontPx } from "@renderer/features/screenshots/annotations";
import { backgroundFrame, type VideoBackground } from "../background";
import type { VideoOverlay } from "../scene";
import { overlaySvg } from "./overlay-raster";

/**
 * NIW2-670's known hazard meets NIW2-668: the export rasterises annotations at
 * `scale = videoWidth / previewWidth`, where the page hands over `video.clientWidth` — the
 * width of the picture AS DISPLAYED. With a background the preview picture is inset, so that
 * width shrinks. This holds the export to what the user sees: an annotation drawn at a given
 * screen size must have, relative to the picture, the same thickness in the export as in the
 * preview, with padding and without.
 *
 * The chain, every link a real function of the app: preview stroke `t` px on a picture
 * `D` px wide → `overlaySvg` at scale `videoWidth / D` on the source-size raster → stamped onto
 * the composer's canvas (`outputWidth / videoWidth`) → shrunk into the padding by the picture's
 * share of the output (`backgroundFrame`). Thickness relative to the picture must come out as
 * `t / D` in both.
 */

const MAGENTA: VideoBackground = { bg: "magenta", padding: 48, radius: 16, shadow: 24 };
const NONE: VideoBackground = { bg: "none", padding: 0, radius: 0, shadow: 0 };
const VIDEO = { width: 1920, height: 1080 };
/** The preview frame as displayed: the box the video region leaves the stage. */
const STAGES = [
  { width: 960, height: 540 },
  { width: 1280, height: 720 },
  { width: 640, height: 360 },
];
/** Balanced / Maximum at source size, YouTube 1440p. */
const OUTPUTS = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

const arrow: VideoOverlay = {
  id: "a",
  kind: "arrow",
  start: 0,
  end: 5,
  color: "#ff0000",
  x1: 0.2,
  y1: 0.2,
  x2: 0.7,
  y2: 0.6,
  stroke: 2,
  seed: 1,
};
const text: VideoOverlay = {
  id: "t",
  kind: "text",
  start: 0,
  end: 5,
  color: "#ffffff",
  x: 0.3,
  y: 0.3,
  text: "Hello",
  size: 2,
};

const numberIn = (svg: string, attribute: string): number =>
  parseFloat(new RegExp(`${attribute}="([\\d.]+)"`).exec(svg)![1]!);

/** What the user sees: the picture's displayed width in a stage, with a background or not. */
function previewPictureWidth(
  background: VideoBackground,
  stage: { width: number; height: number },
) {
  return backgroundFrame(background, stage.width, stage.height).picture.width;
}

/**
 * The thickness of `overlay`'s mark in the export, relative to the picture's width on the
 * output, when the page hands `previewWidth` to the rasteriser.
 */
function exportedRelative(
  overlay: VideoOverlay,
  attribute: "stroke-width" | "font-size",
  background: VideoBackground,
  output: { width: number; height: number },
  previewWidth: number,
): number {
  const scale = VIDEO.width / previewWidth;
  const rasterised = numberIn(overlaySvg(overlay, VIDEO.width, VIDEO.height, scale), attribute);
  const onComposerCanvas = rasterised * (output.width / VIDEO.width);
  const picture = backgroundFrame(background, output.width, output.height).picture;
  const onOutput = onComposerCanvas * (picture.width / output.width);
  return onOutput / picture.width;
}

describe("annotation size in the export, with and without a background (NIW2-670)", () => {
  for (const [label, overlay, attribute, previewPx] of [
    ["stroke thickness", arrow, "stroke-width", STROKE_WIDTHS[2]!],
    ["text size", text, "font-size", resolveFontPx(2, undefined)],
  ] as const) {
    it.each(STAGES)(
      `${label} relative to the picture matches the preview, at a $width×$height stage`,
      (stage) => {
        for (const background of [NONE, MAGENTA]) {
          const displayed = previewPictureWidth(background, stage);
          // What the user sees: `previewPx` px on a picture `displayed` px wide.
          const inPreview = previewPx / displayed;
          for (const output of OUTPUTS) {
            const inExport = exportedRelative(overlay, attribute, background, output, displayed);
            expect(inExport).toBeCloseTo(inPreview, 9);
          }
        }
      },
    );
  }

  it("is only true because the page hands the PICTURE's width: the frame's would be wrong", () => {
    // The page passes `video.clientWidth`, and the <video> fills the inset picture. Had it
    // passed the frame's width instead, every annotation would export thinner than previewed by
    // exactly the picture's share of the frame.
    const stage = STAGES[0]!;
    const picture = previewPictureWidth(MAGENTA, stage);
    const right = exportedRelative(arrow, "stroke-width", MAGENTA, OUTPUTS[0]!, picture);
    const wrong = exportedRelative(arrow, "stroke-width", MAGENTA, OUTPUTS[0]!, stage.width);
    expect(wrong / right).toBeCloseTo(picture / stage.width, 9);
    expect(Math.abs(wrong / right - 1)).toBeGreaterThan(0.05);
  });

  it("magnifies the whole preview by one factor: the picture and the frame alike", () => {
    // With padding, the export is the preview scaled by outputWidth / stageWidth — the mark,
    // the picture and the padding each grow by the same factor.
    const stage = STAGES[0]!;
    const output = OUTPUTS[1]!;
    const factor = output.width / stage.width;
    const displayed = previewPictureWidth(MAGENTA, stage);
    const picture = backgroundFrame(MAGENTA, output.width, output.height).picture;
    expect(picture.width / displayed).toBeCloseTo(factor, 9);
    const relative = exportedRelative(arrow, "stroke-width", MAGENTA, output, displayed);
    expect((relative * picture.width) / STROKE_WIDTHS[2]!).toBeCloseTo(factor, 9);
  });

  it("changes nothing without a background", () => {
    // With `none` the picture is the whole frame: scale = videoWidth / frame width, as before.
    const stage = STAGES[0]!;
    const output = OUTPUTS[0]!;
    const scale = VIDEO.width / previewPictureWidth(NONE, stage);
    expect(previewPictureWidth(NONE, stage)).toBe(stage.width);
    const raster = numberIn(overlaySvg(arrow, VIDEO.width, VIDEO.height, scale), "stroke-width");
    expect(raster).toBeCloseTo(STROKE_WIDTHS[2]! * (VIDEO.width / stage.width), 9);
    expect(exportedRelative(arrow, "stroke-width", NONE, output, stage.width)).toBeCloseTo(
      STROKE_WIDTHS[2]! / stage.width,
      9,
    );
  });
});
