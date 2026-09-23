import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { LibraryDetailPage } from "./library-detail-page";

/** A cloud-only screenshot: no local file at all. Exercises the actions that
 *  require a local copy (Reveal, Edit, Copy, Delete) and confirms they are all
 *  hidden — not merely disabled — for such an item. */
const cloudOnlyItem: LibraryItem = {
  assetId: "cloud-1",
  kind: "screenshot",
  title: "Cloud Screenshot",
  createdAt: 1000,
  durationSeconds: 0,
  derivedFromAssetId: null,
  editSavedAt: null,
  local: null,
  cloud: {
    assetId: "cloud-1",
    kind: "screenshot",
    title: "Cloud Screenshot",
    revisionId: "r1",
    contentType: "image/png",
    sizeBytes: 300,
    contentSha256: "hash",
    durationSeconds: 0,
    hasThumbnail: false,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    createdAt: 1000,
    lastVerifiedAt: 5,
    lastSeenLocalId: null,
  },
  availability: "cloud",
  transfer: { state: "idle" },
  comparison: "same",
  editing: "needs-source",
  sharing: "private",
};

/** Local-and-cloud, identical bytes, an editor export with no editing project of
 *  its own — the one combination the plan says must show "Remove local
 *  download". */
const exportedOnlyItem: LibraryItem = {
  assetId: "asset-b",
  kind: "recording",
  title: "Exported Recording",
  createdAt: 2000,
  durationSeconds: 45,
  derivedFromAssetId: null,
  editSavedAt: null,
  local: {
    id: "local-b",
    assetId: "asset-b",
    kind: "recording",
    title: "Exported Recording",
    filePath: "/vault/b.mp4",
    createdAt: 2000,
    sizeBytes: 500,
    durationSeconds: 45,
    thumbnailUrl: null,
    derivedFromAssetId: null,
    contentSha256: "abc",
  },
  cloud: {
    assetId: "asset-b",
    kind: "recording",
    title: "Exported Recording",
    revisionId: "r2",
    contentType: "video/mp4",
    sizeBytes: 500,
    contentSha256: "abc",
    durationSeconds: 45,
    hasThumbnail: false,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    createdAt: 2000,
    lastVerifiedAt: 10,
    lastSeenLocalId: "local-b",
  },
  availability: "local-and-cloud",
  transfer: { state: "idle" },
  comparison: "same",
  editing: "exported-only",
  sharing: "private",
};

/** Same shape as `exportedOnlyItem`, but with its own editing project still on
 *  this device. The button still shows for it — main's remove-local-copy
 *  policy is the one that refuses with `edit-project`, and the page just
 *  toasts the blocked-edit copy. */
const projectAvailableItem: LibraryItem = {
  ...exportedOnlyItem,
  assetId: "asset-c",
  local: { ...exportedOnlyItem.local!, id: "local-c", assetId: "asset-c" },
  cloud: { ...exportedOnlyItem.cloud!, assetId: "asset-c", lastSeenLocalId: "local-c" },
  editing: "project-available",
};

function renderDetail(assetId: string) {
  const router = createMemoryRouter(
    [
      { path: "/library/:assetId", element: <LibraryDetailPage /> },
      { path: "/library", element: <div>library-page</div> },
    ],
    { initialEntries: [`/library/${assetId}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function waitForLoaded(): Promise<void> {
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
}

describe("LibraryDetailPage", () => {
  beforeEach(() => {
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: true as const }));
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("shows the cloud label and hides Reveal, Edit, Copy and Delete for a cloud-only item", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [cloudOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("cloud-1");
    await waitForLoaded();

    expect(screen.getByText("Cloud")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^copy$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove local download/i })).toBeNull();
  });

  it("shows Remove local download for a local-and-cloud, same-bytes, exported-only item", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.getByRole("button", { name: /remove local download/i })).toBeInTheDocument();
  });

  it("toasts the blocked-reason copy when removeLocalCopy refuses", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({
      ok: false,
      reason: "edit-project" as const,
    }));

    renderDetail("asset-b");
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /remove local download/i }));

    await waitFor(() =>
      expect(getToasts()).toContainEqual(
        expect.objectContaining({
          message:
            "This file is used by a local editing project. Keep its files to continue editing.",
        }),
      ),
    );
  });

  it("re-lists after removeLocalCopy succeeds", async () => {
    const listMock = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    window.electronAPI.listLibraryItems = listMock;
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: true as const }));

    renderDetail("asset-b");
    await waitForLoaded();
    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /remove local download/i }));
    });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("shows Remove local download for a project-available item, and toasts the blocked-edit copy when main refuses", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [projectAvailableItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({
      ok: false,
      reason: "edit-project" as const,
    }));

    renderDetail("asset-c");
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /remove local download/i }));

    await waitFor(() =>
      expect(getToasts()).toContainEqual(
        expect.objectContaining({
          message:
            "This file is used by a local editing project. Keep its files to continue editing.",
        }),
      ),
    );
  });
});

describe("LibraryDetailPage — lineage and edit badge", () => {
  beforeEach(() => {
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: true as const }));
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  const base = {
    kind: "recording" as const,
    createdAt: 1_000,
    durationSeconds: 10,
    local: null,
    cloud: null,
    availability: "local" as const,
    transfer: { state: "idle" as const },
    comparison: "same" as const,
    editing: "project-available" as const,
    sharing: "private" as const,
    derivedFromAssetId: null,
    editSavedAt: null,
  };
  const local = (id: string) => ({
    id,
    assetId: id,
    kind: "recording" as const,
    title: id,
    filePath: `/vault/${id}.mp4`,
    createdAt: 1_000,
    sizeBytes: 1,
    durationSeconds: 10,
    derivedFromAssetId: null,
    contentSha256: null,
  });

  it("links an export to its source and lists exports on the source", async () => {
    const items = [
      { ...base, assetId: "src", title: "Original take", local: local("src") },
      {
        ...base,
        assetId: "exp",
        title: "Original take (export)",
        createdAt: 2_000,
        derivedFromAssetId: "src",
        local: { ...local("exp"), derivedFromAssetId: "src" },
      },
    ];
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items,
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("exp");
    await waitForLoaded();
    const link = await screen.findByRole("link", { name: /original take$/i });
    expect(link).toHaveAttribute("href", "/library/src");

    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/^exports$/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /original take \(export\)/i })).toBeInTheDocument();
  });

  it("says the source was deleted when the parent is not in the list", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...base,
          assetId: "exp",
          title: "Orphan",
          derivedFromAssetId: "gone",
          local: local("exp"),
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("exp");
    await waitForLoaded();
    expect(await screen.findByText(/source recording was deleted/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /gone/ })).toBeNull();
  });

  it("links to a cloud-only source (no local id)", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...base,
          assetId: "src",
          title: "In the cloud",
          availability: "cloud" as const,
          editing: "needs-source" as const,
        },
        {
          ...base,
          assetId: "exp",
          title: "Export",
          derivedFromAssetId: "src",
          local: local("exp"),
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("exp");
    await waitForLoaded();
    expect(await screen.findByRole("link", { name: /in the cloud/i })).toHaveAttribute(
      "href",
      "/library/src",
    );
  });

  it("shows 'Edited · not exported' instead of the editing line when a session has no newer export", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [{ ...base, assetId: "src", title: "Take", local: local("src"), editSavedAt: 5_000 }],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/edited · not exported/i)).toBeInTheDocument();
    expect(screen.queryByText(/editing project available/i)).toBeNull();
  });
});
