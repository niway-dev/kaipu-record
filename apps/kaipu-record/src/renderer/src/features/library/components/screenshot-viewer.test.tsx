import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenshotViewer } from "./screenshot-viewer";

afterEach(cleanup);

function loadImage(img: HTMLElement, width = 1440, height = 900) {
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(img);
}

describe("ScreenshotViewer", () => {
  it("works with just src, as before", () => {
    const { container } = render(<ScreenshotViewer src="kaipu-media://screenshot/a" />);
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("reports and shows the natural size on load", () => {
    const onNaturalSize = vi.fn();
    const { container } = render(
      <ScreenshotViewer src="kaipu-media://screenshot/a" onNaturalSize={onNaturalSize} />,
    );
    loadImage(container.querySelector("img")!);
    expect(onNaturalSize).toHaveBeenCalledWith(1440, 900);
    expect(screen.getByText("1440 × 900 px")).toBeTruthy();
  });

  it("zooms in and out, and Fit resets", () => {
    const { container } = render(<ScreenshotViewer src="kaipu-media://screenshot/a" />);
    const img = container.querySelector("img")!;
    expect(img.style.width).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(img.style.width).toBe("150%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(img.style.width).toBe("200%");
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(img.style.width).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(img.style.maxWidth).toBe("75%");
  });

  it("zoomed out, the image scales inside the Fit box; zoomed in, it grows past it", () => {
    const { container } = render(<ScreenshotViewer src="kaipu-media://screenshot/a" />);
    const img = container.querySelector("img")!;
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    fireEvent.click(zoomOut);
    expect([img.style.maxWidth, img.style.maxHeight, img.style.width]).toEqual(["75%", "75%", ""]);
    fireEvent.click(zoomOut);
    expect([img.style.maxWidth, img.style.maxHeight, img.style.width]).toEqual(["50%", "50%", ""]);
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect([img.style.maxWidth, img.style.maxHeight, img.style.width]).toEqual(["", "", ""]);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect([img.style.width, img.style.maxWidth, img.style.maxHeight]).toEqual([
      "150%",
      "none",
      "none",
    ]);
  });

  it("zoomed out, a screenshot smaller than the frame shrinks from its Fit size", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 800, height: 500 } as DOMRect);
    try {
      const { container } = render(<ScreenshotViewer src="kaipu-media://screenshot/a" />);
      const img = container.querySelector("img")!;
      loadImage(img, 300, 200);
      const zoomOut = screen.getByRole("button", { name: "Zoom out" });
      fireEvent.click(zoomOut);
      expect(img.style.width).toBe("225px");
      fireEvent.click(zoomOut);
      expect(img.style.width).toBe("150px");
    } finally {
      rect.mockRestore();
    }
  });

  it("zoomed out, a tall screenshot stays inside its Fit box", () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 800, height: 500 } as DOMRect);
    try {
      const { container } = render(<ScreenshotViewer src="kaipu-media://screenshot/a" />);
      const img = container.querySelector("img")!;
      // 1000 × 3000 in an 800 × 500 frame: Fit is height-bound, about 167 × 500.
      loadImage(img, 1000, 3000);
      const zoomOut = screen.getByRole("button", { name: "Zoom out" });
      fireEvent.click(zoomOut);
      fireEvent.click(zoomOut);
      // Half of the Fit width (about 167 px): 83 px wide, so 250 px tall, inside the frame. The
      // old width-of-the-frame sizing gave 400 px here, 1200 px tall, cropped.
      expect(Number.parseFloat(img.style.width)).toBeCloseTo(83.33, 1);
    } finally {
      rect.mockRestore();
    }
  });

  it("stops at the ends of the zoom range", () => {
    render(<ScreenshotViewer src="kaipu-media://screenshot/a" />);
    const zoomIn = screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement;
    for (let i = 0; i < 6; i++) fireEvent.click(zoomIn);
    expect(zoomIn.disabled).toBe(true);
  });

  it("shows no controls when the image is unavailable", () => {
    render(<ScreenshotViewer src={null} />);
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fit" })).toBeNull();
  });

  it("copies the image from a button over it, and marks it copied", async () => {
    const onCopy = vi.fn(async () => true);
    render(<ScreenshotViewer src="kaipu-media://screenshot/a" onCopy={onCopy} />);
    const copy = screen.getByRole("button", { name: "Copy image" });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(copy.dataset.copied).toBe("true");
  });

  it("does not mark the button copied when the copy failed", async () => {
    render(<ScreenshotViewer src="kaipu-media://screenshot/a" onCopy={async () => false} />);
    const copy = screen.getByRole("button", { name: "Copy image" });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(copy.dataset.copied).toBe("false");
  });

  it("offers no copy button without onCopy, or when the image is unavailable", () => {
    const { unmount } = render(<ScreenshotViewer src="kaipu-media://screenshot/a" />);
    expect(screen.queryByRole("button", { name: "Copy image" })).toBeNull();
    unmount();
    render(<ScreenshotViewer src={null} onCopy={async () => true} />);
    expect(screen.queryByRole("button", { name: "Copy image" })).toBeNull();
  });
});
