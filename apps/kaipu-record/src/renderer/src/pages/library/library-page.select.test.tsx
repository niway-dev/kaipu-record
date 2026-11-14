import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { MoveItemsRequest, WorkspacesState } from "@shared/types/workspaces";
import { WorkspacesProvider } from "@renderer/features/workspaces/workspaces-context";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { LibraryPage } from "./library-page";

const base: LibraryVideo = {
  id: "a",
  assetId: "asset-a",
  kind: "recording",
  title: "Alpha",
  createdAt: 4,
  durationSeconds: 10,
  fileSizeBytes: 1000,
  cloudSizeBytes: null,
  thumbnailUrl: null,
  availability: "local",
  comparison: "same",
  editing: "project-available",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
  editSavedAt: null,
  editExportedSavedAt: null,
};
const VIDEOS: LibraryVideo[] = [
  base,
  { ...base, id: "b", assetId: "asset-b", title: "Bravo", createdAt: 3, kind: "screenshot" },
  {
    ...base,
    id: null,
    assetId: "asset-c",
    title: "Cloud only",
    createdAt: 2,
    availability: "cloud",
  },
  { ...base, id: "d", assetId: "asset-d", title: "Delta", createdAt: 1 },
];

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

const realApi = window.electronAPI;
const STATE: WorkspacesState = {
  activeId: "ws-work",
  generation: 1,
  hintDismissed: true,
  busy: null,
  readOnly: false,
  workspaces: [
    {
      id: "ws-work",
      name: "Work",
      color: "rose",
      initials: "W",
      path: "/w",
      volume: null,
      state: "available",
      itemCount: 4,
      device: "1",
    },
    {
      id: "ws-home",
      name: "Home",
      color: "mint",
      initials: "H",
      path: "/h",
      volume: null,
      state: "available",
      itemCount: 0,
      device: "1",
    },
  ],
};

function renderLibrary(moveItems: (r: MoveItemsRequest) => Promise<unknown>) {
  window.electronAPI = {
    ...realApi,
    workspaces: {
      ...realApi.workspaces,
      list: async () => STATE,
      moveItems: moveItems as never,
    },
  };
  const router = createMemoryRouter(
    [
      { path: "/library", element: <LibraryPage /> },
      { path: "/library/:assetId", element: <div>detail-page</div> },
    ],
    { initialEntries: ["/library"] },
  );
  render(
    <WorkspacesProvider>
      <RouterProvider router={router} />
    </WorkspacesProvider>,
  );
  return router;
}

afterEach(() => {
  window.electronAPI = realApi;
  for (const toast of getToasts()) dismissToast(toast.id);
});

const card = (title: string): HTMLElement =>
  screen.getByText(title, { selector: "p" }).closest("[role='button']")!;

describe("LibraryPage select mode (spec decision 20)", () => {
  it("checks items instead of opening them, shift-clicks a range, and moves the selection", async () => {
    const moveItems = vi.fn(async (request: MoveItemsRequest) => ({
      targetId: request.targetId,
      moved: [{ id: "a", newId: "a" }],
      failed: [{ id: "d", reason: "no-room" as const }],
      skipped: [],
    }));
    const router = renderLibrary(moveItems);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Select" }));

    fireEvent.click(card("Alpha"));
    expect(router.state.location.pathname).toBe("/library");
    // A range over the order on screen; the cloud-only item cannot be checked.
    fireEvent.click(card("Delta"), { shiftKey: true });
    expect(screen.getByRole("checkbox", { name: "Select Cloud only" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("toolbar")).toHaveTextContent("3 selected");

    fireEvent.click(screen.getByRole("button", { name: /Move to/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /Home/ }));
    });
    expect(moveItems).toHaveBeenCalledWith({
      targetId: "ws-home",
      items: [
        { id: "a", assetId: "asset-a" },
        { id: "b", assetId: "asset-b" },
        { id: "d", assetId: "asset-d" },
      ],
    });
    // What stayed stays selected, so a retry is one click.
    expect(screen.getByRole("toolbar")).toHaveTextContent("1 selected");
    expect(screen.getByRole("checkbox", { name: "Select Delta" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("clears the selection when a filter changes", async () => {
    renderLibrary(vi.fn());
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(card("Alpha"));
    expect(screen.getByRole("toolbar")).toHaveTextContent("1 selected");
    fireEvent.click(screen.getByRole("button", { name: /Screenshots/ }));
    expect(screen.getByRole("toolbar")).toHaveTextContent("0 selected");
  });

  it("each card has a ⋯ menu with Move to", async () => {
    renderLibrary(vi.fn());
    await act(async () => {});
    const menus = screen.getAllByRole("button", { name: "More actions" });
    // The cloud-only item has nothing local to move.
    expect(menus.filter((m) => !(m as HTMLButtonElement).disabled)).toHaveLength(3);
  });
});
