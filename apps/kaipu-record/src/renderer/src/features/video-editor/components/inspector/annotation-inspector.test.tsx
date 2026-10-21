import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ANNOTATION_COLORS } from "@renderer/features/screenshots/annotations";
import type { VideoOverlay } from "../../scene";
import type { VideoToolsController } from "../../annotations/video-tools";
import { AnnotationDefaultsPanel, AnnotationInspector } from "./annotation-inspector";

function makeTools(overrides: Partial<VideoToolsController> = {}): VideoToolsController {
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

const box: VideoOverlay = {
  id: "b1",
  kind: "box",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: ANNOTATION_COLORS[0].value,
  stroke: 0,
  seed: 1,
  start: 0,
  end: 5,
};

const text: VideoOverlay = {
  id: "t1",
  kind: "text",
  x: 0.5,
  y: 0.5,
  text: "Hi",
  color: ANNOTATION_COLORS[0].value,
  size: 1,
  start: 0,
  end: 5,
};

describe("AnnotationInspector", () => {
  it("shows the Text header and the size picker for a selected text overlay", () => {
    render(
      <AnnotationInspector
        overlay={text}
        tools={makeTools()}
        range={{ start: 0, end: 5 }}
        onCommitOverlay={vi.fn()}
        onRemove={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Text" })).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.queryByText("Stroke")).toBeNull();
    expect(screen.getByText("0:00.0 → 0:05.0")).toBeInTheDocument();
  });

  it("shows the Box header and the stroke picker for a selected box overlay", () => {
    render(
      <AnnotationInspector
        overlay={box}
        tools={makeTools()}
        range={{ start: 0, end: 5 }}
        onCommitOverlay={vi.fn()}
        onRemove={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Box" })).toBeInTheDocument();
    expect(screen.getByText("Stroke")).toBeInTheDocument();
    expect(screen.queryByText("Size")).toBeNull();
  });

  it("recolours the selection and makes that the current tool colour (sticks)", () => {
    const onCommitOverlay = vi.fn();
    const tools = makeTools();
    render(
      <AnnotationInspector
        overlay={box}
        tools={tools}
        range={{ start: 0, end: 5 }}
        onCommitOverlay={onCommitOverlay}
        onRemove={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "White" }));
    expect(onCommitOverlay).toHaveBeenCalledWith("b1", { color: ANNOTATION_COLORS[2].value });
    expect(tools.setColor).toHaveBeenCalledWith(ANNOTATION_COLORS[2].value);
  });

  it("edits the size of a selected text overlay and sticks it as the tool default", () => {
    const onCommitOverlay = vi.fn();
    const tools = makeTools();
    render(
      <AnnotationInspector
        overlay={text}
        tools={tools}
        range={{ start: 0, end: 5 }}
        onCommitOverlay={onCommitOverlay}
        onRemove={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Size L" }));
    // `fontPx` is cleared, not just left behind. It WINS over the preset, so writing
    // only `size` left the label unchanged and the control out of sync with the text
    // — you clicked L and nothing happened.
    //
    // Asserted on the key's PRESENCE, not with toHaveBeenCalledWith: vitest's deep
    // equality ignores properties whose value is undefined, so `{ size: 3 }` and
    // `{ size: 3, fontPx: undefined }` compare equal and the assertion would pass
    // against the very bug it is here to catch.
    const [, patch] = onCommitOverlay.mock.calls.at(-1)!;
    expect(patch).toMatchObject({ size: 3 });
    expect(Object.hasOwn(patch, "fontPx")).toBe(true);
    expect((patch as { fontPx?: number }).fontPx).toBeUndefined();
    expect(tools.setTextSize).toHaveBeenCalledWith(3);
  });

  describe("a label sized by dragging a corner", () => {
    function renderOverlay(overlay: VideoOverlay): void {
      render(
        <AnnotationInspector
          overlay={overlay}
          tools={makeTools()}
          range={{ start: 0, end: 5 }}
          onCommitOverlay={vi.fn()}
          onRemove={vi.fn()}
          onRemoved={vi.fn()}
        />,
      );
    }

    it("highlights no preset, because none of them is the size on screen", () => {
      renderOverlay({ ...text, fontPx: 64 });
      for (const label of ["XS", "S", "M", "L"]) {
        expect(screen.getByRole("button", { name: `Size ${label}` }).className).not.toMatch(
          /pickerOn/,
        );
      }
    });

    it("shows a Custom chip instead", () => {
      renderOverlay({ ...text, fontPx: 64 });
      expect(screen.getByRole("button", { name: /custom/i })).toBeInTheDocument();
    });

    it("offers no Custom chip while a preset is in force", () => {
      renderOverlay(text);
      expect(screen.queryByRole("button", { name: /custom/i })).toBeNull();
    });
  });

  it("edits the stroke width of a selected box overlay and sticks it as the tool default", () => {
    const onCommitOverlay = vi.fn();
    const tools = makeTools();
    render(
      <AnnotationInspector
        overlay={box}
        tools={tools}
        range={{ start: 0, end: 5 }}
        onCommitOverlay={onCommitOverlay}
        onRemove={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stroke 2" }));
    expect(onCommitOverlay).toHaveBeenCalledWith("b1", { stroke: 1 });
    expect(tools.setStroke).toHaveBeenCalledWith(1);
  });

  it("removes the overlay and clears the selection", () => {
    const onRemove = vi.fn();
    const onRemoved = vi.fn();
    render(
      <AnnotationInspector
        overlay={box}
        tools={makeTools()}
        range={{ start: 0, end: 5 }}
        onCommitOverlay={vi.fn()}
        onRemove={onRemove}
        onRemoved={onRemoved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Remove annotation/ }));
    expect(onRemove).toHaveBeenCalledWith("b1");
    expect(onRemoved).toHaveBeenCalled();
  });

  it("omits the range line when there is no mapped timeline range", () => {
    render(
      <AnnotationInspector
        overlay={box}
        tools={makeTools()}
        range={null}
        onCommitOverlay={vi.fn()}
        onRemove={vi.fn()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.queryByText(/→/)).toBeNull();
  });
});

describe("AnnotationDefaultsPanel", () => {
  it("drives the tool defaults for the active drawing tool, with no commit involved", () => {
    const tools = makeTools({ tool: "arrow" });
    render(<AnnotationDefaultsPanel tools={tools} />);

    expect(screen.getByRole("heading", { name: "Next annotation" })).toBeInTheDocument();
    expect(screen.getByText("Style for the next annotation you draw.")).toBeInTheDocument();
    expect(screen.getByText("Stroke")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "White" }));
    expect(tools.setColor).toHaveBeenCalledWith(ANNOTATION_COLORS[2].value);

    fireEvent.click(screen.getByRole("button", { name: "Stroke 2" }));
    expect(tools.setStroke).toHaveBeenCalledWith(1);
  });

  it("shows the size picker for the text tool", () => {
    render(<AnnotationDefaultsPanel tools={makeTools({ tool: "text" })} />);
    expect(screen.getByText("Size")).toBeInTheDocument();
  });

  it("renders nothing for the select tool", () => {
    const { container } = render(<AnnotationDefaultsPanel tools={makeTools({ tool: "select" })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a privacy tool", () => {
    const { container } = render(<AnnotationDefaultsPanel tools={makeTools({ tool: "blur" })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
