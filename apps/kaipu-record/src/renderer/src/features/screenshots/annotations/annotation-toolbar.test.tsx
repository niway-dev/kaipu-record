import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationToolbar } from "./annotation-toolbar";
import { ANNOTATION_COLORS } from "./tools";
import type { AnnotationToolsController } from "./use-annotation-tools";

function makeTools(overrides: Partial<AnnotationToolsController> = {}): AnnotationToolsController {
  return {
    tool: "select",
    setTool: vi.fn(),
    color: ANNOTATION_COLORS[0].value,
    setColor: vi.fn(),
    stroke: 1,
    setStroke: vi.fn(),
    textSize: 1,
    setTextSize: vi.fn(),
    ...overrides,
  };
}

describe("AnnotationToolbar", () => {
  it("renders the four tools and switches tool on click", () => {
    const tools = makeTools();
    render(<AnnotationToolbar tools={tools} />);
    for (const name of ["Select", "Pen", "Box", "Arrow", "Text"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    expect(tools.setTool).toHaveBeenCalledWith("text");
  });

  it("does not render the contextual controls (those live in the options panel)", () => {
    render(<AnnotationToolbar tools={makeTools({ tool: "box" })} />);
    expect(screen.queryByText("Color")).toBeNull();
    expect(screen.queryByText("Stroke")).toBeNull();
  });
});
