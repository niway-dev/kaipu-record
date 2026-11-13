import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolPanel } from "./tool-panel";
import { ANNOTATION_COLORS } from "../annotations/tools";
import type { Annotation } from "../annotations/scene";
import type { EditorScene } from "../annotations/use-editor-scene";
import type { AnnotationToolsController } from "../annotations/use-annotation-tools";
import type { TextToolStatus } from "../text-selection";

// The panel only places controls that AnnotationOptions, ExportFrameCard and InspectBar already
// test: what is pinned here is which of them appear for which tool, and the empty state.

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
    redactionStyle: "blur",
    setRedactionStyle: vi.fn(),
    stepSize: 1,
    setStepSize: vi.fn(),
    ...overrides,
  };
}

function makeScene(annotations: Annotation[] = [], selectedId: string | null = null): EditorScene {
  return {
    beautify: {} as EditorScene["beautify"],
    annotations,
    selectedId,
    select: vi.fn(),
    addAnnotation: vi.fn(),
    commitAnnotation: vi.fn(),
    beginInteract: vi.fn(),
    endInteract: vi.fn(),
    removeAnnotation: vi.fn(),
    removeSelected: vi.fn(),
    crop: undefined,
    setCrop: vi.fn(),
    setExportFrame: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
  };
}

const COLOR = ANNOTATION_COLORS[0].value;
const box: Annotation = {
  id: "b1",
  kind: "box",
  x: 0,
  y: 0,
  w: 0.2,
  h: 0.2,
  color: COLOR,
  stroke: 1,
  seed: 1,
};
const text: Annotation = {
  id: "t1",
  kind: "text",
  x: 0.5,
  y: 0.5,
  text: "Hi",
  color: COLOR,
  size: 1,
};
const blur: Annotation = { id: "u1", kind: "blur", x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

const state = () => document.querySelector('[data-ui-area="editorImage.toolPanel"]');

describe("ToolPanel", () => {
  describe("empty state", () => {
    it("says no tool is selected with the Select tool and nothing selected", () => {
      render(<ToolPanel tools={makeTools()} scene={makeScene()} />);
      expect(state()).toHaveAttribute("data-state", "empty");
      expect(screen.getByText("No tool selected")).toBeInTheDocument();
      expect(
        screen.getByText("Pick a tool in the toolbar to see its options here."),
      ).toBeInTheDocument();
    });

    it("says the tool has no options for the classic Blur tool, which has none without the canvas", () => {
      render(<ToolPanel tools={makeTools({ tool: "blur" })} scene={makeScene()} />);
      expect(state()).toHaveAttribute("data-state", "empty");
      expect(screen.getByText("This tool has no options")).toBeInTheDocument();
      expect(screen.queryByText("No tool selected")).toBeNull();
    });

    it("goes away as soon as a tool with options is active", () => {
      render(<ToolPanel tools={makeTools({ tool: "box" })} scene={makeScene()} />);
      expect(screen.queryByTestId("tool-panel-empty")).toBeNull();
    });
  });

  describe("each tool's options render in the panel", () => {
    it.each(["pen", "box", "arrow"] as const)("%s: Color and Stroke", (tool) => {
      render(<ToolPanel tools={makeTools({ tool })} scene={makeScene()} />);
      expect(state()).toHaveAttribute("data-state", "stroke");
      expect(screen.getByText("Color")).toBeInTheDocument();
      expect(screen.getByText("Stroke")).toBeInTheDocument();
    });

    it("text: Color and Size, and a pick sets the next size", () => {
      const tools = makeTools({ tool: "text" });
      render(<ToolPanel tools={tools} scene={makeScene()} />);
      expect(state()).toHaveAttribute("data-state", "size");
      expect(screen.getByText("Color")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Size L" }));
      expect(tools.setTextSize).toHaveBeenCalledWith(3);
    });

    it("step: Color and Size", () => {
      render(<ToolPanel tools={makeTools({ tool: "step" })} scene={makeScene()} />);
      expect(screen.getByText("Color")).toBeInTheDocument();
      expect(screen.getByText("Size")).toBeInTheDocument();
    });

    it("Redact in canvas mode: the Blur / Solid style and its note", () => {
      const tools = makeTools({ tool: "blur" });
      render(<ToolPanel tools={tools} scene={makeScene()} canvasMode />);
      expect(state()).toHaveAttribute("data-state", "redact");
      fireEvent.click(screen.getByRole("button", { name: "Solid" }));
      expect(tools.setRedactionStyle).toHaveBeenCalledWith("solid");
      expect(
        screen.getByText(
          "Only Solid hides content for certain. Blur keeps a trace of the original colors.",
        ),
      ).toBeInTheDocument();
    });

    it("classic Crop: the Reset row", () => {
      render(<ToolPanel tools={makeTools({ tool: "crop" })} scene={makeScene()} />);
      expect(state()).toHaveAttribute("data-state", "crop");
      expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    });

    it("Export frame in canvas mode: the card, which Fit and Remove drive", () => {
      const onFit = vi.fn();
      const onRemove = vi.fn();
      render(
        <ToolPanel
          tools={makeTools({ tool: "crop" })}
          scene={makeScene()}
          canvasMode
          exportFrame={{ hasFrame: true, onFit, onRemove }}
        />,
      );
      expect(state()).toHaveAttribute("data-state", "crop");
      expect(document.querySelector('[data-ui-area="editorImage.exportFrameCard"]')).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Fit to content" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      expect(onFit).toHaveBeenCalledTimes(1);
      expect(onRemove).toHaveBeenCalledTimes(1);
      // Not the classic Crop / Reset row as well.
      expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    });

    it("Export frame in canvas mode: Done leaves the tool for Select and keeps the frame", () => {
      const tools = makeTools({ tool: "crop" });
      const onRemove = vi.fn();
      render(
        <ToolPanel
          tools={tools}
          scene={makeScene()}
          canvasMode
          exportFrame={{ hasFrame: true, onFit: vi.fn(), onRemove }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(tools.setTool).toHaveBeenCalledWith("select");
      expect(onRemove).not.toHaveBeenCalled();
    });

    it("Select text: the recognition status, Select all and Copy text", () => {
      const textTool: TextToolStatus = {
        status: "ready",
        wordCount: 3,
        selectedCount: 2,
        onCopy: vi.fn(),
        onSelectAll: vi.fn(),
      };
      render(
        <ToolPanel
          tools={makeTools({ tool: "selectText" })}
          scene={makeScene()}
          textTool={textTool}
        />,
      );
      expect(state()).toHaveAttribute("data-state", "selectText");
      expect(screen.getByText("3 words found")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
      expect(textTool.onCopy).toHaveBeenCalledTimes(1);
    });
  });

  describe("a selected annotation's options", () => {
    it("a box: Color, Stroke and Delete, with the Select tool active", () => {
      const scene = makeScene([box], "b1");
      render(<ToolPanel tools={makeTools()} scene={scene} />);
      expect(state()).toHaveAttribute("data-state", "stroke");
      expect(screen.getByText("Stroke")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
      expect(scene.removeSelected).toHaveBeenCalledTimes(1);
    });

    it("a text: Size, which edits that label", () => {
      const scene = makeScene([text], "t1");
      render(<ToolPanel tools={makeTools()} scene={scene} />);
      fireEvent.click(screen.getByRole("button", { name: "Size L" }));
      expect(scene.commitAnnotation).toHaveBeenCalledWith("t1", { size: 3 });
    });

    it("a redaction in canvas mode: its style and Delete", () => {
      const scene = makeScene([blur], "u1");
      render(<ToolPanel tools={makeTools()} scene={scene} canvasMode />);
      expect(state()).toHaveAttribute("data-state", "redact");
      fireEvent.click(screen.getByRole("button", { name: "Solid" }));
      expect(scene.commitAnnotation).toHaveBeenCalledWith("u1", { style: "solid" });
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });

    it("a selection with no other options (a classic blur) still offers Delete, not the empty state", () => {
      render(<ToolPanel tools={makeTools()} scene={makeScene([blur], "u1")} />);
      expect(state()).toHaveAttribute("data-state", "selection");
      expect(screen.queryByTestId("tool-panel-empty")).toBeNull();
      expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    });
  });
});
