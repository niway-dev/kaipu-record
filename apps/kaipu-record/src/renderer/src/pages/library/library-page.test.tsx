import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import {
  __resetReadyCopiesForTests,
  markCopySeen,
  noteFinishedCopy,
} from "@renderer/features/video-editor/export/ready-copies";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { LibraryPage } from "./library-page";

const base: LibraryVideo = {
  id: "x",
  assetId: "asset-master",
  kind: "recording",
  title: "Master",
  createdAt: 1,
  durationSeconds: 95,
  fileSizeBytes: 32_000_000,
  cloudSizeBytes: null,
  thumbnailUrl: null,
  availability: "local",
  comparison: "same",
  editing: "project-available",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  editSavedAt: null,
  editExportedSavedAt: null,
};
const VIDEOS: LibraryVideo[] = [
  base,
  { ...base, id: "y", assetId: "asset-copy", title: "Master (YouTube)", createdAt: 2 },
];
const nothingImported = { imported: [], failed: [], canceled: false };

vi.mock("@renderer/features/library/hooks/use-local-library", () => ({
  useLocalLibrary: () => ({
    videos: VIDEOS,
    isLoading: false,
    hasError: false,
    refresh: vi.fn(),
    remove: vi.fn(),
    setTags: vi.fn(),
  }),
}));
vi.mock("@renderer/features/library/hooks/use-tags", () => ({
  useTags: () => ({ tags: [], byId: new Map() }),
  resolveTags: () => [],
}));
vi.mock("@renderer/features/editor/open-in-editor", () => ({
  useOpenInEditor: () => ({ openItem: vi.fn() }),
  canOpenInEditor: () => false,
}));

function renderLibrary() {
  const router = createMemoryRouter([{ path: "/library", element: <LibraryPage /> }], {
    initialEntries: ["/library"],
  });
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  __resetReadyCopiesForTests();
  for (const toast of getToasts()) dismissToast(toast.id);
});

const card = (title: string): HTMLElement =>
  screen.getByText(title, { selector: "p" }).closest("[role='button']")!;

describe("LibraryPage: no import door", () => {
  it("has no drop strip and no Prepare or Import buttons: Export is where videos come in", () => {
    renderLibrary();
    expect(screen.queryByText(/Drop a video here/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare a video" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import a video" })).toBeNull();
  });

  it("does not take a video dropped on the window", () => {
    window.electronAPI.importVideoFiles = vi.fn(async () => nothingImported);
    renderLibrary();
    const files = [new File(["x"], "Zoom Meeting.mp4")];
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ["Files"], files } });
    fireEvent.drop(document.body, { dataTransfer: { types: ["Files"], files } });
    expect(window.electronAPI.importVideoFiles).not.toHaveBeenCalled();
  });
});

describe("LibraryPage ready copies (NIW2-586)", () => {
  it("says how many copies are ready and outlines them until each is opened", () => {
    noteFinishedCopy("asset-copy");
    // A copy no longer in the Library (deleted) is not counted.
    noteFinishedCopy("asset-gone");
    renderLibrary();
    expect(screen.getByRole("status")).toHaveTextContent("1 copy ready");
    expect(card("Master (YouTube)")).toHaveAttribute("data-just-ready", "true");
    expect(card("Master")).toHaveAttribute("data-just-ready", "false");

    act(() => markCopySeen("asset-copy"));
    expect(screen.queryByText("1 copy ready")).toBeNull();
    expect(card("Master (YouTube)")).toHaveAttribute("data-just-ready", "false");
  });

  it("keeps the ready chip next to the title", () => {
    noteFinishedCopy("asset-copy");
    renderLibrary();
    const title = screen.getByRole("heading", { name: "Library" });
    expect(title.parentElement).toContainElement(screen.getByRole("status"));
  });
});
