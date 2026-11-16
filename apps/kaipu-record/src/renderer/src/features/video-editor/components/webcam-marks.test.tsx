import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WEBCAM_DEFAULTS, type WebcamScene, type WebcamSegment } from "../webcam/webcam-model";
import { WebcamMarks, type WebcamMarksProps } from "./webcam-marks";

const FRAME = { width: 1920, height: 1080 };
/** The preview measures half the frame, so every frame pixel is half a CSS pixel. */
const PREVIEW = { width: 960, height: 540 };

const part = (id: string, start: number, end: number, patch: Partial<WebcamSegment> = {}) =>
  ({
    id,
    start,
    end,
    mode: "override",
    layout: { position: { x: 0.8, y: 0.2 } },
    transition: { kind: "slide", ms: 700, easing: "ease-in-out" },
    ...patch,
  }) satisfies WebcamSegment;
const scene = (...segments: WebcamSegment[]): WebcamScene => ({
  layout: { ...WEBCAM_DEFAULTS },
  segments,
});

function renderMarks(webcam: WebcamScene, patch: Partial<WebcamMarksProps> = {}) {
  return render(
    <WebcamMarks
      webcam={webcam}
      sourceTime={15}
      selectedId={null}
      frame={FRAME}
      cameraScale={1}
      endSeconds={60}
      playing={false}
      suppressed={false}
      {...patch}
    />,
  );
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: PREVIEW.width,
    height: PREVIEW.height,
    left: 0,
    top: 0,
    right: PREVIEW.width,
    bottom: PREVIEW.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});
afterEach(() => vi.restoreAllMocks());

describe("WebcamMarks: only while paused", () => {
  it("draws nothing while playing", () => {
    renderMarks(scene(part("a", 10, 20)), { playing: true });
    expect(screen.queryByTestId("webcam-marks")).toBeNull();
    expect(screen.queryByTestId("webcam-mark-label")).toBeNull();
    expect(screen.queryByTestId("webcam-mark-arrow")).toBeNull();
  });

  it("draws the marks while paused", () => {
    renderMarks(scene(part("a", 10, 20)));
    expect(screen.getByTestId("webcam-marks")).toBeInTheDocument();
    expect(screen.getByTestId("webcam-mark-label")).toBeInTheDocument();
    expect(screen.getByTestId("webcam-mark-arrow")).toBeInTheDocument();
  });

  it("steps aside while the bubble is held or a card is open", () => {
    renderMarks(scene(part("a", 10, 20)), { suppressed: true });
    expect(screen.queryByTestId("webcam-marks")).toBeNull();
  });

  it("is a mark layer that takes no pointer: the bubble under it stays grabbable", () => {
    // jsdom applies no CSS Module, so the stylesheet itself is the contract: the root lets
    // every pointer through (the property is inherited by every mark inside it).
    const css = readFileSync(join(__dirname, "webcam-marks.module.css"), "utf8");
    expect(css).toMatch(/\.root\s*\{[^}]*pointer-events:\s*none/);
    renderMarks(scene(part("a", 10, 20)));
    expect(screen.getByTestId("webcam-marks").className).toMatch(/root/);
  });
});

describe("WebcamMarks: the label", () => {
  it("says 'Original position' outside every part", () => {
    renderMarks(scene(part("a", 30, 40)));
    expect(screen.getByTestId("webcam-mark-label")).toHaveTextContent("Original position");
    expect(screen.getByTestId("webcam-mark-label")).toHaveAttribute("data-tone", "plain");
  });

  it("says 'This part' with its times inside a part, in the accent tone", () => {
    renderMarks(scene(part("a", 10, 20)));
    expect(screen.getByTestId("webcam-mark-label")).toHaveTextContent("This part · 0:10 – 0:20");
    expect(screen.getByTestId("webcam-mark-label")).toHaveAttribute("data-tone", "part");
  });

  it("says 'Sliding…' while the bubble moves", () => {
    renderMarks(scene(part("a", 10, 20)), { sourceTime: 10.3 });
    expect(screen.getByTestId("webcam-mark-label")).toHaveTextContent("Sliding…");
    expect(screen.queryByTestId("webcam-mark-arrow")).toBeNull();
  });
});

describe("WebcamMarks: the route, ghost and chip", () => {
  it("tags a ghost 'Original' for a part after the original position, with the slide chip", () => {
    renderMarks(scene(part("a", 10, 20)));
    expect(screen.getByTestId("webcam-mark-from")).toHaveTextContent("Original");
    expect(screen.getByTestId("webcam-mark-ghost")).toBeInTheDocument();
    expect(screen.getByTestId("webcam-mark-chip")).toHaveTextContent("Slide 0.7 s");
  });

  it("tags a ghost 'Before' for a part that follows another", () => {
    renderMarks(
      scene(part("a", 10, 20), part("b", 20, 30, { layout: { position: { x: 0.2, y: 0.2 } } })),
      { sourceTime: 25 },
    );
    expect(screen.getByTestId("webcam-mark-from")).toHaveTextContent("Before");
  });

  it("chips 'Cut' for a part with no slide", () => {
    renderMarks(scene(part("a", 10, 20, { transition: { kind: "cut", ms: 700, easing: "back" } })));
    expect(screen.getByTestId("webcam-mark-chip")).toHaveTextContent("Cut");
    expect(screen.getByTestId("webcam-mark-chip")).not.toHaveTextContent("Slide");
  });

  it("shows no route with no part in force", () => {
    renderMarks(scene(part("a", 30, 40)));
    expect(screen.queryByTestId("webcam-mark-ghost")).toBeNull();
    expect(screen.queryByTestId("webcam-mark-chip")).toBeNull();
  });

  it("shows the selected part's route with the playhead outside it", () => {
    renderMarks(scene(part("a", 30, 40)), { selectedId: "a" });
    expect(screen.getByTestId("webcam-mark-chip")).toHaveTextContent("Slide 0.7 s");
  });
});

describe("WebcamMarks: a hidden range", () => {
  const hiddenScene = scene({ id: "h", start: 10, end: 20, mode: "hidden" });

  it("outlines where the camera would be, with 'HIDDEN' and no label or route", () => {
    renderMarks(hiddenScene);
    expect(screen.getByTestId("webcam-mark-hidden")).toHaveTextContent("HIDDEN");
    expect(screen.queryByTestId("webcam-mark-label")).toBeNull();
    expect(screen.queryByTestId("webcam-mark-chip")).toBeNull();
  });

  it("sizes the outline like the bubble, in preview pixels", () => {
    renderMarks(hiddenScene);
    // size 0.22 of the 1080 frame height = 237.6 frame px = 118.8 preview px.
    const style = screen.getByTestId("webcam-mark-hidden").style;
    expect(parseFloat(style.width)).toBeCloseTo(118.8, 1);
    expect(style.borderRadius).toBe("50%");
  });

  it("is absent outside the range", () => {
    renderMarks(hiddenScene, { sourceTime: 25 });
    expect(screen.queryByTestId("webcam-mark-hidden")).toBeNull();
  });
});
