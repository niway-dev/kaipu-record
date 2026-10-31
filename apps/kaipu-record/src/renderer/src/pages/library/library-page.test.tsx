import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import {
  __resetReadyCopiesForTests,
  markCopySeen,
  noteFinishedCopy,
  getReadyCopies,
  noteReadyCardsShown,
  retireReadyCards,
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
  {
    ...base,
    id: "y",
    assetId: "asset-copy",
    title: "Master (YouTube)",
    createdAt: 2,
    derivedFromAssetId: "asset-master",
    fileSizeBytes: 566_000_000,
    durationSeconds: 182,
    export: { preset: "youtube-1440", fingerprint: "whole#2560x1440-v1" },
  },
  {
    ...base,
    id: "z",
    assetId: "asset-gh",
    title: "Master (GitHub)",
    createdAt: 3,
    derivedFromAssetId: "asset-master",
    export: { preset: "light", fingerprint: "whole#q33-24fps-kfi10" },
  },
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
      { path: "/library/:assetId", element: <div>detail-page</div> },
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

describe("LibraryPage: no import door", () => {
  it("has no drop strip and no Prepare or Import buttons: Export is where videos come in", () => {
    renderLibrary();
    expect(screen.queryByText(/Drop a video here/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare a video" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import a video" })).toBeNull();
  });

  it("does not take a video dropped on the window", async () => {
    window.electronAPI.importVideoFiles = vi.fn(async () => nothingImported);
    // A real path, so the drop would import if anything on the page caught it.
    const pathForFile = vi
      .spyOn(window.electronAPI, "pathForFile")
      .mockImplementation((f: File) => `/Users/me/Movies/${f.name}`);
    renderLibrary();
    const files = [new File(["x"], "Zoom Meeting.mp4")];
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ["Files"], files } });
    // true: nobody called preventDefault, so no drop target took it.
    expect(fireEvent.drop(document.body, { dataTransfer: { types: ["Files"], files } })).toBe(true);
    await act(async () => {});
    expect(window.electronAPI.importVideoFiles).not.toHaveBeenCalled();
    pathForFile.mockRestore();
  });
});

describe("LibraryPage ready copies (NIW2-586)", () => {
  it("says how many copies are ready and outlines them until each is opened", () => {
    noteFinishedCopy("asset-copy");
    // A copy no longer in the Library (deleted) is not counted.
    noteFinishedCopy("asset-gone");
    // Past its Ready to upload card: the regular card carries the outline.
    act(() => {
      noteReadyCardsShown(["asset-copy"]);
      retireReadyCards();
    });
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

const readyCard = (name: string): HTMLElement =>
  screen.getByRole("article", { name: `${name} is ready to upload` });

describe("LibraryPage Ready to upload card", () => {
  it("leads the grid with the copy that just finished, in place of its regular card", () => {
    noteFinishedCopy("asset-copy", { destination: "youtube", width: 2560, height: 1440 });
    renderLibrary();
    const ready = readyCard("Master (YouTube)");
    const grid = ready.parentElement!;
    expect(grid.firstElementChild).toBe(ready);
    expect(ready).toHaveTextContent("Ready to upload");
    expect(ready).toHaveTextContent("Master (YouTube).mp4");
    expect(ready).toHaveTextContent("For YouTube");
    expect(ready).toHaveTextContent("2560 × 1440 · 3:02 · 566 MB · from the original");
    // Not twice: the regular card steps aside while the ready card shows.
    expect(screen.queryByText("Master (YouTube)", { selector: "p" })).toBeNull();
  });

  it("shows one card per finished copy, newest first", () => {
    noteFinishedCopy("asset-copy", { destination: "youtube" });
    noteFinishedCopy("asset-gh", { destination: "github" });
    renderLibrary();
    const cards = screen.getAllByRole("article");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Master (GitHub) is ready to upload",
      "Master (YouTube) is ready to upload",
    ]);
  });

  it("Show in Finder reveals the file; Drag to YouTube Studio drags it out", () => {
    const reveal = vi.spyOn(window.electronAPI, "revealLocalRecording");
    const drag = vi.spyOn(window.electronAPI, "startFileDrag");
    noteFinishedCopy("asset-copy", { destination: "youtube" });
    renderLibrary();
    const ready = readyCard("Master (YouTube)");
    fireEvent.click(within(ready).getByRole("button", { name: "Show in Finder" }));
    expect(reveal).toHaveBeenCalledWith("y");
    const dragButton = within(ready).getByRole("button", {
      name: "Drag Master (YouTube).mp4 out of Kaipu",
    });
    expect(dragButton).toHaveTextContent("Drag to YouTube Studio");
    expect(dragButton).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(dragButton);
    expect(drag).toHaveBeenCalledWith("y", "Master (YouTube)");
    // Acting on it counts as seeing it, once the user leaves the Library; the card stays now.
    expect(getReadyCopies().copies[0]).toMatchObject({ shown: true, actedOn: true, card: true });
    act(() => retireReadyCards());
    expect(getReadyCopies().copies).toEqual([]);
    reveal.mockRestore();
    drag.mockRestore();
  });

  it("a copy that finishes while the Library is in list view keeps its card after leaving", () => {
    renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    // List view has no Ready to upload cards: this one was never on screen.
    act(() => noteFinishedCopy("asset-copy", { destination: "youtube" }));
    act(() => retireReadyCards());
    expect(getReadyCopies().copies[0]).toMatchObject({ card: true });
  });

  it("closing it brings back the regular card, still outlined as unseen", () => {
    noteFinishedCopy("asset-copy", { destination: "youtube" });
    renderLibrary();
    fireEvent.click(
      within(readyCard("Master (YouTube)")).getByRole("button", { name: "Close this card" }),
    );
    expect(screen.queryByRole("article")).toBeNull();
    expect(card("Master (YouTube)")).toHaveAttribute("data-just-ready", "true");
  });

  it("opening the copy goes to its page and forgets it", async () => {
    noteFinishedCopy("asset-copy", { destination: "youtube" });
    const router = renderLibrary();
    await act(async () => {
      fireEvent.click(within(readyCard("Master (YouTube)")).getByText("Master (YouTube).mp4"));
    });
    expect(router.state.location.pathname).toBe("/library/asset-copy");
  });
});

describe("LibraryPage grid tags", () => {
  it("tags a copy with its destination, read back from the file, and the original as the master", () => {
    renderLibrary();
    expect(card("Master (YouTube)")).toHaveTextContent("For YouTube");
    expect(card("Master (GitHub)")).toHaveTextContent("For GitHub");
    expect(card("Master")).toHaveTextContent("Master · full quality");
    expect(card("Master")).not.toHaveTextContent(/For /);
  });
});
