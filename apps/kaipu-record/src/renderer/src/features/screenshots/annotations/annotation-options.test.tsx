import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnnotationOptions } from "./annotation-options";
import { ANNOTATION_COLORS } from "./tools";
import type { Annotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import type { TextToolStatus } from "../text-selection";

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

function makeScene(annotations: Annotation[], selectedId: string | null): EditorScene {
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

const box: Annotation = {
  id: "b1",
  kind: "box",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: ANNOTATION_COLORS[0].value,
  stroke: 0,
  seed: 1,
};
const text: Annotation = {
  id: "t1",
  kind: "text",
  x: 0.5,
  y: 0.5,
  text: "Hi",
  color: ANNOTATION_COLORS[0].value,
  size: 1,
};
const blur: Annotation = { id: "bl1", kind: "blur", x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

describe("AnnotationOptions", () => {
  it("renders nothing with the select tool and no selection", () => {
    const { container } = render(
      <AnnotationOptions tools={makeTools()} scene={makeScene([], null)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows colour + stroke controls when a drawing tool is active", () => {
    render(<AnnotationOptions tools={makeTools({ tool: "box" })} scene={makeScene([], null)} />);
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Stroke")).toBeInTheDocument();
  });

  it("renders nothing for the blur tool (no colour or stroke)", () => {
    const { container } = render(
      <AnnotationOptions tools={makeTools({ tool: "blur" })} scene={makeScene([], null)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("recolours the selected box and makes that the current colour (sticks)", () => {
    const scene = makeScene([box], "b1");
    const tools = makeTools();
    render(<AnnotationOptions tools={tools} scene={scene} />);

    // Selection-aware: controls appear even though the active tool is "select".
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Stroke")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "White" }));
    // Recolours the selection AND updates the tool default so the next shape matches.
    expect(scene.commitAnnotation).toHaveBeenCalledWith("b1", {
      color: ANNOTATION_COLORS[2].value,
    });
    expect(tools.setColor).toHaveBeenCalledWith(ANNOTATION_COLORS[2].value);
  });

  it("shows the size control and edits a selected text annotation", () => {
    const scene = makeScene([text], "t1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);

    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.queryByText("Stroke")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Size L" }));
    expect(scene.commitAnnotation).toHaveBeenCalledWith("t1", { size: 3 });
  });

  it("offers a delete button for a selected shape and removes it on click", () => {
    const scene = makeScene([box], "b1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(scene.removeSelected).toHaveBeenCalled();
  });

  it("shows a delete button for a selected blur even though it has no colour/stroke", () => {
    const scene = makeScene([blur], "bl1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);

    // No colour/stroke controls for a blur…
    expect(screen.queryByText("Color")).toBeNull();
    expect(screen.queryByText("Stroke")).toBeNull();
    // …but it can still be deleted.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(scene.removeSelected).toHaveBeenCalled();
  });

  it("shows a reset control for the crop tool and clears the crop on click", () => {
    const scene = makeScene([], null);
    scene.crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    scene.setCrop = vi.fn();
    render(<AnnotationOptions tools={makeTools({ tool: "crop" })} scene={scene} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(scene.setCrop).toHaveBeenCalledWith(undefined);
  });

  it("shows a Done button next to Reset that leaves the crop tool for Select and keeps the crop", () => {
    const scene = makeScene([], null);
    scene.crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    scene.setCrop = vi.fn();
    const tools = makeTools({ tool: "crop" });
    render(<AnnotationOptions tools={tools} scene={scene} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(tools.setTool).toHaveBeenCalledWith("select");
    expect(scene.setCrop).not.toHaveBeenCalled();
  });

  it("Done stays enabled with no crop set", () => {
    const scene = makeScene([], null);
    render(<AnnotationOptions tools={makeTools({ tool: "crop" })} scene={scene} />);
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("disables the reset control when there is no crop to reset", () => {
    const scene = makeScene([], null); // crop is undefined
    render(<AnnotationOptions tools={makeTools({ tool: "crop" })} scene={scene} />);
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });
});

/**
 * The same defect as the video editor's, in the other editor, found the same way: by
 * the owner clicking a preset and watching nothing happen. `fontPx` wins over `size`,
 * so a control that writes only `size` lights up while the label stays where a corner
 * drag left it.
 */
describe("a label sized by dragging a corner", () => {
  const custom: Annotation = { ...text, fontPx: 64 };

  it("clears fontPx when a preset is picked, so the preset takes effect", () => {
    const scene = makeScene([custom], "t1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);

    fireEvent.click(screen.getByRole("button", { name: "Size L" }));

    const [, patch] = (scene.commitAnnotation as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(patch).toMatchObject({ size: 3 });
    // The key's PRESENCE, not its value: vitest's deep equality ignores properties
    // whose value is undefined, so comparing whole objects passes against the bug.
    expect(Object.hasOwn(patch, "fontPx")).toBe(true);
  });

  it("highlights no preset while a corner-dragged size is in force", () => {
    render(<AnnotationOptions tools={makeTools()} scene={makeScene([custom], "t1")} />);
    for (const label of ["XS", "S", "M", "L"]) {
      expect(screen.getByRole("button", { name: `Size ${label}` }).className).not.toMatch(
        /pickerOn/,
      );
    }
  });

  describe("redaction style (canvas mode)", () => {
    const blur: Annotation = { id: "u1", kind: "blur", x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const NOTE = "Only Solid hides content for certain. Blur keeps a trace of the original colors.";

    it("is hidden with the flag off, even for a selected blur", () => {
      render(<AnnotationOptions tools={makeTools()} scene={makeScene([blur], "u1")} />);
      expect(screen.queryByRole("button", { name: "Solid" })).toBeNull();
      expect(screen.queryByText(NOTE)).toBeNull();
    });

    it("shows for the blur tool with the note, and a pick sets the next style", () => {
      const tools = makeTools({ tool: "blur" });
      render(<AnnotationOptions tools={tools} scene={makeScene([], null)} canvasMode />);
      expect(screen.getByText(NOTE)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Blur" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "Solid" }));
      expect(tools.setRedactionStyle).toHaveBeenCalledWith("solid");
    });

    it("switching with a blur selected updates that blur as one change", () => {
      const scene = makeScene([blur], "u1");
      render(<AnnotationOptions tools={makeTools()} scene={scene} canvasMode />);
      fireEvent.click(screen.getByRole("button", { name: "Solid" }));
      expect(scene.commitAnnotation).toHaveBeenCalledTimes(1);
      expect(scene.commitAnnotation).toHaveBeenCalledWith("u1", { style: "solid" });
    });

    it("reflects the selected blur's own style", () => {
      render(
        <AnnotationOptions
          tools={makeTools()}
          scene={makeScene([{ ...blur, style: "solid" }], "u1")}
          canvasMode
        />,
      );
      expect(screen.getByRole("button", { name: "Solid" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    });

    it("stays hidden in canvas mode for a non-blur selection", () => {
      render(<AnnotationOptions tools={makeTools()} scene={makeScene([box], "b1")} canvasMode />);
      expect(screen.queryByText(NOTE)).toBeNull();
    });
  });

  describe("redaction card (canvas mode)", () => {
    const blur: Annotation = { id: "u1", kind: "blur", x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const locked: Annotation = { ...blur, id: "l1", locked: true };

    it("labels the group Style and draws a decorative icon in each choice", () => {
      render(
        <AnnotationOptions
          tools={makeTools({ tool: "blur" })}
          scene={makeScene([], null)}
          canvasMode
        />,
      );
      expect(screen.getByText("Style")).toBeTruthy();
      for (const name of ["Blur", "Solid"]) {
        const icon = screen.getByRole("button", { name }).querySelector("svg");
        expect(icon).not.toBeNull();
        expect(icon!.getAttribute("aria-hidden")).toBe("true");
      }
    });

    it("keeps the note as one text node beside its own icon", () => {
      render(
        <AnnotationOptions
          tools={makeTools({ tool: "blur" })}
          scene={makeScene([], null)}
          canvasMode
        />,
      );
      const note = screen.getByText(
        "Only Solid hides content for certain. Blur keeps a trace of the original colors.",
      );
      expect(note.childNodes).toHaveLength(1);
      expect(note.parentElement!.querySelector("svg")).not.toBeNull();
    });

    it("a selected locked redaction shows the lock line, no picker and no delete", () => {
      render(
        <AnnotationOptions tools={makeTools()} scene={makeScene([locked], "l1")} canvasMode />,
      );
      expect(screen.getByText("Its pixels were removed when it was saved.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Blur" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Solid" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    });

    it("an unlocked selected redaction still has its picker and delete button", () => {
      render(<AnnotationOptions tools={makeTools()} scene={makeScene([blur], "u1")} canvasMode />);
      expect(screen.getByRole("button", { name: "Solid" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    });
  });

  describe("Select text tool", () => {
    const status = (over: Partial<TextToolStatus> = {}): TextToolStatus => ({
      status: "ready",
      wordCount: 3,
      selectedCount: 0,
      onCopy: vi.fn(),
      onSelectAll: vi.fn(),
      ...over,
    });
    const renderText = (text: TextToolStatus | undefined) =>
      render(
        <AnnotationOptions
          tools={makeTools({ tool: "selectText" })}
          scene={makeScene([], null)}
          textTool={text}
        />,
      );

    it("renders nothing without the flag", () => {
      const { container } = renderText(undefined);
      expect(container).toBeEmptyDOMElement();
    });

    it.each([
      ["pending", { status: "pending" as const }, "Recognizing text…"],
      ["unavailable", { status: "unavailable" as const }, "Text recognition is not available"],
      ["noText", { wordCount: 0 }, "No text found"],
      ["ready", {}, "3 words found"],
    ])("%s", (state, over, message) => {
      renderText(status(over));
      expect(screen.getByRole("status")).toHaveAttribute("data-state", state);
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it("Copy text needs a selection; Select all does not", () => {
      const text = status();
      const { rerender } = renderText(text);
      expect(screen.getByRole("button", { name: "Copy text" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Select all" }));
      expect(text.onSelectAll).toHaveBeenCalledTimes(1);
      const withSelection = status({ selectedCount: 2 });
      rerender(
        <AnnotationOptions
          tools={makeTools({ tool: "selectText" })}
          scene={makeScene([], null)}
          textTool={withSelection}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy text" }));
      expect(withSelection.onCopy).toHaveBeenCalledTimes(1);
    });

    it("offers no actions while pending", () => {
      renderText(status({ status: "pending" }));
      expect(screen.queryByRole("button", { name: "Copy text" })).toBeNull();
    });
  });
});

describe("AnnotationOptions - measure (NIW2-702)", () => {
  const ruler: Annotation = {
    id: "m1",
    kind: "measure",
    axis: "x",
    from: 0,
    to: 10,
    at: 0,
    imageW: 100,
    imageH: 100,
    color: ANNOTATION_COLORS[0].value,
  };

  it("offers colour swatches only, and recolours the selection", () => {
    const scene = makeScene([ruler], "m1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.queryByText("Stroke")).toBeNull();
    expect(screen.queryByText("Size")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    expect(scene.commitAnnotation).toHaveBeenCalledWith("m1", {
      color: ANNOTATION_COLORS[2].value,
    });
  });
});

describe("AnnotationOptions — step delete line (NIW2-713)", () => {
  it("shows the renumber line for a selected step and deletes on click", () => {
    const step: Annotation = { id: "s1", kind: "step", x: 0.5, y: 0.5, color: "#f6055c", size: 1 };
    const scene = makeScene([step], "s1");
    render(<AnnotationOptions tools={makeTools()} scene={scene} />);
    // The visible text is the accessible name (no aria-label hiding it), so a screen reader
    // hears the renumbering warning and voice control can say what it sees.
    const line = screen.getByRole("button", { name: "Delete renumbers the rest" });
    fireEvent.click(line);
    expect(scene.removeSelected).toHaveBeenCalledTimes(1);
  });

  it("keeps the icon delete button for other kinds", () => {
    render(<AnnotationOptions tools={makeTools()} scene={makeScene([box], "b1")} />);
    expect(screen.queryByText("Delete renumbers the rest")).toBeNull();
  });
});
