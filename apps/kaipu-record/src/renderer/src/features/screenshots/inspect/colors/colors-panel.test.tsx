import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorsPanel } from "./colors-panel";
import type { ColorAnalysis } from "./histogram";
import type { ColorsController } from "./use-colors";

function controller(patch: Partial<ColorsController>): ColorsController {
  return {
    open: true,
    setOpen: vi.fn(),
    toggle: vi.fn(),
    status: "counting",
    progress: 0,
    analysis: null,
    located: null,
    locate: vi.fn(),
    overlay: null,
    ...patch,
  };
}

describe("ColorsPanel while counting", () => {
  it("shows the percentage, a progress bar at that value and four placeholder rows", () => {
    const { container } = render(
      <ColorsPanel
        grouped
        onGroupedChange={() => {}}
        colors={controller({ progress: 0.624 })}
        format="hex"
        reading={false}
      />,
    );
    expect(screen.getByText("Reading colors… 62%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
    expect(container.querySelectorAll('[class*="skeleton"][aria-hidden]')).toHaveLength(4);
  });

  it("shows no percentage while Inspect is still decoding", () => {
    render(
      <ColorsPanel
        grouped
        onGroupedChange={() => {}}
        colors={controller({ status: "idle", progress: null })}
        format="hex"
        reading
      />,
    );
    expect(screen.getByText("Reading colors…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });
});

describe("ColorsPanel photo card", () => {
  const photoAnalysis = (counted: number, counts: number[]): ColorAnalysis => ({
    width: 1,
    height: 1,
    counted,
    distinct: 5000,
    totalGroups: counts.length,
    groups: counts.map((count, id) => ({ id, rgb: id, count, distinct: 1, members: [] })),
    exact: [],
  });
  const ready = (analysis: ColorAnalysis) =>
    render(
      <ColorsPanel
        grouped
        onGroupedChange={() => {}}
        colors={controller({ status: "ready", progress: null, analysis })}
        format="hex"
        reading={false}
      />,
    );

  it("lists every group of at least 1% and says the share they cover", () => {
    // 1000 pixels: three groups are over 1% (10 pixels) and cover 900; the two of 5 are Other.
    ready(photoAnalysis(1000, [400, 300, 200, 5, 5]));
    expect(screen.getByText(/Showing 3 groups covering 90% of the image/)).toBeInTheDocument();
  });

  it("lists only the largest group when none reaches 1%, and does not claim a share it lacks", () => {
    // 200 groups of 2 pixels in 1000 are 0.2% each: the largest is kept, covering 0%.
    ready(
      photoAnalysis(
        1000,
        Array.from({ length: 200 }, () => 2),
      ),
    );
    const body = screen.getByText(/Showing 1 group/);
    expect(body).toHaveTextContent("covering 0% of the image");
    expect(body).not.toHaveTextContent("80%");
  });

  it("does not round an exact share down: 57 of 100 reads 57%, not 56%", () => {
    // 57 / 100 * 100 is 56.99999999999999 in floating point, so the product must come first.
    ready(
      photoAnalysis(
        100,
        Array.from({ length: 57 }, () => 1),
      ),
    );
    expect(screen.getByText(/Showing 57 groups/)).toHaveTextContent("covering 57% of the image");
  });
});
