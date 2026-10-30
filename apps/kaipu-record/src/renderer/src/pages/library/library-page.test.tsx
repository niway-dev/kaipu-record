import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { LibraryPage } from "./library-page";

const emptyLibrary = { items: [], vaultError: null, catalogVerifiedAt: null };
const nothingImported = { imported: [], failed: [], canceled: false };

function renderLibrary(): void {
  const router = createMemoryRouter([{ path: "/library", element: <LibraryPage /> }], {
    initialEntries: ["/library"],
  });
  render(<RouterProvider router={router} />);
}

describe("LibraryPage import (NIW2-579)", () => {
  beforeEach(() => {
    window.electronAPI.listLibraryItems = vi.fn(async () => emptyLibrary);
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  afterEach(() => {
    for (const toast of getToasts()) dismissToast(toast.id);
  });

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
});
