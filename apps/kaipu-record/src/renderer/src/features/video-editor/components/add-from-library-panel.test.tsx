import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { RECORDING_DRAG_MIME } from "../add-from-library";
import { AddFromLibraryPanel, type AddFromLibraryPanelProps } from "./add-from-library-panel";

function video(over: Partial<LibraryVideo> & { assetId: string }): LibraryVideo {
  return {
    id: `id-${over.assetId}`,
    kind: "recording",
    title: `Title ${over.assetId}`,
    createdAt: Date.UTC(2026, 10, 5, 12, 0),
    durationSeconds: 16,
    derivedFromAssetId: null,
    thumbnailUrl: `kaipu-media://thumb/${over.assetId}`,
    capture: { width: 1440, height: 1080 } as never,
    ...over,
  } as LibraryVideo;
}

function renderPanel(over: Partial<AddFromLibraryPanelProps> = {}): AddFromLibraryPanelProps {
  const props: AddFromLibraryPanelProps = {
    videos: [],
    openedAssetId: "opened",
    loaded: true,
    onAdd: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<AddFromLibraryPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe("AddFromLibraryPanel", () => {
  it("is marked as the editorVideo.addFromLibrary area", () => {
    renderPanel();
    expect(document.querySelector('[data-ui-area="editorVideo.addFromLibrary"]')).not.toBeNull();
  });

  it("shows each recording with its thumbnail, title, duration, date and resolution", () => {
    renderPanel({ videos: [video({ assetId: "a", title: "Checkout bug", durationSeconds: 96 })] });
    const row = screen.getByRole("button", { name: "Add Checkout bug" });
    // Decorative (alt=""), so it has no img role: the title names the row.
    expect(row.querySelector("img")).toHaveAttribute("src", "kaipu-media://thumb/a");
    expect(within(row).getByText("Checkout bug")).toBeInTheDocument();
    expect(within(row).getByText("1:36")).toBeInTheDocument();
    expect(within(row).getByText(/Nov 5, 2026/)).toBeInTheDocument();
    expect(within(row).getByText("1440 × 1080")).toBeInTheDocument();
  });

  it("omits the resolution when the capture size is unknown", () => {
    renderPanel({ videos: [video({ assetId: "a", capture: null })] });
    expect(screen.queryByText(/×/)).toBeNull();
  });

  it("draws a placeholder when a recording has no thumbnail", () => {
    renderPanel({ videos: [video({ assetId: "a", thumbnailUrl: null })] });
    const row = screen.getByRole("button", { name: "Add Title a" });
    expect(row.querySelector("img")).toBeNull();
    expect(within(row).getByTestId("add-from-library-placeholder")).toBeInTheDocument();
  });

  it("never lists the recording being edited, an export or a screenshot", () => {
    renderPanel({
      videos: [
        video({ assetId: "opened", title: "Being edited" }),
        video({ assetId: "x", title: "An export", derivedFromAssetId: "opened" }),
        video({ assetId: "s", title: "A frame", kind: "screenshot" }),
        video({ assetId: "ok", title: "Other take" }),
      ],
    });
    expect(screen.getAllByTestId("add-from-library-row")).toHaveLength(1);
    expect(screen.getByText("Other take")).toBeInTheDocument();
  });

  it("filters by the search field and says so when nothing matches", () => {
    renderPanel({
      videos: [
        video({ assetId: "a", title: "Checkout bug" }),
        video({ assetId: "b", title: "Signup flow" }),
      ],
    });
    const search = screen.getByRole("searchbox", { name: "Search recordings" });
    fireEvent.change(search, { target: { value: "sign" } });
    expect(screen.getAllByTestId("add-from-library-row")).toHaveLength(1);
    expect(screen.getByText("Signup flow")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.queryAllByTestId("add-from-library-row")).toHaveLength(0);
    expect(screen.getByText("No recordings match")).toBeInTheDocument();
  });

  it("says there are no other recordings when the Library has none to offer", () => {
    renderPanel({ videos: [video({ assetId: "opened" })] });
    expect(screen.getByText("No other recordings")).toBeInTheDocument();
    // A query over an empty list is still "no other recordings", not "no match".
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "abc" } });
    expect(screen.getByText("No other recordings")).toBeInTheDocument();
  });

  it("says it is loading, and nothing about empty, before the first read lands", () => {
    renderPanel({ loaded: false });
    expect(screen.getByText("Loading recordings…")).toBeInTheDocument();
    expect(screen.queryByText("No other recordings")).toBeNull();
  });

  it("clicking a row calls onAdd with that recording", () => {
    const first = video({ assetId: "a", title: "Checkout bug" });
    const props = renderPanel({ videos: [first, video({ assetId: "b", createdAt: 1 })] });
    fireEvent.click(screen.getByRole("button", { name: "Add Checkout bug" }));
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(props.onAdd).toHaveBeenCalledWith(first);
  });

  it("shows the hint about how recordings go onto the sequence", () => {
    renderPanel({ videos: [video({ assetId: "a" })] });
    expect(screen.getByText(/drag it onto the sequence/)).toBeInTheDocument();
  });

  it("the close button calls onClose", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close Add from Library" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  describe("dragging a row onto the sequence", () => {
    function fakeDataTransfer() {
      return {
        setData: vi.fn(),
        setDragImage: vi.fn(),
        effectAllowed: "none",
        types: [] as string[],
      };
    }

    it("makes every row draggable", () => {
      renderPanel({ videos: [video({ assetId: "a" }), video({ assetId: "b" })] });
      for (const row of screen.getAllByTestId("add-from-library-row")) {
        expect(row).toHaveAttribute("draggable", "true");
      }
    });

    it("starting a drag puts the asset id under the recording type and says which video it is", () => {
      const dragged = video({ assetId: "asset-b", title: "Checkout bug" });
      const props = renderPanel({ videos: [dragged], onDragStart: vi.fn() });
      const dataTransfer = fakeDataTransfer();

      fireEvent.dragStart(screen.getByRole("button", { name: "Add Checkout bug" }), {
        dataTransfer,
      });

      expect(dataTransfer.setData).toHaveBeenCalledWith(RECORDING_DRAG_MIME, "asset-b");
      expect(dataTransfer.effectAllowed).toBe("copy");
      expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
      // The browser hides dataTransfer's contents during dragover: the page keeps the video.
      expect(props.onDragStart).toHaveBeenCalledWith(dragged);
    });

    it("ending the drag, dropped or cancelled, calls onDragEnd", () => {
      const props = renderPanel({ videos: [video({ assetId: "a" })], onDragEnd: vi.fn() });

      fireEvent.dragEnd(screen.getByTestId("add-from-library-row"));

      expect(props.onDragEnd).toHaveBeenCalledTimes(1);
    });
  });
});
