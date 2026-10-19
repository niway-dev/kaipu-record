import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { EditorHomePage } from "./editor-home-page";
import { CONTINUE_ROWS, SHOW_OLDER_STEP } from "./editor-continue";
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

interface Stamps {
  editorOpenedAt?: number;
  editorSavedAt?: number;
}

function localItem(
  assetId: string,
  kind: "recording" | "screenshot",
  createdAt: number,
  over: Partial<LibraryItem> = {},
  stamps: Stamps = {},
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
      ...stamps,
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
      { path: "/library", element: <div>library</div> },
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
    window.electronAPI.markOpenedInEditor = vi.fn(async () => {});
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

  it("stamps the opened item, once, so the Editor home can list it", async () => {
    setLibrary([localItem("s1", "screenshot", 1)]);
    renderAt("/editor/image/s1");
    await screen.findByText("image-editor:local:local-s1");
    // The stamp runs in a passive effect, which can land after the editor text is
    // already on screen; wait for it instead of asserting in the same tick.
    await waitFor(() =>
      expect(window.electronAPI.markOpenedInEditor).toHaveBeenCalledExactlyOnceWith("local-s1"),
    );
  });

  it("stamps a recording opened in the video editor", async () => {
    setLibrary([localItem("a1", "recording", 1)]);
    renderAt("/editor/video/a1");
    await screen.findByText("video-editor:a1:local-a1");
    await waitFor(() =>
      expect(window.electronAPI.markOpenedInEditor).toHaveBeenCalledExactlyOnceWith("local-a1"),
    );
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
  const now = Date.now();
  const hour = 3_600_000;

  beforeEach(() => {
    window.electronAPI.onLibraryChanged = () => () => {};
    window.electronAPI.peekClipboardImage = vi.fn(async () => null);
  });

  it("lists only what was worked on in an editor, the last one as the large card", async () => {
    setLibrary([
      // Captured, never opened in the editor: stays in the Library only.
      localItem("captured", "screenshot", now),
      localItem("saved", "screenshot", now - 9 * hour, {}, { editorSavedAt: now - hour }),
      localItem("opened", "screenshot", now - 9 * hour, {}, { editorOpenedAt: now - 3 * hour }),
      localItem("rec", "recording", now - 9 * hour, { editSavedAt: now - 5 * hour }),
    ]);
    renderAt("/editor");

    const hero = await screen.findByRole("button", { name: "Open Item saved" });
    expect(hero.parentElement).toHaveTextContent("Last worked on");
    expect(hero.parentElement).toHaveTextContent("Saved 1 hour ago");
    expect(
      screen.getByRole("button", { name: "Open Item opened" }).closest("li"),
    ).toHaveTextContent("Opened 3 hours ago");
    expect(screen.queryByText("Item captured")).not.toBeInTheDocument();
    // The video is on the other tab, with its own count.
    expect(screen.queryByText("Item rec")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Images/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /Videos/ })).toHaveTextContent("1");
  });

  it("opens on the tab holding the most recent work, and resumes a video from it", async () => {
    setLibrary([
      localItem("shot", "screenshot", now - 9 * hour, {}, { editorSavedAt: now - 4 * hour }),
      localItem("rec", "recording", now - 9 * hour, { editSavedAt: now - hour }),
    ]);
    const router = renderAt("/editor");

    const resume = await screen.findByRole("button", { name: "Resume Item rec" });
    expect(screen.getByRole("tab", { name: /Videos/ })).toHaveAttribute("aria-selected", "true");
    expect(resume.parentElement).toHaveTextContent("Edited 1 hour ago");
    fireEvent.click(resume);
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/video/rec"));
  });

  it("shows four rows under the card, and Show older adds more in place", async () => {
    setLibrary(
      Array.from({ length: 12 }, (_, i) =>
        localItem(`s${i}`, "screenshot", 1, {}, { editorSavedAt: now - (i + 1) * hour }),
      ),
    );
    renderAt("/editor");
    await screen.findByRole("button", { name: "Open Item s0" });
    const rows = () => screen.queryAllByRole("listitem");
    expect(rows()).toHaveLength(CONTINUE_ROWS);

    fireEvent.click(screen.getByRole("button", { name: "Show older · 7" }));
    expect(rows()).toHaveLength(CONTINUE_ROWS + SHOW_OLDER_STEP);
    fireEvent.click(screen.getByRole("button", { name: "Show older · 2" }));
    expect(rows()).toHaveLength(11);

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(rows()).toHaveLength(CONTINUE_ROWS);
  });

  it("explains an empty Continue, and offers the Library for videos", async () => {
    setLibrary([localItem("captured", "screenshot", now)]);
    renderAt("/editor");
    expect(await screen.findByText("Nothing to continue yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Screenshots you only captured stay in your Library/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Videos/ }));
    const empty = screen.getByText("Nothing to continue yet").closest("section")!;
    expect(within(empty).getByRole("link", { name: "Choose from Library" })).toHaveAttribute(
      "href",
      "/library",
    );
  });

  it("offers New image, and pastes the clipboard image it sees straight into the editor", async () => {
    setLibrary([]);
    window.electronAPI.peekClipboardImage = vi.fn(async () => ({ width: 1440, height: 900 }));
    window.electronAPI.readClipboardImage = vi.fn(async () => ({
      png: new ArrayBuffer(4),
      width: 1440,
      height: 900,
    }));
    const router = renderAt("/editor");

    expect(await screen.findByRole("link", { name: "New image" })).toHaveAttribute(
      "href",
      "/editor/new",
    );
    expect(await screen.findByText("1440 × 900")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/capture"));
    expect(router.state.location.state).toMatchObject({ kind: "blob", origin: "paste" });
  });
});
