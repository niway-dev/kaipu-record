import { act, cleanup, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { DEFAULT_SETTINGS } from "@shared/types";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { StatusStackProvider } from "@renderer/features/status-cards/status-stack";
import { LibraryDetailPage } from "./library-detail-page";
import { __resetFloatingReadyCardForTests } from "@renderer/features/recording-ready/use-floating-ready-card";

// The banner and the post-recording card read the file through mediabunny; here only the
// facts it returns matter.
const probe = vi.hoisted(() =>
  vi.fn(async () => ({
    width: 2560,
    height: 1440,
    durationSec: 78,
    fps: 30,
    hasAudio: true,
    sampleRate: 48000,
  })),
);
vi.mock("@renderer/features/video-editor/export/probe-source", () => ({ probeSource: probe }));

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
  editExportedSavedAt: null,
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
  capture: null,
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
  editExportedSavedAt: null,
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
  capture: null,
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
      { path: "/editor/video/:assetId", element: <div>editor-video</div> },
      { path: "/export/:assetId", element: <div>export-page</div> },
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
    expect(screen.queryByRole("button", { name: "Export a copy" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Where is it going?" })).toBeNull();
    // A screenshot is not a master: no tag, no copies.
    expect(screen.queryByText("Master · full quality")).toBeNull();
    expect(screen.queryByRole("region", { name: "Copies from this original" })).toBeNull();
  });

  it("shows how a recording was captured in the metadata line", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...exportedOnlyItem,
          capture: {
            mode: "area" as const,
            width: 1234,
            height: 567,
            ratio: "free" as const,
          },
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.getByTestId("capture-meta")).toHaveTextContent("FRAME · 1234 × 567");
  });

  it("a re-list keeps the page on screen instead of swapping it for the loader", async () => {
    const listeners: (() => void)[] = [];
    window.electronAPI.onLibraryChanged = (listener: () => void) => {
      listeners.push(listener);
      return () => {};
    };
    let finishRelist: () => void = () => {};
    window.electronAPI.listLibraryItems = vi
      .fn()
      .mockResolvedValueOnce({
        items: [exportedOnlyItem],
        vaultError: null,
        catalogVerifiedAt: null,
      })
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finishRelist = () =>
              resolve({ items: [exportedOnlyItem], vaultError: null, catalogVerifiedAt: null });
          }),
      );
    renderDetail("asset-b");
    await waitForLoaded();

    act(() => {
      for (const l of listeners) l();
    });

    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getAllByText("Exported Recording").length).toBeGreaterThan(0);
    await act(async () => finishRelist());
  });

  it("says an imported video was imported in the metadata line (NIW2-579)", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...exportedOnlyItem,
          capture: { mode: "import" as const, width: 1080, height: 1920, ratio: null },
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.getByTestId("capture-meta")).toHaveTextContent("IMPORTED");
  });

  it("puts the title in the top row with the way back and the master tag, never with the actions", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    const title = screen.getByRole("heading", { level: 1, name: "Exported Recording" });
    const back = screen.getByRole("button", { name: "Library" });
    const row = back.parentElement!;
    expect(row).toContainElement(title);
    expect(within(row).getByText("Master · full quality")).toBeVisible();
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
    // The resolution, once the file is read, joins the metadata line under it.
    expect(await screen.findByTestId("dimensions-meta")).toHaveTextContent("2560 × 1440");

    fireEvent.click(back);
    await waitFor(() => expect(router.state.location.pathname).toBe("/library"));
  });

  it("before the first copy, asks where it is going: each card opens Export on its destination", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    const panel = () => screen.getByRole("region", { name: "Where is it going?" });
    expect(
      within(panel()).getByText(
        "Pick a place and we export a copy that fits it. The original stays as it is.",
      ),
    ).toBeVisible();
    // Its cards are the action, so "Export a copy" waits until the panel is gone.
    expect(screen.queryByRole("button", { name: "Export a copy" })).toBeNull();
    // Every destination the code has, Email included.
    expect(within(panel()).getAllByRole("button", { name: /^Export a copy for / })).toHaveLength(7);
    for (const [name, search] of [
      ["Export a copy for YouTube", "?to=youtube"],
      ["Export a copy for Reels · TikTok · Shorts", "?to=vertical"],
      ["Export a copy for LinkedIn · Feeds", "?to=square"],
      ["Export a copy for GitHub · Jira · Linear", "?to=github"],
      ["Export a copy for Slack · Discord · Email", "?to=chat"],
      ["Export a copy for Email · anywhere", "?to=email"],
      ["Export a copy for Archive copy", "?to=archive"],
    ] as const) {
      fireEvent.click(within(panel()).getByRole("button", { name }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-b"));
      expect(router.state.location.search).toBe(search);
      await act(() => router.navigate("/library/asset-b"));
      await waitForLoaded();
    }
  });

  it("each destination card shows the size of its copy: amber when uploaded, teal when light", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("asset-b");
    await waitForLoaded();
    const card = (name: string) =>
      within(screen.getByRole("region", { name: "Where is it going?" })).getByRole("button", {
        name: `Export a copy for ${name}`,
      });
    // The archive copy is the recording itself; the others wait for the file to be read.
    expect(within(card("Archive copy")).getByText(/MB$/)).toHaveAttribute("data-tone", "light");
    await waitFor(() => expect(within(card("YouTube")).queryByText("…")).toBeNull());
    expect(within(card("YouTube")).getByText(/~\d.* MB$/)).toHaveAttribute("data-tone", "upload");
    expect(within(card("GitHub · Jira · Linear")).getByText(/~\d.* MB$/)).toHaveAttribute(
      "data-tone",
      "light",
    );
  });

  it("Not now hides the panel and brings back Export a copy, which opens Export on nothing", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: "Where is it going?" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export a copy" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-b"));
    expect(router.state.location.search).toBe("");
  });

  it("tags the title and the player as the master and says the original never changes", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("asset-b");
    await waitForLoaded();
    expect(screen.getAllByText("Master · full quality")).toHaveLength(2);
    expect(screen.getByText("This is your original. It never changes.")).toBeVisible();
    // Opened from the Library, not right after recording: no "Saved" notice.
    expect(screen.queryByText("Saved to your Library.")).toBeNull();
  });

  it("Edit video lands on the recording's Editor URL", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit video" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/video/asset-b"));
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
    capture: null,
    derivedFromAssetId: null,
    editSavedAt: null,
    editExportedSavedAt: null,
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

    cleanup();
    renderDetail("src");
    await waitForLoaded();
    const copies = await screen.findByRole("region", { name: "Copies from this original" });
    expect(within(copies).getByRole("link", { name: /original take \(export\)/i })).toHaveAttribute(
      "href",
      "/library/exp",
    );
    // With copies, the page lists them instead of asking where it is going.
    expect(screen.queryByRole("region", { name: "Where is it going?" })).toBeNull();
    expect(screen.getByText("1 copy")).toBeVisible();
    expect(screen.getByRole("button", { name: "Export a copy" })).toBeVisible();
  });

  it("names a copy made for a destination by its destination, and keeps the copy untagged", async () => {
    const items = [
      { ...base, assetId: "src", title: "Take", local: local("src") },
      {
        ...base,
        assetId: "gh",
        title: "Take (light)",
        derivedFromAssetId: "src",
        local: {
          ...local("gh"),
          derivedFromAssetId: "src",
          sizeBytes: 9_000_000,
          export: { preset: "light" as const, fingerprint: "whole" },
        },
      },
    ];
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items,
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("src");
    await waitForLoaded();
    const copies = await screen.findByRole("region", { name: "Copies from this original" });
    const row = within(copies).getByRole("link", { name: /^GitHub · Jira · Linear/ });
    expect(row).toHaveAttribute("href", "/library/gh");
    // The copy's picture size follows from the master's (2560 × 1440) and its preset.
    expect(await within(row).findByText(/× \d+ · 9.0 MB$/)).toBeVisible();
    expect(
      within(copies).getByRole("button", { name: "Drag GitHub · Jira · Linear into another app" }),
    ).toBeVisible();

    cleanup();
    renderDetail("gh");
    await waitForLoaded();
    expect(screen.queryByText("Master · full quality")).toBeNull();
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

  it("shows 'Edited · not exported' instead of the editing line when a session has no export", async () => {
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

  it("says the latest edits are unexported — not 'not exported' — above an Exports list", async () => {
    // The screenshot that started this: "Edited · not exported" sitting directly above
    // a populated EXPORTS section reads as a contradiction. An export exists; what is
    // missing from a file is only the edits made after it.
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...base,
          assetId: "src",
          title: "Take",
          local: local("src"),
          editSavedAt: 9_000,
          editExportedSavedAt: 5_000,
        },
        { ...base, assetId: "exp", title: "Take (edited)", derivedFromAssetId: "src" },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/latest edits not exported/i)).toBeInTheDocument();
    expect(screen.queryByText(/edited · not exported/i)).toBeNull();
  });

  it("drops the badge once the stamp matches the session, even with an older export date", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...base,
          assetId: "src",
          title: "Take",
          local: local("src"),
          createdAt: 9_999,
          editSavedAt: 5_000,
          editExportedSavedAt: 5_000,
        },
        // createdAt BEFORE the session's savedAt — the real shape of every export, and
        // what the old date comparison mistook for a stale export.
        {
          ...base,
          assetId: "exp",
          title: "Take (edited)",
          derivedFromAssetId: "src",
          createdAt: 1,
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/^edited$/i)).toBeInTheDocument();
    expect(screen.queryByText(/not exported/i)).toBeNull();
  });

  /** An original and an export of it, both with a local file to play. */
  const pair = () =>
    vi.fn(async () => ({
      items: [
        { ...base, assetId: "src", title: "Take", local: local("src") },
        {
          ...base,
          assetId: "exp",
          title: "Take (edited)",
          derivedFromAssetId: "src",
          local: local("exp"),
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

  it("says on an edited original that the file never changes and the edits live in the editor", async () => {
    // The player streams the vault file, which ADR 0003 keeps untouched — so it never
    // shows the edits. Nothing said so, which is what made the badge above it read as
    // a contradiction.
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [{ ...base, assetId: "src", title: "Take", local: local("src"), editSavedAt: 5_000 }],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("src");
    await waitForLoaded();
    expect(
      await screen.findByText(
        "This is your original. It never changes. Your edits live in the editor.",
      ),
    ).toBeInTheDocument();
  });

  it("omits the master tag and note on an export, where the player IS the edited video", async () => {
    window.electronAPI.listLibraryItems = pair();
    renderDetail("exp");
    await waitForLoaded();
    expect(screen.queryByText(/it never changes/i)).toBeNull();
    expect(screen.queryByText("Master · full quality")).toBeNull();
    expect(screen.queryByRole("region", { name: "Where is it going?" })).toBeNull();
  });
});

describe("LibraryDetailPage — heavy to send (NIW2-218)", () => {
  const withSize = (sizeBytes: number): LibraryItem => ({
    ...exportedOnlyItem,
    local: { ...exportedOnlyItem.local!, sizeBytes },
    cloud: null,
    availability: "local",
  });

  beforeEach(() => {
    window.electronAPI.onLibraryChanged = () => () => {};
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    probe.mockClear();
  });

  it("over 25 MB: amber size, and the Light estimate in the panel, whose GitHub card makes it", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [withSize(119_000_000)],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    const router = renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.getByText("119 MB", { selector: "[data-heavy]" })).toHaveAttribute(
      "data-heavy",
      "true",
    );
    expect(screen.getByText("119 MB is heavy to send.")).toBeInTheDocument();
    // The Light row's estimate for 78 s, which fits GitHub's 100 MB.
    expect(
      await screen.findByText(/about 7.6 MB, small enough for GitHub or Jira/),
    ).toBeInTheDocument();

    // Folded into "Where is it going?": no second banner, the GitHub card is the action.
    const panel = screen.getByRole("region", { name: "Where is it going?" });
    expect(within(panel).getByText("119 MB is heavy to send.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Prepare a light copy →" })).toBeNull();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Export a copy for GitHub · Jira · Linear" }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-b"));
    expect(router.state.location.search).toBe("?to=github");
  });

  it("a heavy copy keeps its own banner, which opens Prepare on GitHub", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [{ ...withSize(119_000_000), derivedFromAssetId: "gone" }],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    const router = renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.queryByRole("region", { name: "Where is it going?" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Prepare a light copy →" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-b"));
    expect(router.state.location.search).toBe("?to=github");
  });

  it("up to 25 MB: no banner and no amber", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [withSize(20_000_000)],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.queryByText(/heavy to send/)).toBeNull();
    expect(screen.getByText("20 MB", { selector: "[data-heavy]" })).toHaveAttribute(
      "data-heavy",
      "false",
    );
  });
});

