import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BeautifiedFrame } from "./beautified-frame";
import type { BeautifyState } from "./backgrounds";

const beautify = (over: Partial<BeautifyState> = {}): BeautifyState => ({
  bg: "none",
  padding: 20,
  radius: 0,
  shadow: 0,
  ...over,
});

/** The frame is the img's parent's parent (shotWrap sits inside it). */
const frameOf = (): HTMLElement => screen.getByRole("img").parentElement!.parentElement!;

describe("BeautifiedFrame — canvas extents (NIW2-698)", () => {
  it("without extents the frame style is exactly today's", () => {
    render(<BeautifiedFrame src="x" beautify={beautify()} />);
    const frame = frameOf();
    expect(frame.style.padding).toBe("20px");
    expect(frame.style.maxWidth).toBe("");
    expect(frame.style.maxHeight).toBe("");
    expect(frame.style.flexShrink).toBe("");
    expect(frame.style.transform).toBe("");
    expect(screen.queryByTestId("canvas-box-fill")).toBeNull();
  });

  it("all-zero extents are the same as none", () => {
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify()}
        extents={{ left: 0, top: 0, right: 0, bottom: 0 }}
      />,
    );
    const frame = frameOf();
    expect(frame.style.padding).toBe("20px");
    expect(frame.style.maxWidth).toBe("");
    expect(frame.style.flexShrink).toBe("");
    expect(screen.queryByTestId("canvas-box-fill")).toBeNull();
  });

  it("with extents the padding is padding + extent, per side", () => {
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify()}
        extents={{ left: 5, top: 10, right: 15, bottom: 30 }}
      />,
    );
    const frame = frameOf();
    // top right bottom left
    expect(frame.style.padding).toBe("30px 35px 50px 25px");
  });

  it("lets the frame outgrow its container by the extents, so the shot does not shrink", () => {
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify()}
        extents={{ left: 5, top: 10, right: 15, bottom: 30 }}
      />,
    );
    const frame = frameOf();
    expect(frame.style.maxWidth).toBe("calc(100% + 20px)");
    expect(frame.style.maxHeight).toBe("calc(100% + 40px)");
  });

  it("with extents the frame does not shrink, so the shot keeps its zero-extents size", () => {
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify()}
        extents={{ left: 5, top: 10, right: 15, bottom: 30 }}
      />,
    );
    expect(frameOf().style.flexShrink).toBe("0");
  });

  it("with no background and extents nothing is painted under the shot (the gap stays transparent)", () => {
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify({ bg: "none", padding: 20 })}
        extents={{ left: 5, top: 0, right: 0, bottom: 0 }}
      />,
    );
    expect(screen.queryByTestId("canvas-box-fill")).toBeNull();
  });

  it("with a background there is no extra block (the background covers the box)", () => {
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify({ bg: "sunset" })}
        extents={{ left: 5, top: 0, right: 0, bottom: 0 }}
      />,
    );
    expect(screen.queryByTestId("canvas-box-fill")).toBeNull();
  });

  it("composes pan and zoom into one transform, and a pan skips the transform easing", () => {
    render(<BeautifiedFrame src="x" beautify={beautify()} zoom={2} pan={{ x: 30, y: -10 }} />);
    const frame = frameOf();
    expect(frame.style.transform).toBe("translate(30px, -10px) scale(2)");
    expect(frame.className).toMatch(/panned/);
  });

  it("zoom without pan keeps the classic scale-only transform", () => {
    render(<BeautifiedFrame src="x" beautify={beautify()} zoom={1.5} />);
    expect(frameOf().style.transform).toBe("scale(1.5)");
  });
});

describe("BeautifiedFrame — a cropped or resized base (NIW2-853)", () => {
  // Illustrative: a base shown 200 x 100 px; its visible part is the middle half, at (0.25, 0.25).
  const shot = { w: 200, h: 100 };
  const base = {
    visible: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    shot,
  };
  const baseEl = (): HTMLElement => screen.getByTestId("base-view");

  it("draws nothing extra for a base nobody cropped or resized", () => {
    render(<BeautifiedFrame src="x" beautify={beautify()} />);
    expect(screen.queryByTestId("base-view")).toBeNull();
    expect(frameOf().style.flexShrink).toBe("");
  });

  it("draws the visible part at its rect and keeps the original image only as the world anchor", () => {
    render(<BeautifiedFrame src="x" beautify={beautify()} base={base} />);
    const el = baseEl();
    expect(el.style.left).toBe("25%");
    expect(el.style.top).toBe("25%");
    expect(el.style.width).toBe("50%");
    expect(el.style.height).toBe("50%");
    // The anchor still lays out (the editor measures it) but paints nothing.
    expect(screen.getByRole("img").style.opacity).toBe("0");
  });

  it("shifts the asset inside the window so the crop shows the right part", () => {
    render(<BeautifiedFrame src="x" beautify={beautify()} base={base} />);
    const inner = baseEl().querySelector("img")!;
    // Window = 0.5 of the asset starting at 0.25: the asset is twice the window, moved left by
    // half a window.
    expect(inner.style.width).toBe("200%");
    expect(inner.style.height).toBe("200%");
    expect(inner.style.left).toBe("-50%");
    expect(inner.style.top).toBe("-50%");
  });

  it("an uncropped but resized base draws the whole asset in its window", () => {
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify()}
        base={{ visible: { x: 1, y: 0, w: 0.5, h: 0.5 }, shot }}
      />,
    );
    const inner = baseEl().querySelector("img")!;
    expect(inner.style.width).toBe("100%");
    expect(inner.style.left).toBe("0%");
  });

  it("makes the anchor's margin box the visible rect, so the frame wraps what shows", () => {
    render(<BeautifiedFrame src="x" beautify={beautify()} base={base} />);
    const wrap = screen.getByRole("img").parentElement!;
    // 25% of 200 hidden left, 25% right; 25% of 100 hidden above and below.
    expect(wrap.style.marginLeft).toBe("-50px");
    expect(wrap.style.marginRight).toBe("-50px");
    expect(wrap.style.marginTop).toBe("-25px");
    expect(wrap.style.marginBottom).toBe("-25px");
  });

  it("holds the shot's fit steady: the frame's maximum is grown by what the crop hides", () => {
    render(<BeautifiedFrame src="x" beautify={beautify()} base={base} />);
    const frame = frameOf();
    expect(frame.style.flexShrink).toBe("0");
    // Hidden: 100 px of width, 50 px of height. No extents.
    expect(frame.style.maxWidth).toBe("calc(100% - 100px)");
    expect(frame.style.maxHeight).toBe("calc(100% - 50px)");
  });

  it("a base resized past the original grows the maximum instead", () => {
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify()}
        base={{ visible: { x: 0, y: 0, w: 2, h: 2 }, shot }}
        extents={{ left: 0, top: 0, right: 30, bottom: 0 }}
      />,
    );
    const frame = frameOf();
    // Hidden: -200 px wide (it shows 200 more than the anchor), plus 30 of extents.
    expect(frame.style.maxWidth).toBe("calc(100% + 230px)");
    expect(frame.style.maxHeight).toBe("calc(100% + 100px)");
  });

  it("rounds the visible part with the base's own radius, else the global one", () => {
    const { unmount } = render(
      <BeautifiedFrame src="x" beautify={beautify({ radius: 8 })} base={base} />,
    );
    expect(baseEl().style.borderRadius).toBe("8px");
    unmount();
    render(
      <BeautifiedFrame src="x" beautify={beautify({ radius: 8 })} base={{ ...base, radius: 3 }} />,
    );
    expect(baseEl().style.borderRadius).toBe("3px");
  });
});
