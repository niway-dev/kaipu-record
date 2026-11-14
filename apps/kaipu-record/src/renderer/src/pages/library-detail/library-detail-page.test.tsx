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
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
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
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
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
    sourceVideoAssetId: null,
    sourceTimeSeconds: null,
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

/** Opens the ••• menu of the page header. */
function openMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
}

function openTab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name }));
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
    expect(screen.queryByRole("button", { name: /^edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Where is it going?" })).toBeNull();
    // A screenshot is not a master: no "original" hint.
    expect(screen.queryByRole("button", { name: /your original stays unchanged/i })).toBeNull();
  });

  it("shows how a recording was captured in the Details tab", async () => {
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

    // How it was captured lives in the Details tab, not in the metadata line.
    expect(screen.queryByText("Region recording")).toBeNull();
    openTab("Details");
    expect(screen.getByText("Region recording")).toBeVisible();
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

  it("says an imported video was imported in the Details tab (NIW2-579)", async () => {
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

    openTab("Details");
    expect(screen.getByText("Imported video")).toBeVisible();
  });

  it("puts the title and every action on one row, with the way back above", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    const title = screen.getByRole("heading", { level: 1, name: "Exported Recording" });
    const edit = screen.getByRole("button", { name: "Edit video" });
    // The actions group sits in the title's own row.
    const row = edit.parentElement!.parentElement!;
    expect(row).toContainElement(title);
    expect(row).toContainElement(edit);
    expect(row).toContainElement(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(row).toContainElement(screen.getByRole("button", { name: "Open" }));
    expect(row).toContainElement(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByText("Master · full quality")).toBeNull();
    // One metadata line: kind, duration, size and an absolute date; no "Local", no relative date.
    expect(screen.queryByText("Local and cloud")).toBeNull();
    expect(screen.getByText("Video")).toBeVisible();
    expect(screen.getByText("0:45")).toBeVisible();
    expect(screen.getByText(/\d{4} · \d{2}:\d{2}$/)).toBeVisible();
    // The resolution, once the file is read, joins the metadata line.
    expect(await screen.findByTestId("dimensions-meta")).toHaveTextContent("2560 × 1440");

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
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

  it("Open Export in the destinations tab opens Export on nothing", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    // The old "Not now" is gone: switching tabs is the dismissal.
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
    openTab("Versions");
    expect(screen.queryByRole("region", { name: "Where is it going?" })).toBeNull();
    openTab("Where is it going?");
    fireEvent.click(screen.getByRole("button", { name: /^Open Export/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-b"));
    expect(router.state.location.search).toBe("");
  });

  it("hints in the header that the original stays unchanged, without a master tag or note", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("asset-b");
    await waitForLoaded();
    expect(
      screen.getByRole("button", {
        name: "Your original stays unchanged. Edits are exported as copies.",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Master · full quality")).toBeNull();
    expect(screen.queryByText("This is your original. It never changes.")).toBeNull();
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

    openMenu();
    expect(screen.getByRole("menuitem", { name: /remove local download/i })).toBeInTheDocument();
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

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /remove local download/i }));

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

    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /remove local download/i }));
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

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /remove local download/i }));

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
    sourceVideoAssetId: null,
    sourceTimeSeconds: null,
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
    sourceVideoAssetId: null,
    sourceTimeSeconds: null,
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
    const versions = await screen.findByRole("region", { name: "Versions" });
    expect(
      within(versions)
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/library/src"),
    ).toBe(true);

    cleanup();
    renderDetail("src");
    await waitForLoaded();
    const copies = await screen.findByRole("region", { name: "Versions" });
    expect(within(copies).getByRole("link", { name: /original take \(export\)/i })).toHaveAttribute(
      "href",
      "/library/exp",
    );
    // With copies, the page opens on the versions instead of asking where it is going; the
    // destinations stay one tab away.
    expect(screen.getByRole("tab", { name: "Versions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "Where is it going?" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Where is it going?" })).toBeVisible();
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
    const copies = await screen.findByRole("region", { name: "Versions" });
    const row = within(copies).getByRole("link", { name: /^GitHub · Jira · Linear/ });
    expect(row).toHaveAttribute("href", "/library/gh");
    // The copy's picture size follows from the master's (2560 × 1440) and its preset.
    expect(await within(row).findByText(/× \d+ · 9.0 MB/)).toBeVisible();

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

  it("omits the master tag and note on an export, where the player IS the edited video", async () => {
    window.electronAPI.listLibraryItems = pair();
    renderDetail("exp");
    await waitForLoaded();
    expect(screen.queryByText(/it never changes/i)).toBeNull();
    expect(screen.queryByText("Master · full quality")).toBeNull();
    expect(screen.queryByRole("button", { name: /your original stays unchanged/i })).toBeNull();
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
    fireEvent.click(within(notice).getByRole("button", { name: "Hide this notice" }));
    expect(screen.queryByText("Saved to your Library.")).toBeNull();
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

describe("LibraryDetailPage — header, menu, navigation and tabs (NIW2-669)", () => {
  const screenshotItem: LibraryItem = {
    ...exportedOnlyItem,
    assetId: "shot-1",
    kind: "screenshot",
    title: "A screenshot",
    durationSeconds: 0,
    local: {
      ...exportedOnlyItem.local!,
      id: "shot-1",
      assetId: "shot-1",
      kind: "screenshot",
      title: "A screenshot",
      filePath: "/vault/shot-1.png",
    },
    cloud: null,
    availability: "local",
    editing: "project-available",
  };
  const gifItem: LibraryItem = {
    ...screenshotItem,
    assetId: "gif-1",
    kind: "gif",
    title: "A gif",
    local: {
      ...screenshotItem.local!,
      id: "gif-1",
      assetId: "gif-1",
      kind: "gif",
      title: "A gif",
      filePath: "/vault/gif-1.gif",
    },
  };

  const list = (...items: LibraryItem[]): void => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items,
      vaultError: null,
      catalogVerifiedAt: null,
    }));
  };

  beforeEach(() => {
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: true as const }));
    window.electronAPI.onLibraryChanged = () => () => {};
    window.electronAPI.localRecordingPath = vi.fn(async (id: string) => `/vault/${id}.mp4`);
  });

  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  function renderWithState(path: string, state?: unknown) {
    const router = createMemoryRouter(
      [
        { path: "/library/:assetId", element: <LibraryDetailPage /> },
        { path: "/library", element: <div>library-page</div> },
        { path: "/editor/video/:assetId", element: <div>editor-video</div> },
        { path: "/editor/image/:assetId", element: <div>editor-image</div> },
      ],
      { initialEntries: [{ pathname: path, state }] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it("Open hands the file to the default app", async () => {
    list(exportedOnlyItem);
    window.electronAPI.openLocalRecording = vi.fn(async () => {});
    renderDetail("asset-b");
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(window.electronAPI.openLocalRecording).toHaveBeenCalledWith("local-b");
  });

  it("Open reports a failure with a toast that can retry", async () => {
    list(exportedOnlyItem);
    window.electronAPI.openLocalRecording = vi.fn(async () => {
      throw new Error("no application knows how to open this file");
    });
    renderDetail("asset-b");
    await waitForLoaded();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
    });
    expect(getToasts()).toContainEqual(
      expect.objectContaining({
        message: "Couldn't open the file.",
        action: expect.objectContaining({ onClick: expect.any(Function) }),
      }),
    );
  });

  it("Reveal in Finder reveals the file", async () => {
    list(exportedOnlyItem);
    window.electronAPI.revealLocalRecording = vi.fn(async () => {});
    renderDetail("asset-b");
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(window.electronAPI.revealLocalRecording).toHaveBeenCalledWith("local-b");
  });

  it("a screenshot leads with Edit image, which opens the image editor", async () => {
    list(screenshotItem);
    const router = renderWithState("/library/shot-1");
    await waitForLoaded();
    expect(screen.queryByRole("button", { name: "Edit video" })).toBeNull();
    expect(screen.queryByText("0:00")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/image/shot-1"));
  });

  it("a GIF has no primary edit action", async () => {
    list(gifItem);
    renderWithState("/library/gif-1");
    await waitForLoaded();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Reveal in Finder" })).toBeVisible();
  });

  it("the ••• menu of a recording: Copy path, Remove local download, Delete…; no Copy image", async () => {
    list(exportedOnlyItem);
    renderDetail("asset-b");
    await waitForLoaded();
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    const items = within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(items).toEqual(["Copy path", "Remove local download", "Delete…"]);
  });

  it("the ••• menu of a screenshot adds Copy image, which copies it", async () => {
    list(screenshotItem);
    window.electronAPI.copyScreenshotById = vi.fn(async () => {});
    renderWithState("/library/shot-1");
    await waitForLoaded();
    openMenu();
    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Copy image", "Copy path", "Delete…"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy image" }));
    });
    expect(window.electronAPI.copyScreenshotById).toHaveBeenCalledWith("shot-1");
  });

  it("Copy path writes the absolute path to the clipboard and toasts", async () => {
    list(exportedOnlyItem);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderDetail("asset-b");
    await waitForLoaded();
    openMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    });
    expect(writeText).toHaveBeenCalledWith("/vault/local-b.mp4");
    expect(getToasts()).toContainEqual(expect.objectContaining({ message: "Path copied" }));
  });

  it("Escape and a click outside close the menu", async () => {
    list(exportedOnlyItem);
    renderDetail("asset-b");
    await waitForLoaded();
    openMenu();
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Delete… asks for confirmation before deleting", async () => {
    list(exportedOnlyItem);
    window.electronAPI.deleteLocalRecording = vi.fn(async () => {});
    const router = renderDetail("asset-b");
    await waitForLoaded();
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(window.electronAPI.deleteLocalRecording).not.toHaveBeenCalled();
    expect(await screen.findByText("Delete recording?")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(window.electronAPI.deleteLocalRecording).toHaveBeenCalledWith("local-b"),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/library"));
  });

  describe("per-item state, menu feedback and the editing line (review fixes)", () => {
    const shot = (assetId: string): LibraryItem => ({
      ...screenshotItem,
      assetId,
      title: assetId,
      local: {
        ...screenshotItem.local!,
        id: assetId,
        assetId,
        title: assetId,
        thumbnailUrl: `kaipu-media://screenshot/${assetId}`,
      },
    });

    it("moving to another screenshot starts it at Fit, with its image available again", async () => {
      list(shot("shot-a"), shot("shot-b"));
      renderWithState("/library/shot-a", { order: ["shot-a", "shot-b"] });
      await waitForLoaded();
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(document.querySelector("img")!.style.width).toBe("150%");
      fireEvent.click(screen.getByRole("button", { name: "Next item" }));
      await waitFor(() =>
        expect(screen.getByTestId("position-counter")).toHaveTextContent("2 of 2"),
      );
      expect(document.querySelector("img")!.style.width).toBe("");

      fireEvent.error(document.querySelector("img")!);
      expect(screen.getByText("Image unavailable")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Previous item" }));
      await waitFor(() =>
        expect(screen.getByTestId("position-counter")).toHaveTextContent("1 of 2"),
      );
      expect(screen.queryByText("Image unavailable")).toBeNull();
      expect(document.querySelector("img")).not.toBeNull();
    });

    it("Copy image confirms with a toast that outlives the menu", async () => {
      list(screenshotItem);
      window.electronAPI.copyScreenshotById = vi.fn(async () => {});
      renderWithState("/library/shot-1");
      await waitForLoaded();
      openMenu();
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Copy image" }));
      });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(getToasts()).toContainEqual(expect.objectContaining({ message: "Image copied" }));
    });

    it("a version row keeps the walk: its link carries the passed order", async () => {
      const copy: LibraryItem = {
        ...exportedOnlyItem,
        assetId: "asset-copy",
        title: "Copy file",
        derivedFromAssetId: "asset-b",
        local: {
          ...exportedOnlyItem.local!,
          id: "local-copy",
          assetId: "asset-copy",
          title: "Copy file",
          derivedFromAssetId: "asset-b",
        },
        cloud: null,
        availability: "local",
      };
      list(exportedOnlyItem, copy);
      const order = ["asset-copy", "asset-b"];
      const router = renderWithState("/library/asset-b", { order });
      await waitForLoaded();
      fireEvent.click(
        within(screen.getByRole("region", { name: "Versions" })).getByRole("link", {
          name: /Copy file/,
        }),
      );
      await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-copy"));
      expect(router.state.location.state).toEqual({ order });
    });

    it("a version row's drag handle starts a native file drag of that copy", async () => {
      const copy: LibraryItem = {
        ...exportedOnlyItem,
        assetId: "asset-copy",
        title: "Copy file",
        derivedFromAssetId: "asset-b",
        local: {
          ...exportedOnlyItem.local!,
          id: "local-copy",
          assetId: "asset-copy",
          title: "Copy file",
          derivedFromAssetId: "asset-b",
        },
        cloud: null,
        availability: "local",
      };
      list(exportedOnlyItem, copy);
      window.electronAPI.startFileDrag = vi.fn();
      renderWithState("/library/asset-b");
      await waitForLoaded();
      fireEvent.dragStart(screen.getByRole("button", { name: "Drag Copy file into another app" }));
      expect(window.electronAPI.startFileDrag).toHaveBeenCalledWith("local-copy", "Copy file");
    });

    it("says what a recording needs when it cannot be edited here, and nothing for project-available", async () => {
      list(
        { ...exportedOnlyItem, assetId: "asset-ns", editing: "needs-source" },
        projectAvailableItem,
      );
      renderDetail("asset-ns");
      await waitForLoaded();
      expect(screen.getByText("Download to edit")).toBeVisible();
      cleanup();
      renderDetail("asset-c");
      await waitForLoaded();
      expect(screen.queryByText("Editing project available on this device")).toBeNull();
      expect(screen.queryByText("Download to edit")).toBeNull();
    });

    it("a GIF's Details tab lists its frame rate", async () => {
      list({
        ...gifItem,
        local: { ...gifItem.local!, gif: { width: 480, height: 270, fps: 12 } },
      });
      renderWithState("/library/gif-1");
      await waitForLoaded();
      openTab("Details");
      expect(screen.getByText("Frame rate")).toBeVisible();
      expect(screen.getByText("12 fps")).toBeVisible();
    });

    it("another item opens on its own default tab, with the menu closed", async () => {
      list(exportedOnlyItem, screenshotItem);
      const router = renderWithState("/library/asset-b");
      await waitForLoaded();
      openTab("Details");
      openMenu();
      expect(screen.getByRole("menu")).toBeVisible();
      await act(async () => {
        await router.navigate("/library/shot-1");
      });
      expect(screen.getByRole("tab", { name: "Versions" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("Escape is left alone while the menu is closed, and Tab out closes it", async () => {
      list(exportedOnlyItem);
      renderDetail("asset-b");
      await waitForLoaded();
      const seen = vi.fn();
      document.addEventListener("keydown", seen);
      try {
        fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), { key: "Escape" });
        expect(seen).toHaveBeenCalledTimes(1);
        openMenu();
        fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
        expect(seen).toHaveBeenCalledTimes(1);
      } finally {
        document.removeEventListener("keydown", seen);
      }
      openMenu();
      fireEvent.blur(screen.getAllByRole("menuitem")[0]!, {
        relatedTarget: screen.getByRole("button", { name: "Open" }),
      });
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("previous and next", () => {
    const three = (): LibraryItem[] =>
      ["asset-a", "asset-b", "asset-c"].map((assetId) => ({
        ...exportedOnlyItem,
        assetId,
        title: assetId,
        local: { ...exportedOnlyItem.local!, id: `local-${assetId}`, assetId, title: assetId },
        cloud: null,
        availability: "local" as const,
      }));

    it("walks the order the Library passed, keeping it in the navigation state", async () => {
      list(...three());
      const router = renderWithState("/library/asset-b", {
        order: ["asset-c", "asset-b", "asset-a"],
      });
      await waitForLoaded();
      expect(screen.getByTestId("position-counter")).toHaveTextContent("2 of 3");
      fireEvent.click(screen.getByRole("button", { name: "Next item" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-a"));
      expect(router.state.location.state).toEqual({ order: ["asset-c", "asset-b", "asset-a"] });
      await waitFor(() =>
        expect(screen.getByTestId("position-counter")).toHaveTextContent("3 of 3"),
      );
      expect(screen.getByRole("button", { name: "Next item" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Previous item" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-b"));
    });

    it("falls back to the library's own order when none was passed", async () => {
      list(...three());
      renderWithState("/library/asset-a");
      await waitForLoaded();
      expect(screen.getByTestId("position-counter")).toHaveTextContent("1 of 3");
      expect(screen.getByRole("button", { name: "Previous item" })).toBeDisabled();
    });

    it("falls back to the whole library when the item is not in the passed order", async () => {
      list(...three());
      renderWithState("/library/asset-a", { order: ["asset-b", "asset-c"] });
      await waitForLoaded();
      expect(screen.getByTestId("position-counter")).toHaveTextContent("1 of 3");
      expect(screen.getByRole("button", { name: "Next item" })).toBeEnabled();
    });

    it("drops ids that are no longer in the library from the passed order", async () => {
      list(...three());
      renderWithState("/library/asset-b", { order: ["asset-c", "asset-gone", "asset-b"] });
      await waitForLoaded();
      expect(screen.getByTestId("position-counter")).toHaveTextContent("2 of 2");
      expect(screen.getByRole("button", { name: "Next item" })).toBeDisabled();
    });
  });

  describe("original info tip", () => {
    const infoName = "Your original stays unchanged. Edits are exported as copies.";

    it("shows its text on keyboard focus, on click, and hides on Escape", async () => {
      list(exportedOnlyItem);
      renderDetail("asset-b");
      await waitForLoaded();
      const button = screen.getByRole("button", { name: infoName });
      const tip = screen.getByRole("tooltip", { hidden: true });
      expect(button.getAttribute("aria-describedby")).toBe(tip.id);
      expect(tip).not.toBeVisible();
      fireEvent.focus(button);
      expect(tip).toBeVisible();
      expect(tip).toHaveTextContent(infoName);
      fireEvent.keyDown(button, { key: "Escape" });
      expect(tip).not.toBeVisible();
      fireEvent.click(button);
      expect(tip).toBeVisible();
      fireEvent.blur(button);
      expect(tip).not.toBeVisible();
    });
  });

  describe("tabs", () => {
    it("only the selected tab points aria-controls at the rendered panel", async () => {
      list(exportedOnlyItem);
      renderDetail("asset-b");
      await waitForLoaded();
      const tabs = screen.getAllByRole("tab");
      expect(tabs.length).toBeGreaterThan(1);
      const panel = screen.getByRole("tabpanel");
      for (const tab of tabs) {
        if (tab.getAttribute("aria-selected") === "true") {
          expect(tab.getAttribute("aria-controls")).toBe(panel.id);
        } else {
          expect(tab.hasAttribute("aria-controls")).toBe(false);
        }
      }
    });

    it("opens on Where is it going? until the first copy exists", async () => {
      list(exportedOnlyItem);
      renderDetail("asset-b");
      await waitForLoaded();
      expect(screen.getByRole("tab", { name: "Where is it going?" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tabpanel")).toContainElement(
        screen.getByRole("region", { name: "Where is it going?" }),
      );
    });

    it("opens on Versions once a copy exists", async () => {
      const copy: LibraryItem = {
        ...exportedOnlyItem,
        assetId: "asset-copy",
        title: "Copy",
        derivedFromAssetId: "asset-b",
        local: {
          ...exportedOnlyItem.local!,
          id: "local-copy",
          assetId: "asset-copy",
          derivedFromAssetId: "asset-b",
        },
        cloud: null,
        availability: "local",
      };
      list(exportedOnlyItem, copy);
      renderDetail("asset-b");
      await waitForLoaded();
      expect(screen.getByRole("tab", { name: "Versions" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("a screenshot has Versions and Details only, opening on Versions", async () => {
      list(screenshotItem);
      renderWithState("/library/shot-1");
      await waitForLoaded();
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Versions",
        "Details",
      ]);
      expect(screen.getByRole("tab", { name: "Versions" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("switches by click and by arrow keys, and Details lists the file's facts", async () => {
      list(exportedOnlyItem);
      renderDetail("asset-b");
      await waitForLoaded();
      const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
      expect(tabs).toEqual(["Versions", "Details", "Where is it going?"]);

      openTab("Details");
      const panel = screen.getByRole("tabpanel");
      expect(within(panel).getByText("Frame rate")).toBeVisible();
      expect(await within(panel).findByText("30 fps")).toBeVisible();
      expect(within(panel).getByText("Audio")).toBeVisible();
      expect(within(panel).getByText("Yes")).toBeVisible();
      expect(await within(panel).findByText("/vault/local-b.mp4")).toBeVisible();

      fireEvent.keyDown(screen.getByRole("tab", { name: "Details" }), { key: "ArrowLeft" });
      expect(screen.getByRole("tab", { name: "Versions" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      fireEvent.keyDown(screen.getByRole("tab", { name: "Versions" }), { key: "ArrowLeft" });
      expect(screen.getByRole("tab", { name: "Where is it going?" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("Details leaves out the video-only rows for a screenshot", async () => {
      list(screenshotItem);
      renderWithState("/library/shot-1");
      await waitForLoaded();
      openTab("Details");
      const panel = screen.getByRole("tabpanel");
      expect(within(panel).getByText("Screenshot")).toBeVisible();
      expect(within(panel).queryByText("Frame rate")).toBeNull();
      expect(within(panel).queryByText("Audio")).toBeNull();
    });
  });
});

describe("LibraryDetailPage — frame captures of a video (NIW2-764)", () => {
  /** A screenshot taken from `exportedOnlyItem` (asset-b) at `at` seconds of the video. */
  function capture(id: string, at: number, createdAt: number, from = "asset-b"): LibraryItem {
    return {
      ...exportedOnlyItem,
      assetId: `cap-${id}`,
      kind: "screenshot",
      title: `Frame ${id}`,
      durationSeconds: 0,
      createdAt,
      sourceVideoAssetId: from,
      sourceTimeSeconds: at,
      local: {
        ...exportedOnlyItem.local!,
        id: `cap-${id}`,
        assetId: `cap-${id}`,
        kind: "screenshot",
        title: `Frame ${id}`,
        filePath: `/vault/cap-${id}.png`,
        thumbnailUrl: `kaipu-media://screenshot/cap-${id}`,
        sourceVideoAssetId: from,
        sourceTimeSeconds: at,
      },
      cloud: null,
      availability: "local",
      editing: "project-available",
    };
  }

  const list = (...items: LibraryItem[]): void => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items,
      vaultError: null,
      catalogVerifiedAt: null,
    }));
  };

  beforeEach(() => {
    window.electronAPI.onLibraryChanged = () => () => {};
    window.electronAPI.copyScreenshotById = vi.fn(async () => {});
  });

  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  /** The Captures tab: where the list lives, named with its count. */
  const openCapturesTab = (count: number): void => {
    fireEvent.click(screen.getByRole("tab", { name: `Captures (${count})` }));
  };

  it("lists the video's captures newest first in a Captures tab, with their time and a Copy button", async () => {
    list(
      exportedOnlyItem,
      capture("old", 12.3, 1),
      capture("new", 83.4, 2),
      capture("other", 5, 3, "some-other-video"),
    );
    renderDetail("asset-b");
    await waitForLoaded();
    openCapturesTab(2);

    const section = document.querySelector('[data-ui-area="libraryDetail.captures"]');
    expect(section).not.toBeNull();
    const items = within(section as HTMLElement).getAllByTestId("capture-item");
    expect(items.map((el) => el.textContent)).toEqual([
      expect.stringContaining("1:23.4"),
      expect.stringContaining("0:12.3"),
    ]);
    expect(screen.getByRole("tab", { name: "Captures (2)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("shows no Captures tab for a video without captures", async () => {
    list(exportedOnlyItem, capture("other", 5, 3, "some-other-video"));
    renderDetail("asset-b");
    await waitForLoaded();
    expect(screen.queryByRole("tab", { name: /^Captures/ })).toBeNull();
  });

  it("copies a capture by its library id", async () => {
    list(exportedOnlyItem, capture("one", 7, 1));
    renderDetail("asset-b");
    await waitForLoaded();
    openCapturesTab(1);
    fireEvent.click(screen.getByRole("button", { name: "Copy image" }));
    await waitFor(() =>
      expect(window.electronAPI.copyScreenshotById).toHaveBeenCalledWith("cap-one"),
    );
  });

  it("opens a capture's own page when its image is clicked", async () => {
    list(exportedOnlyItem, capture("one", 7, 1));
    const router = renderDetail("asset-b");
    await waitForLoaded();
    openCapturesTab(1);
    fireEvent.click(screen.getByRole("button", { name: "Open the capture from 0:07.0" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/library/cap-one"));
  });

  it("does not list captures on a capture's own page", async () => {
    list(exportedOnlyItem, capture("one", 7, 1));
    renderDetail("cap-one");
    await waitForLoaded();
    expect(screen.queryByRole("tab", { name: /^Captures/ })).toBeNull();
  });
});
