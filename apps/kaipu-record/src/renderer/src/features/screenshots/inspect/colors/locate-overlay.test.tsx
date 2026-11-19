import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocateOverlay } from "./locate-overlay";
import type { LocatedImage } from "./colors-client";

// NIW2-876, layer 3: the highlight canvas is the WHOLE asset, so a base that was cropped,
// resized or moved must lay it out where the asset sits and clip it to what shows.

const image: LocatedImage = {
  matched: 40,
  areas: 1,
  bounds: { x: 0, y: 0, w: 8, h: 4 },
  width: 8,
  height: 8,
  pixels: new Uint8ClampedArray(8 * 8 * 4),
};

describe("LocateOverlay over a placed base", () => {
  it("a base at its natural place keeps the canvas directly over the shot, unwrapped", () => {
    render(<LocateOverlay image={image} />);
    const canvas = screen.getByTestId("inspect-locate");
    expect(screen.queryByTestId("inspect-locate-view")).toBeNull();
    expect(canvas.parentElement!.getAttribute("data-testid")).toBeNull();
  });

  it("a moved and resized base: the asset's box sits at its placement, clipped to the same box", () => {
    // The whole 8 px asset at half size with its corner at world (0.5, 0.25).
    render(<LocateOverlay image={image} base={{ visible: { x: 0.5, y: 0.25, w: 0.5, h: 0.5 } }} />);
    const view = screen.getByTestId("inspect-locate-view");
    expect(view.style.left).toBe("50%");
    expect(view.style.top).toBe("25%");
    expect(view.style.width).toBe("50%");
    expect(view.style.height).toBe("50%");
    const asset = screen.getByTestId("inspect-locate-asset");
    // Nothing cropped: the canvas fills that box exactly.
    expect(asset.style.left).toBe("0%");
    expect(asset.style.top).toBe("0%");
    expect(asset.style.width).toBe("100%");
    expect(asset.style.height).toBe("100%");
    expect(asset.contains(screen.getByTestId("inspect-locate"))).toBe(true);
  });

  it("a cropped, moved base: clipped to the visible window, the asset shifted behind it", () => {
    // Placement (0.5, 0.25) at half scale, right half showing: the whole asset is
    // (0.5, 0.25, 0.5, 0.5), the window its right half (0.75, 0.25, 0.25, 0.5).
    render(
      <LocateOverlay
        image={image}
        base={{
          visible: { x: 0.75, y: 0.25, w: 0.25, h: 0.5 },
          crop: { x: 0.5, y: 0, w: 0.5, h: 1 },
        }}
      />,
    );
    const view = screen.getByTestId("inspect-locate-view");
    expect(view.style.left).toBe("75%");
    expect(view.style.width).toBe("25%");
    const asset = screen.getByTestId("inspect-locate-asset");
    // The whole asset is twice the window wide, its left half left of the window.
    expect(asset.style.left).toBe("-100%");
    expect(asset.style.width).toBe("200%");
    expect(asset.style.height).toBe("100%");
  });

  it("the tag moves with the asset, not with the anchor", () => {
    render(
      <LocateOverlay
        image={image}
        label="#FDFDFD"
        base={{ visible: { x: 0.5, y: 0.25, w: 0.5, h: 0.5 } }}
      />,
    );
    const tag = screen.getByTestId("inspect-locate-tag");
    expect(screen.getByTestId("inspect-locate-asset").contains(tag)).toBe(true);
  });

  it("draws nothing without a highlight", () => {
    const { container } = render(
      <LocateOverlay image={null} base={{ visible: { x: 0.5, y: 0.25, w: 0.5, h: 0.5 } }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
