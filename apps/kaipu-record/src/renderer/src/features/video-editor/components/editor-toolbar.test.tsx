import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EditorToolbar,
  EditorToolRail,
  type EditorToolbarProps,
  type EditorToolRailProps,
} from "./editor-toolbar";

function renderToolbar(overrides: Partial<EditorToolbarProps> = {}): EditorToolbarProps {
  const props: EditorToolbarProps = {
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSplit: vi.fn(),
    splitDisabled: false,
    onDeleteSelected: vi.fn(),
    deleteDisabled: false,
    onAddImage: vi.fn(),
    tool: "select",
    onExport: vi.fn(),
    exportDisabled: false,
    ...overrides,
  };
  render(<EditorToolbar {...props} />);
  return props;
}

/** The drawing and camera tools now live in the vertical rail beside the preview. */
function renderRail(overrides: Partial<EditorToolRailProps> = {}): EditorToolRailProps {
  const props: EditorToolRailProps = {
    tool: "select",
    onToolChange: vi.fn(),
    onAddZoom: vi.fn(),
    privacyDisabled: false,
    ...overrides,
  };
  render(<EditorToolRail {...props} />);
  return props;
}

describe("EditorToolbar", () => {
  it("renders the six actions", () => {
    renderToolbar();
    for (const name of ["Undo", "Redo", "Add image", "Split here", "Delete segment", "Export"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("fires onExport on click, and is disabled per exportDisabled", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(props.onExport).toHaveBeenCalledOnce();

    renderToolbar({ exportDisabled: true });
    const exportButtons = screen.getAllByRole("button", { name: "Export" });
    expect(exportButtons[exportButtons.length - 1]).toBeDisabled();
  });

  it("renders the four annotation tools and highlights the active one", () => {
    renderRail({ tool: "box" });
    for (const name of ["Select", "Box", "Arrow", "Text"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Box" }).className).toMatch(/toolActive/);
    expect(screen.getByRole("button", { name: "Select" }).className).not.toMatch(/toolActive/);
  });

  it("fires onToolChange with the picked tool", () => {
    const props = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
    expect(props.onToolChange).toHaveBeenCalledWith("arrow");
  });

  it("fires the matching callback on click", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(props.onRedo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Split here" }));
    expect(props.onSplit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete segment" }));
    expect(props.onDeleteSelected).toHaveBeenCalledOnce();
  });

  it("clicking Add image opens the hidden file input, and picking a file fires onAddImage", () => {
    const props = renderToolbar();
    const input = screen.getByTestId("slide-image-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    expect(clickSpy).toHaveBeenCalledOnce();

    const file = new File(["fake-bytes"], "slide.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onAddImage).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");
  });

  it("disables buttons per props, and a disabled button fires no callback", () => {
    const props = renderToolbar({
      canUndo: false,
      canRedo: false,
      splitDisabled: true,
      deleteDisabled: true,
    });
    const undoBtn = screen.getByRole("button", { name: "Undo" });
    const redoBtn = screen.getByRole("button", { name: "Redo" });
    const splitBtn = screen.getByRole("button", { name: "Split here" });
    const deleteBtn = screen.getByRole("button", { name: "Delete segment" });

    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
    expect(splitBtn).toBeDisabled();
    expect(deleteBtn).toBeDisabled();

    fireEvent.click(undoBtn);
    fireEvent.click(redoBtn);
    fireEvent.click(splitBtn);
    fireEvent.click(deleteBtn);
    expect(props.onUndo).not.toHaveBeenCalled();
    expect(props.onRedo).not.toHaveBeenCalled();
    expect(props.onSplit).not.toHaveBeenCalled();
    expect(props.onDeleteSelected).not.toHaveBeenCalled();
  });
});

describe("EditorToolRail — v2 camera group", () => {
  it("the Zoom button fires onAddZoom", () => {
    const props = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    expect(props.onAddZoom).toHaveBeenCalledTimes(1);
  });

  it("shows the hint of the active tool", () => {
    renderToolbar({ tool: "arrow" });
    expect(screen.getByText("Drag on the preview to draw an arrow.")).toBeInTheDocument();
  });
});

describe("EditorToolbar — v2 tooltip shortcuts (PR 10 polish)", () => {
  it("appends the shortcut to every button with one, without changing its accessible name", () => {
    // The convention spans both pieces of the chrome since the tools moved into
    // the rail; rendering one would silently stop covering half the buttons.
    renderRail();
    renderToolbar();
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute("title", "Select (V)");
    expect(screen.getByRole("button", { name: "Box" })).toHaveAttribute("title", "Box (R)");
    expect(screen.getByRole("button", { name: "Arrow" })).toHaveAttribute("title", "Arrow (A)");
    expect(screen.getByRole("button", { name: "Text" })).toHaveAttribute("title", "Text (T)");
    expect(screen.getByRole("button", { name: "Zoom" }).getAttribute("title")).toMatch(/\(Z\)$/);
    expect(screen.getByRole("button", { name: "Blur" })).toHaveAttribute("title", "Blur (B)");
    expect(screen.getByRole("button", { name: "Cover" })).toHaveAttribute("title", "Cover (C)");
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute("title", "Undo (⌘Z)");
    expect(screen.getByRole("button", { name: "Redo" })).toHaveAttribute("title", "Redo (⌘⇧Z)");
    expect(screen.getByRole("button", { name: "Split here" })).toHaveAttribute(
      "title",
      "Split here (S)",
    );
    expect(screen.getByRole("button", { name: "Delete segment" })).toHaveAttribute(
      "title",
      "Delete segment (⌫)",
    );
  });
});

describe("EditorToolRail — v2 privacy tools", () => {
  it("activates Blur and Cover as tools", () => {
    const props = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Blur" }));
    expect(props.onToolChange).toHaveBeenCalledWith("blur");
    fireEvent.click(screen.getByRole("button", { name: "Cover" }));
    expect(props.onToolChange).toHaveBeenCalledWith("cover");
  });

  it("disables them over a slide", () => {
    renderRail({ privacyDisabled: true });
    expect(screen.getByRole("button", { name: "Blur" })).toBeDisabled();
  });
});
