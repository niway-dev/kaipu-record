import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { EditorHomePage } from "./editor-home-page";
import { RECENT_PAGE_SIZE } from "./recent-editable";
import { EditorImagePage, EditorVideoPage, LegacyScreenshotEditorRedirect } from "./editor-routes";

// The editors themselves are out of scope here (they are covered by their own
// page tests); stand-ins show which source each route resolved.
vi.mock("@renderer/pages/video-editor/video-editor-page", () => ({
  VideoEditorLoader: ({ source }: { source: { id: string; assetId: string } }) => (
    <div>
      video-editor:{source.assetId}:{source.id}
    </div>
  ),
}));
vi.mock("@renderer/pages/screenshot-editor/screenshot-editor-page", () => ({
  ScreenshotEditor: ({ source }: { source: { kind: string; id?: string } }) => (
    <div>
      image-editor:{source.kind}:{source.id}
    </div>
  ),
}));

function localItem(
  assetId: string,
  kind: "recording" | "screenshot",
  createdAt: number,
  over: Partial<LibraryItem> = {},
): LibraryItem {
  const durationSeconds = kind === "recording" ? 12 : 0;
  return {
    assetId,
    kind,
    title: `Item ${assetId}`,
    createdAt,
    durationSeconds,
    derivedFromAssetId: null,
    editSavedAt: null,
    editExportedSavedAt: null,
    local: {
      id: `local-${assetId}`,
      assetId,
      kind,
      title: `Item ${assetId}`,
      filePath: `/vault/${assetId}`,
      createdAt,
      sizeBytes: 10,
      durationSeconds,
      thumbnailUrl: null,
      derivedFromAssetId: null,
      contentSha256: null,
    },
    cloud: null,
    availability: "local",
    transfer: { state: "idle" },
    comparison: "same",
    editing: "none",
    sharing: "private",
    ...over,
  } as LibraryItem;
}

function setLibrary(items: LibraryItem[]): void {
  window.electronAPI.listLibraryItems = vi.fn(async () => ({
    items,
    vaultError: null,
    catalogVerifiedAt: null,
  }));
}

function renderAt(entry: string | { pathname: string; state: unknown }) {
  const router = createMemoryRouter(
    [
      { path: "/editor", element: <EditorHomePage /> },
      { path: "/editor/new", element: <div>editor-new</div> },
      { path: "/editor/video/:assetId", element: <EditorVideoPage /> },
      { path: "/editor/image/:assetId", element: <EditorImagePage /> },
      { path: "/editor/capture", element: <div>editor-capture</div> },
      { path: "/screenshot-editor", element: <LegacyScreenshotEditorRedirect /> },
    ],
    { initialEntries: [entry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("Editor workspace routes", () => {
  beforeEach(() => {
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  it("resolves /editor/video/:assetId from the library (so a reload reopens it)", async () => {
    setLibrary([localItem("a1", "recording", 1)]);
    renderAt("/editor/video/a1");
    expect(await screen.findByText("video-editor:a1:local-a1")).toBeInTheDocument();
  });

  it("resolves /editor/image/:assetId to a local image source", async () => {
    setLibrary([localItem("s1", "screenshot", 1)]);
    renderAt("/editor/image/s1");
    expect(await screen.findByText("image-editor:local:local-s1")).toBeInTheDocument();
  });

  it("falls back to the Editor home for an unknown or cloud-only item", async () => {
    setLibrary([localItem("c1", "recording", 1, { local: null, availability: "cloud" })]);
    const router = renderAt("/editor/video/c1");
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor"));
  });

  it("maps a legacy /screenshot-editor local source to its asset URL", async () => {
    setLibrary([localItem("s1", "screenshot", 1)]);
    const router = renderAt({
      pathname: "/screenshot-editor",
      state: { kind: "local", id: "local-s1", title: "x" },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/image/s1"));
  });

  it("keeps a legacy fresh capture in state and opens it on /editor/capture", async () => {
    setLibrary([]);
    const state = { kind: "blob", bytes: new ArrayBuffer(1) };
    const router = renderAt({ pathname: "/screenshot-editor", state });
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/capture"));
    expect(router.state.location.state).toBe(state);
  });

  it("sends a stateless legacy /screenshot-editor to the Editor home", async () => {
    setLibrary([]);
    const router = renderAt({ pathname: "/screenshot-editor", state: null });
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor"));
  });
});

describe("EditorHomePage", () => {
  beforeEach(() => {
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  it("lists every editable item, last worked on first, a page at a time, and opens one", async () => {
    const now = Date.now();
    const hour = 3_600_000;
    setLibrary([
      // Recorded long ago but edited just now: the last thing worked on.
      localItem("edited", "recording", now - 100 * hour, { editSavedAt: now - hour }),
      ...Array.from({ length: 9 }, (_, i) =>
        localItem(`r${i}`, i % 3 === 0 ? "screenshot" : "recording", now - (i + 2) * hour),
      ),
      // Not editable: cloud-only, and a recording without a duration.
      localItem("cloud", "recording", now, { local: null, availability: "cloud" }),
      localItem("nodur", "recording", now, { durationSeconds: 0 }),
    ]);
    const router = renderAt("/editor");

    const edits = await screen.findAllByRole("button", { name: /^Edit Item/ });
    expect(edits).toHaveLength(RECENT_PAGE_SIZE);
    expect(edits[0]).toHaveAccessibleName("Edit Item edited");
    expect(edits[0].closest("li")).toHaveTextContent("Edited 1 hour ago");
    expect(edits[1].closest("li")).toHaveTextContent("Created 2 hours ago");
    expect(screen.getByText("1–8 of 10")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("9–10 of 10")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: /^Edit Item/ })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Edit Item r7", "Edit Item r8"]);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Edit Item r7" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/video/r7"));
  });

  it("filters to recordings never edited, back on the first page", async () => {
    const now = Date.now();
    setLibrary([
      localItem("edited", "recording", now - 5000, { editSavedAt: now - 1000 }),
      localItem("fresh", "recording", now - 4000),
      localItem("shot", "screenshot", now - 3000),
      ...Array.from({ length: 8 }, (_, i) => localItem(`old${i}`, "screenshot", now - 9000 - i)),
    ]);
    renderAt("/editor");
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }));

    fireEvent.click(screen.getByRole("button", { name: "Not edited" }));
    expect(screen.getByRole("button", { name: "Not edited" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen
        .getAllByRole("button", { name: /^Edit Item/ })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Edit Item fresh"]);
    // One page only: no pager.
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
  });

  it("shows the library's export state next to an edited recording", async () => {
    setLibrary([
      localItem("edited", "recording", 2, { editSavedAt: 1000 }),
      localItem("plain", "recording", 1),
    ]);
    renderAt("/editor");

    await screen.findAllByRole("button", { name: /^Edit Item/ });
    const badges = screen.getAllByText("Edited · not exported");
    expect(badges).toHaveLength(1);
    expect(badges[0].closest("li")).toHaveTextContent("Item edited");
  });

  it("says so when there is nothing to edit", async () => {
    setLibrary([]);
    renderAt("/editor");
    expect(await screen.findByText(/Nothing to edit yet/)).toBeInTheDocument();
  });

  it("offers New image, which opens the empty editor waiting for a paste", async () => {
    setLibrary([]);
    const router = renderAt("/editor");
    fireEvent.click(await screen.findByRole("link", { name: "New image" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/new"));
  });
});
