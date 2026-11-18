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
