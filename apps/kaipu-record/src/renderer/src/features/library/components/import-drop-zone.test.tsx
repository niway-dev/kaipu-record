import { describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useFileDrop } from "../hooks/use-file-drop";
import { ImportDropZone } from "./import-drop-zone";

/** The Library page's wiring in miniature: the window is the drop target, the zone shows it. */
function DropTarget({ onFiles, onPick }: { onFiles(files: File[]): void; onPick(): void }) {
  const drop = useFileDrop(onFiles);
  return (
    <div data-testid="page">
      <span>
        <i data-testid="child" />
      </span>
      <ImportDropZone active={drop.dragging} importing={false} onPick={onPick} />
    </div>
  );
}

const fileDrag = (files: File[] = []) => ({ dataTransfer: { types: ["Files"], files } });

describe("ImportDropZone + useFileDrop", () => {
  it("lights up while files are over the window, through child enter/leave pairs", () => {
    render(<DropTarget onFiles={vi.fn()} onPick={vi.fn()} />);
    const page = screen.getByTestId("page");
    const zone = screen.getByTestId("import-drop-zone");

    expect(zone).toHaveTextContent("Drop a video here — from your phone, Zoom, another app");
    fireEvent.dragEnter(page, fileDrag());
    fireEvent.dragEnter(screen.getByTestId("child"), fileDrag());
    fireEvent.dragLeave(page, fileDrag());
    expect(zone).toHaveAttribute("data-active", "true");
    expect(zone).toHaveTextContent("Drop to import into your Library");
    fireEvent.dragLeave(screen.getByTestId("child"), fileDrag());
    expect(zone).toHaveAttribute("data-active", "false");
  });

  it("hands the dropped files over and accepts the drop", () => {
    const onFiles = vi.fn();
    render(<DropTarget onFiles={onFiles} onPick={vi.fn()} />);
    const page = screen.getByTestId("page");
    const clip = new File(["x"], "clip.mov");

    fireEvent.dragEnter(page, fileDrag());
    const drop = createEvent.drop(page, fileDrag([clip]));
    fireEvent(page, drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([clip]);
    expect(screen.getByTestId("import-drop-zone")).toHaveAttribute("data-active", "false");
  });

  it("ignores drags that carry no files (text, links)", () => {
    const onFiles = vi.fn();
    render(<DropTarget onFiles={onFiles} onPick={vi.fn()} />);
    const page = screen.getByTestId("page");
    const text = { dataTransfer: { types: ["text/plain"], files: [] } };

    fireEvent.dragEnter(page, text);
    const drop = createEvent.drop(page, text);
    fireEvent(page, drop);

    expect(screen.getByTestId("import-drop-zone")).toHaveAttribute("data-active", "false");
    expect(drop.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const onFiles = vi.fn();
    const { unmount } = render(<DropTarget onFiles={onFiles} onPick={vi.fn()} />);
    unmount();
    const drop = createEvent.drop(document.body, fileDrag([new File(["x"], "clip.mp4")]));
    fireEvent(document.body, drop);
    expect(drop.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("opens the file dialog when clicked", () => {
    const onPick = vi.fn();
    render(<DropTarget onFiles={vi.fn()} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("import-drop-zone"));
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("is disabled and says so while an import runs", () => {
    render(<ImportDropZone active={false} importing onPick={vi.fn()} />);
    const zone = screen.getByTestId("import-drop-zone");
    expect(zone).toBeDisabled();
    expect(zone).toHaveTextContent("Importing…");
  });
});
