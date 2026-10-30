import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const router = createMemoryRouter(
    [
      { path: "/library", element: <LibraryPage /> },
      { path: "/prepare", element: <div>prepare-page</div> },
    ],
    { initialEntries: ["/library"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  __resetReadyCopiesForTests();
  for (const toast of getToasts()) dismissToast(toast.id);
});

const card = (title: string): HTMLElement =>
  screen.getByText(title, { selector: "p" }).closest("[role='button']")!;

describe("LibraryPage import (NIW2-579)", () => {
  it("opens the file dialog from the header button and from the drop zone", async () => {
    window.electronAPI.importVideos = vi.fn(async () => ({ ...nothingImported, canceled: true }));
    renderLibrary();

    fireEvent.click(screen.getByRole("button", { name: "Import a video" }));
    await waitFor(() => expect(window.electronAPI.importVideos).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("import-drop-zone")).toBeEnabled());
    fireEvent.click(screen.getByTestId("import-drop-zone"));
    await waitFor(() => expect(window.electronAPI.importVideos).toHaveBeenCalledTimes(2));
  });

  it("imports a video dropped anywhere on the window", async () => {
    window.electronAPI.pathForFile = vi.fn((f: File) => `/Users/me/Movies/${f.name}`);
    window.electronAPI.importVideoFiles = vi.fn(async () => nothingImported);
    renderLibrary();

    // Outside the page's own markup (the app shell's sidebar, empty space): still imported.
    const page = document.body;
    const files = [new File(["x"], "Zoom Meeting.mp4")];
    fireEvent.dragEnter(page, { dataTransfer: { types: ["Files"], files } });
    expect(screen.getByTestId("import-drop-zone")).toHaveAttribute("data-active", "true");
    fireEvent.drop(page, { dataTransfer: { types: ["Files"], files } });

    await waitFor(() =>
      expect(window.electronAPI.importVideoFiles).toHaveBeenCalledWith([
        "/Users/me/Movies/Zoom Meeting.mp4",
      ]),
    );
  });

  it("Prepare a video opens Prepare with no recording, where an outside video can be dropped (NIW2-587)", async () => {
    const router = renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Prepare a video" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/prepare"));
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

  it("keeps the ready chip next to the title, before the Prepare and Import actions", () => {
    noteFinishedCopy("asset-copy");
    renderLibrary();
    const title = screen.getByRole("heading", { name: "Library" });
    const chip = screen.getByRole("status");
    const prepare = screen.getByRole("button", { name: "Prepare a video" });
    const importButton = screen.getByRole("button", { name: "Import a video" });
    expect(title.parentElement).toContainElement(chip);
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(chip, prepare)).toBe(true);
    expect(follows(prepare, importButton)).toBe(true);
  });
});
