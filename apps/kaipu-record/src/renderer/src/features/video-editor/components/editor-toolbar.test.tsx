import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorToolbar, type EditorToolbarProps } from "./editor-toolbar";

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
    ...overrides,
  };
  render(<EditorToolbar {...props} />);
  return props;
}

describe("EditorToolbar", () => {
  it("renders the four actions", () => {
    renderToolbar();
    for (const name of ["Deshacer", "Rehacer", "Cortar aquí", "Eliminar segmento"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("fires the matching callback on click", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(props.onUndo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Rehacer" }));
    expect(props.onRedo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cortar aquí" }));
    expect(props.onSplit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar segmento" }));
    expect(props.onDeleteSelected).toHaveBeenCalledOnce();
  });

  it("disables buttons per props, and a disabled button fires no callback", () => {
    const props = renderToolbar({
      canUndo: false,
      canRedo: false,
      splitDisabled: true,
      deleteDisabled: true,
    });
    const undoBtn = screen.getByRole("button", { name: "Deshacer" });
    const redoBtn = screen.getByRole("button", { name: "Rehacer" });
    const splitBtn = screen.getByRole("button", { name: "Cortar aquí" });
    const deleteBtn = screen.getByRole("button", { name: "Eliminar segmento" });

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
