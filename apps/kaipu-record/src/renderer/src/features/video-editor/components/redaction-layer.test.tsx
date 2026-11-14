import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreviewMedia } from "../playback-media";
import type { BlurRedaction } from "../privacy/redaction";
import { RedactionLayer } from "./redaction-layer";

const FRAME = { width: 1920, height: 1080 };

function pixelate(rect: BlurRedaction["rect"]): BlurRedaction {
  return { id: "p1", kind: "blur", start: 1, end: 3, rect, intensity: 70, style: "pixelate" };
}

/** A recording-switch stand-in: the element on screen is `picture`, sized (w x h). */
function switchShowing(w: number, h: number): { media: PreviewMedia; picture: HTMLVideoElement } {
  const picture = document.createElement("video");
  Object.defineProperty(picture, "videoWidth", { value: w });
  Object.defineProperty(picture, "videoHeight", { value: h });
  Object.defineProperty(picture, "currentTime", { value: 2, writable: true });
  const media = picture as unknown as PreviewMedia;
  (media as { activeElement?: () => HTMLVideoElement | null }).activeElement = () => picture;
  return { media, picture };
}

type Call = { fn: string; args: unknown[] };
let calls: Call[];
let layoutSize: { w: number; h: number };

beforeEach(() => {
  calls = [];
  layoutSize = { w: 0, h: 0 };
  const ctx = {
    imageSmoothingEnabled: false,
    drawImage: (...args: unknown[]) => calls.push({ fn: "drawImage", args }),
    clearRect: (...args: unknown[]) => calls.push({ fn: "clearRect", args }),
    fillRect: (...args: unknown[]) => calls.push({ fn: "fillRect", args }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  // jsdom lays nothing out; a layout reads as the DOM's integer-rounded px.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => layoutSize.w);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => layoutSize.h);
});

afterEach(() => vi.restoreAllMocks());

function renderLayer(
  media: PreviewMedia,
  rect: BlurRedaction["rect"],
): { canvas: HTMLCanvasElement } {
  const { container } = render(
    <RedactionLayer
      redactions={[pixelate(rect)]}
      videoRef={{ current: media }}
      hidden={false}
      frame={FRAME}
    />,
  );
  return { canvas: container.querySelector("canvas") as HTMLCanvasElement };
}

describe("RedactionLayer pixelate over the picture the element shows", () => {
  it("samples the opened recording unmapped, even when the layout px round its aspect", () => {
    layoutSize = { w: 853, h: 480 }; // 1920x1080 at 853.33x480, read as integers
    const { media, picture } = switchShowing(1920, 1080);
    const { canvas } = renderLayer(media, { x: 0, y: 0, w: 1, h: 0.5 });
    // The clock applies on mount and again on the trigger effect: every call is the same
    // identity draw, and none clears (nothing is left blank at the edge).
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.fn).toBe("drawImage");
      expect(call.args).toEqual([picture, 0, 0, 1920, 540, 0, 0, canvas.width, canvas.height]);
    }
  });

  it("maps a rect over a 4:3 picture in a 16:9 frame, drawing only the part over the picture", () => {
    const { media, picture } = switchShowing(1440, 1080); // bars of 240/1920 left and right
    const { canvas } = renderLayer(media, { x: 0.05, y: 0, w: 0.2, h: 1 });
    const drawn = calls.find((c) => c.fn === "drawImage")!;
    expect(calls[0]!.fn).toBe("clearRect");
    // The picture is 75% of the frame wide (bars of 12.5%). Frame x 0.05..0.25 is picture x
    // -0.1..0.1667: the part over the picture is 0..0.1667 = source px 0..240.
    const [video, sx, sy, sw, sh, dx, dy, dw, dh] = drawn.args as number[];
    expect(video).toBe(picture);
    expect(sx).toBeCloseTo(0, 6);
    expect(sy).toBe(0);
    expect(sw).toBeCloseTo(240, 6);
    expect(sh).toBe(1080);
    // The canvas spans the whole rect (0.2667 of the picture wide); the drawn part starts
    // where the bar ends, 0.1/0.2667 = 37.5% in, and fills the remaining 62.5%.
    expect(dx).toBeCloseTo(0.375 * canvas.width, 6);
    expect(dy).toBe(0);
    expect(dw).toBeCloseTo(0.625 * canvas.width, 6);
    expect(dh).toBe(canvas.height);
  });

  it("draws nothing for a rect wholly over a bar", () => {
    const { media } = switchShowing(1440, 1080);
    renderLayer(media, { x: 0.02, y: 0.1, w: 0.08, h: 0.5 }); // frame x 0.02..0.10 < bar 0.125
    expect(calls.filter((c) => c.fn === "drawImage")).toEqual([]);
  });
});
