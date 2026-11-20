import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageSelection, visibleSourceSize } from "./image-selection";

describe("visibleSourceSize (NIW2-876, AC5)", () => {
  it("is the crop window of the asset in whole source pixels", () => {
    expect(visibleSourceSize(3840, 2160, { x: 0, y: 0, w: 0.3125, h: 0.37037 })).toEqual({
      w: 1200,
      h: 800,
    });
  });

  it("is the whole asset without a crop", () => {
    expect(visibleSourceSize(400, 200)).toEqual({ w: 400, h: 200 });
  });
});

describe("ImageSelection size tag (NIW2-876, AC5)", () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };
  it("reads Showing A×B of C×D px for a cropped image", () => {
    render(
      <ImageSelection
        rect={rect}
        pixelWidth={3840}
        pixelHeight={2160}
        crop={{ x: 0, y: 0, w: 0.3125, h: 0.37037 }}
        gaps={[]}
        unit={1}
      />,
    );
    expect(screen.getByTestId("image-tag")).toHaveTextContent("Showing 1200×800 of 3840×2160 px");
  });

  it("reads the plain size without a crop", () => {
    render(<ImageSelection rect={rect} pixelWidth={3840} pixelHeight={2160} gaps={[]} unit={1} />);
    expect(screen.getByTestId("image-tag")).toHaveTextContent("3840 × 2160 px");
  });
});