describe("LibraryDetailPage — your video is ready (NIW2-584)", () => {
  // Small on purpose: the card shows after every recording, not only a heavy one.
  const fresh: LibraryItem = {
    ...exportedOnlyItem,
    local: { ...exportedOnlyItem.local!, sizeBytes: 4_000_000 },
    cloud: null,
    availability: "local",
  };
  const CARD = { name: "Your video is ready" };

  function renderFresh(fromRecording: boolean) {
    const router = createMemoryRouter(
      [
        { path: "/library/:assetId", element: <LibraryDetailPage /> },
        { path: "/export/:assetId", element: <div>export-page</div> },
        { path: "/editor/video/:assetId", element: <div>editor-video</div> },
      ],
      { initialEntries: [{ pathname: "/library/asset-b", state: { fromRecording } }] },
    );
    render(
      <StatusStackProvider>
        <RouterProvider router={router} />
      </StatusStackProvider>,
    );
    return router;
  }

  beforeEach(() => {
    // Every test's router starts on the same history key; let each one ask again.
    __resetFloatingReadyCardForTests();
    window.electronAPI.showRecordingReady = vi.fn(async () => false);
    window.electronAPI.onLibraryChanged = () => () => {};
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [fresh],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
  });

  it("right after recording, floats the card on the desktop once, with the file's numbers, and not in-app", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    const showRecordingReady = vi.fn(async () => true);
    window.electronAPI.showRecordingReady = showRecordingReady;
    renderFresh(true);
    await waitFor(() => expect(showRecordingReady).toHaveBeenCalledTimes(1));
    expect(showRecordingReady).toHaveBeenCalledWith({
      assetId: "asset-b",
      durationSeconds: 78,
      dimensions: { width: 2560, height: 1440 },
      sizeBytes: 4_000_000,
      canEdit: true,
    });
    await act(async () => {});
    expect(screen.queryByRole("region", CARD)).toBeNull();
    expect(showRecordingReady).toHaveBeenCalledTimes(1);
  });

  it("falls back to the in-app card when the floating window cannot be asked for", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.showRecordingReady = vi.fn(async () => {
      throw new Error("No handler registered for 'recording-ready:show'");
    });
    renderFresh(true);
    expect(await screen.findByRole("region", CARD)).toBeVisible();
  });

  it("no floating card either when Settings turned it off or the page came from the Library", async () => {
    const showRecordingReady = vi.fn(async () => true);
    window.electronAPI.showRecordingReady = showRecordingReady;
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, showRecordingSavedCard: false });
    renderFresh(true);
    await waitForLoaded();
    await act(async () => {});
    cleanup();
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    renderFresh(false);
    await waitForLoaded();
    await act(async () => {});
    expect(showRecordingReady).not.toHaveBeenCalled();
  });

  // The in-app card, when the floating window could not open (the test stub answers false).
  it("in-app fallback: the top-right card asks where it is going; a chip opens Prepare on it", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    const router = renderFresh(true);
    const card = await screen.findByRole("region", CARD);
    // The file's own size and picture, once read.
    expect(await within(card).findByText("1:18 · 2560 × 1440 · 4.0 MB")).toBeVisible();
    for (const name of ["YouTube", "TikTok", "GitHub"]) {
      expect(
        within(card).getByRole("button", { name: `Prepare a copy for ${name}` }),
      ).toBeVisible();
    }

    fireEvent.click(within(card).getByRole("button", { name: "Prepare a copy for TikTok" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-b"));
    expect(router.state.location.search).toBe("?to=vertical");
    expect(screen.queryByRole("region", CARD)).toBeNull();
  });

  it("More places opens Prepare with nothing preselected", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    const router = renderFresh(true);
    const card = await screen.findByRole("region", CARD);
    fireEvent.click(within(card).getByRole("button", { name: "More places" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-b"));
    expect(router.state.location.search).toBe("");
  });

  it("Edit first opens the recording in the editor", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    const router = renderFresh(true);
    const card = await screen.findByRole("region", CARD);
    fireEvent.click(within(card).getByRole("button", { name: "Edit first" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/video/asset-b"));
  });

  it("✕ closes it and leaves the user on the recording, its question still there; no Open here", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    const router = renderFresh(true);
    const card = await screen.findByRole("region", CARD);
    expect(within(card).queryByRole("button", { name: "Open" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", CARD)).toBeNull();
    expect(router.state.location.pathname).toBe("/library/asset-b");
    expect(screen.getByRole("region", { name: "Where is it going?" })).toBeVisible();
  });

  it("not when Settings turned it off", async () => {
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, showRecordingSavedCard: false });
    renderFresh(true);
    await waitForLoaded();
    await act(async () => {});
    expect(screen.queryByRole("region", CARD)).toBeNull();
  });

  it("right after recording, the page says it is saved and is the original, until ✕", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    renderFresh(true);
    await waitForLoaded();
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(
      "Saved to your Library. This is the original — every copy you export is made from it and it never changes.",
    );
    // The notice says it, so the standing note waits.
    expect(screen.queryByText("This is your original. It never changes.")).toBeNull();
    fireEvent.click(within(notice).getByRole("button", { name: "Hide this notice" }));
    expect(screen.queryByText("Saved to your Library.")).toBeNull();
    expect(screen.getByText("This is your original. It never changes.")).toBeVisible();
  });

  it("not when the page was opened from the Library", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    renderFresh(false);
    await waitForLoaded();
    await act(async () => {});
    expect(screen.queryByRole("region", CARD)).toBeNull();
  });

  it("keeps the player mounted through the re-list a rename broadcasts (NIW2-560)", async () => {
    const renamedItem: LibraryItem = {
      ...exportedOnlyItem,
      title: "Sprint demo",
      local: { ...exportedOnlyItem.local!, id: "Sprint demo", title: "Sprint demo" },
    };
    // Every subscriber (the library list, the tags) hears the broadcast.
    const listeners = new Set<() => void>();
    window.electronAPI.onLibraryChanged = (callback: () => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    };
    const relist = deferred<{ items: LibraryItem[]; vaultError: null; catalogVerifiedAt: null }>();
    let listed = false;
    window.electronAPI.listLibraryItems = vi.fn(() => {
      if (listed) return relist.promise;
      listed = true;
      return Promise.resolve({
        items: [exportedOnlyItem],
        vaultError: null,
        catalogVerifiedAt: null,
      });
    }) as never;
    window.electronAPI.renameLocalRecording = vi.fn(
      async (_id: string, _assetId: string, title: string) => ({
        file: "renamed" as const,
        recording: { ...renamedItem.local!, title },
      }),
    ) as never;
    renderDetail("asset-b");
    await waitForLoaded();
    const player = document.querySelector("video")!;
    expect(player).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = document.activeElement as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Sprint demo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(window.electronAPI.renameLocalRecording).toHaveBeenCalledWith(
        "local-b",
        "asset-b",
        "Sprint demo",
      ),
    );
    // Main broadcasts library:changed after the move; the re-list is still in flight.
    await act(async () => listeners.forEach((listener) => listener()));
    expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(2);

    expect(screen.queryByText("Loading…")).toBeNull();
    // The very same element: unmounting it would drop the playback position.
    expect(document.querySelector("video")).toBe(player);
    expect(player.getAttribute("src")).toBe("kaipu-media://recording/Sprint%20demo");

    await act(async () =>
      relist.resolve({ items: [renamedItem], vaultError: null, catalogVerifiedAt: null }),
    );
    expect(document.querySelector("video")).toBe(player);
  });
});

describe("LibraryDetailPage — the recorded face over the original (NIW2-565)", () => {
  /** A take with a webcam file: a rounded bubble centred in the frame, the camera off 2–4 s. */
  const webcam: WebcamTrackMeta = {
    startOffsetMs: 0,
    offsetQuality: "exact",
    width: 1280,
    height: 720,
    fps: 30,
    recordedLayout: {
      shape: "rounded",
      cornerRadius: 0.18,
      size: 200,
      mirrored: false,
      framing: { enabled: false, zoom: 1, x: 0, y: 0 },
      position: { x: 0.5, y: 0.5 },
      sizeFraction: 0.2,
    },
    gaps: [{ startMs: 2000, endMs: 4000 }],
  };
  const withWebcam: LibraryItem = {
    ...exportedOnlyItem,
    local: { ...exportedOnlyItem.local!, webcam },
  };

  const list = (item: LibraryItem) =>
    vi.fn(async () => ({ items: [item], vaultError: null, catalogVerifiedAt: null }));

  /** The screen video, decoded at 1000×1000, with a clock the test sets by hand. */
  function loadScreen(): HTMLVideoElement {
    const main = screen.getByTestId("recording-video") as HTMLVideoElement;
    let current = 1;
    Object.defineProperty(main, "currentTime", {
      configurable: true,
      get: () => current,
      set: (v: number) => {
        current = v;
      },
    });
    Object.defineProperty(main, "videoWidth", { configurable: true, get: () => 1000 });
    Object.defineProperty(main, "videoHeight", { configurable: true, get: () => 1000 });
    fireEvent.loadedMetadata(main);
    return main;
  }

  function loadWebcam(duration: number): HTMLVideoElement {
    const cam = screen.getByTestId("webcam-video") as HTMLVideoElement;
    Object.defineProperty(cam, "duration", { configurable: true, get: () => duration });
    fireEvent.loadedMetadata(cam);
    return cam;
  }

  beforeEach(() => {
    window.electronAPI.onLibraryChanged = () => () => {};
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("plays the take's webcam file over the screen, at the bubble's recorded spot and shape", async () => {
    window.electronAPI.listLibraryItems = list(withWebcam);
    renderDetail("asset-b");
    await waitForLoaded();
    loadScreen();
    const cam = loadWebcam(30);
    expect(cam.getAttribute("src")).toBe("kaipu-media://webcam/local-b");
    const bubble = screen.getByTestId("webcam-layer");
    expect(bubble.style.display).toBe("");
    expect(bubble.style.left).toBe("40%");
    expect(bubble.style.top).toBe("40%");
    expect(bubble.style.width).toBe("20%");
    expect((bubble.firstElementChild as HTMLElement).style.clipPath).toBe(
      "inset(0 round 18% / 18%)",
    );
    // Read-only: nothing to select or drag over the player's controls.
    expect(screen.queryByRole("button", { name: /webcam/i })).toBeNull();
  });

  it("hides the face while the camera was off, and follows a seek back out of it", async () => {
    window.electronAPI.listLibraryItems = list(withWebcam);
    renderDetail("asset-b");
    await waitForLoaded();
    const main = loadScreen();
    loadWebcam(30);
    const bubble = screen.getByTestId("webcam-layer");
    act(() => {
      main.currentTime = 3;
      fireEvent(main, new Event("seeked"));
    });
    expect(bubble.style.display).toBe("none");
    act(() => {
      main.currentTime = 5;
      fireEvent(main, new Event("seeked"));
    });
    expect(bubble.style.display).toBe("");
  });

  it("plays the face at the screen's speed", async () => {
    window.electronAPI.listLibraryItems = list(withWebcam);
    renderDetail("asset-b");
    await waitForLoaded();
    const main = loadScreen();
    const cam = loadWebcam(30);
    act(() => {
      main.playbackRate = 2;
      fireEvent(main, new Event("ratechange"));
    });
    expect(cam.playbackRate).toBe(2);
  });

  it("a take without a webcam file plays the screen alone, as before", async () => {
    window.electronAPI.listLibraryItems = list(exportedOnlyItem);
    renderDetail("asset-b");
    await waitForLoaded();
    loadScreen();
    expect(screen.queryByTestId("webcam-video")).toBeNull();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
