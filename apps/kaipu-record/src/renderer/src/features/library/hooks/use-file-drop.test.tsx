import { describe, expect, it, vi } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useFileDrop } from "./use-file-drop";

/** A page that makes the window its drop target and shows whether files are over it. */
function DropTarget({ onFiles }: { onFiles(files: File[]): void }) {
  const drop = useFileDrop(onFiles);
  return (
    <div data-testid="page" data-dragging={drop.dragging}>
      <span>
        <i data-testid="child" />
      </span>
    </div>
  );
}

const fileDrag = (files: File[] = []) => ({ dataTransfer: { types: ["Files"], files } });
const dragging = (): string | null => screen.getByTestId("page").getAttribute("data-dragging");

describe("useFileDrop", () => {
  it("says files are over the window, through child enter/leave pairs", () => {
    render(<DropTarget onFiles={vi.fn()} />);
    const page = screen.getByTestId("page");

    expect(dragging()).toBe("false");
    fireEvent.dragEnter(page, fileDrag());
    fireEvent.dragEnter(screen.getByTestId("child"), fileDrag());
    fireEvent.dragLeave(page, fileDrag());
    expect(dragging()).toBe("true");
    fireEvent.dragLeave(screen.getByTestId("child"), fileDrag());
    expect(dragging()).toBe("false");
  });

  it("hands the dropped files over and accepts the drop", () => {
    const onFiles = vi.fn();
    render(<DropTarget onFiles={onFiles} />);
    const page = screen.getByTestId("page");
    const clip = new File(["x"], "clip.mov");

    fireEvent.dragEnter(page, fileDrag());
    const drop = createEvent.drop(page, fileDrag([clip]));
    fireEvent(page, drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([clip]);
    expect(dragging()).toBe("false");
  });

  it("ignores drags that carry no files (text, links)", () => {
    const onFiles = vi.fn();
    render(<DropTarget onFiles={onFiles} />);
    const page = screen.getByTestId("page");
    const text = { dataTransfer: { types: ["text/plain"], files: [] } };

    fireEvent.dragEnter(page, text);
    const drop = createEvent.drop(page, text);
    fireEvent(page, drop);

    expect(dragging()).toBe("false");
    expect(drop.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const onFiles = vi.fn();
    const { unmount } = render(<DropTarget onFiles={onFiles} />);
    unmount();
    const drop = createEvent.drop(document.body, fileDrag([new File(["x"], "clip.mp4")]));
    fireEvent(document.body, drop);
    expect(drop.defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
