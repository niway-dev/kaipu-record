import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BeautifiedFrame } from "./beautified-frame";
import { CropChip } from "./crop-chip";
import type { BeautifyState } from "./backgrounds";

const beautify: BeautifyState = { bg: "none", padding: 0, radius: 0, shadow: 0 };
const CROP = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };

describe("CropChip", () => {
  it("says Cropped and names the ways back in its tooltip", () => {
    render(<CropChip onEnter={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Cropped" });
    expect(chip).toHaveAttribute("title", "Edit crop · X or double-click");
    expect(chip.closest('[data-ui-area="editorImage.cropChip"]')).not.toBeNull();
  });

  it("a click on it enters the crop tool", () => {
    const onEnter = vi.fn();
    render(<CropChip onEnter={onEnter} />);
    fireEvent.click(screen.getByRole("button", { name: "Cropped" }));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});

describe("BeautifiedFrame — the cropped chip", () => {
  const chip = <CropChip onEnter={vi.fn()} />;

  it("a crop set: the chip is there, above the cropped image", () => {
    render(<BeautifiedFrame src="x" beautify={beautify} crop={CROP} windowChip={chip} />);
    expect(screen.getByRole("button", { name: "Cropped" })).toBeInTheDocument();
  });

  it("no crop (or the crop tool showing the whole image): no chip", () => {
    render(<BeautifiedFrame src="x" beautify={beautify} windowChip={chip} />);
    expect(screen.queryByRole("button", { name: "Cropped" })).toBeNull();
  });

  it("a double-click on the cropped image calls onWindowDoubleClick", () => {
    const onDouble = vi.fn();
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify}
        crop={CROP}
        windowChip={chip}
        onWindowDoubleClick={onDouble}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("img"));
    expect(onDouble).toHaveBeenCalledTimes(1);
  });

  it("a double-click on the chip itself is not a double-click on the image", () => {
    const onDouble = vi.fn();
    render(
      <BeautifiedFrame
        src="x"
        beautify={beautify}
        crop={CROP}
        windowChip={chip}
        onWindowDoubleClick={onDouble}
      />,
    );
    fireEvent.doubleClick(screen.getByRole("button", { name: "Cropped" }));
    expect(onDouble).not.toHaveBeenCalled();
  });
});
